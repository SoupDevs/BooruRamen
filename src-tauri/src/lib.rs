// BooruRamen - A personalized booru browser
// Copyright (C) 2025 SoupDevs
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::{
  hash::{DefaultHasher, Hash, Hasher},
  path::{Path, PathBuf},
  sync::atomic::{AtomicU64, Ordering},
};
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

mod updater;

#[cfg(target_os = "android")]
const DOWNLOAD_CHANNEL_ID: &str = "downloads";

const BOORU_MEDIA_CACHE_DIR: &str = "booru-media";
const MAX_BOORU_MEDIA_BYTES: u64 = 512 * 1024 * 1024;
const MAX_BOORU_CACHE_BYTES: u64 = 512 * 1024 * 1024;

/// A media host and its referer must share at least this many trailing labels.
/// img4.gelbooru.com and gelbooru.com share two; unrelated sites share one.
const MIN_SHARED_SITE_LABELS: usize = 2;

fn site_labels(host: &str) -> Vec<&str> {
  host.split('.').filter(|label| !label.is_empty()).collect()
}

/// An address (IPv4/IPv6 literal or localhost), i.e. a host with no registrable
/// domain — self-hosted boorus commonly live on one.
fn is_address_host(host: &str) -> bool {
  host == "localhost"
    || host.contains(':')
    || {
      let parts: Vec<&str> = host.split('.').collect();
      parts.len() == 4
        && parts
          .iter()
          .all(|part| !part.is_empty() && part.len() <= 3 && part.bytes().all(|b| b.is_ascii_digit()))
    }
}

/// True when two hosts belong to the same site (same registrable domain or a
/// subdomain of it), which is as strict as this check can get without a public
/// suffix list. Used to keep the media command from becoming a general-purpose
/// download proxy for arbitrary URLs.
fn hosts_share_site(a: &str, b: &str) -> bool {
  if is_address_host(a) || is_address_host(b) {
    return a == b;
  }
  site_labels(a)
    .iter()
    .rev()
    .zip(site_labels(b).iter().rev())
    .take_while(|(x, y)| x == y)
    .count()
    >= MIN_SHARED_SITE_LABELS
}
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Validate a media URL together with the referer its booru expects.
///
/// Any booru can be configured, so the host list cannot be baked in; instead the
/// media must live on the same site as the referer the caller supplied. That
/// keeps the anti-hotlink behaviour (a page URL of the booru itself) while
/// refusing unrelated or non-HTTPS targets.
fn booru_media_request(
  url: &str,
  referer: &str,
) -> Result<(tauri_plugin_http::reqwest::Url, String, String), String> {
  let parsed = tauri_plugin_http::reqwest::Url::parse(url)
    .map_err(|_| "Invalid media URL".to_string())?;
  let host = parsed
    .host_str()
    .map(str::to_ascii_lowercase)
    .ok_or_else(|| "Media URL has no host".to_string())?;

  let parsed_referer = tauri_plugin_http::reqwest::Url::parse(referer)
    .map_err(|_| "Invalid referer URL".to_string())?;
  let referer_host = parsed_referer
    .host_str()
    .map(str::to_ascii_lowercase)
    .ok_or_else(|| "Referer URL has no host".to_string())?;

  if parsed.scheme() != "https" {
    return Err("Only HTTPS media URLs are allowed".to_string());
  }
  if parsed_referer.scheme() != "https" {
    return Err("Only HTTPS referer URLs are allowed".to_string());
  }
  if !hosts_share_site(&host, &referer_host) {
    return Err("Media URL must belong to the booru's own site".to_string());
  }

  let extension = Path::new(parsed.path())
    .extension()
    .and_then(|value| value.to_str())
    .map(str::to_ascii_lowercase)
    .ok_or_else(|| "Media URL has no file extension".to_string())?;
  if !matches!(
    extension.as_str(),
    "jpg" | "jpeg" | "png" | "gif" | "webp" | "avif" | "mp4" | "webm" | "mov"
  ) {
    return Err("Unsupported media type".to_string());
  }

  Ok((parsed, extension, referer.to_string()))
}

fn booru_cache_path(cache_dir: &Path, url: &str, extension: &str) -> PathBuf {
  let mut hasher = DefaultHasher::new();
  url.hash(&mut hasher);
  cache_dir.join(format!("{:016x}.{extension}", hasher.finish()))
}

fn prune_booru_cache(cache_dir: &Path, preserve: &Path) {
  let Ok(entries) = std::fs::read_dir(cache_dir) else {
    return;
  };
  let mut files = entries
    .filter_map(Result::ok)
    .filter_map(|entry| {
      let path = entry.path();
      let metadata = entry.metadata().ok()?;
      if !metadata.is_file() || path == preserve {
        return None;
      }
      Some((
        path,
        metadata.len(),
        metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH),
      ))
    })
    .collect::<Vec<_>>();
  let mut total = files.iter().map(|(_, size, _)| *size).sum::<u64>()
    + std::fs::metadata(preserve).map(|metadata| metadata.len()).unwrap_or(0);
  files.sort_by_key(|(_, _, modified)| *modified);

  for (path, size, _) in files {
    if total <= MAX_BOORU_CACHE_BYTES {
      break;
    }
    if std::fs::remove_file(path).is_ok() {
      total = total.saturating_sub(size);
    }
  }
}

async fn download_booru_media(
  url: &str,
  referer: &str,
  cache_dir: &Path,
) -> Result<PathBuf, String> {
  use std::io::Write;

  let (parsed, extension, referer) = booru_media_request(url, referer)?;
  std::fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
  let cache_path = booru_cache_path(cache_dir, parsed.as_str(), &extension);
  if cache_path.is_file() {
    prune_booru_cache(cache_dir, &cache_path);
    return Ok(cache_path);
  }

  let temp_id = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
  let temp_path = cache_dir.join(format!(
    ".{}.part-{}-{temp_id}",
    cache_path.file_name().unwrap_or_default().to_string_lossy(),
    std::process::id()
  ));

  let client = tauri_plugin_http::reqwest::Client::builder()
    .redirect(tauri_plugin_http::reqwest::redirect::Policy::limited(5))
    .build()
    .map_err(|e| e.to_string())?;
  let mut response = client
    .get(parsed)
    .header("User-Agent", "BooruRamen")
    .header("Referer", referer)
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if !response.status().is_success() {
    return Err(format!("Media request returned HTTP {}", response.status()));
  }
  let content_type = response
    .headers()
    .get(tauri_plugin_http::reqwest::header::CONTENT_TYPE)
    .and_then(|value| value.to_str().ok())
    .unwrap_or("")
    .to_ascii_lowercase();
  if !(content_type.starts_with("image/")
    || content_type.starts_with("video/")
    || content_type.starts_with("application/octet-stream"))
  {
    return Err(format!("Booru returned non-media content: {content_type}"));
  }
  if response.content_length().is_some_and(|size| size > MAX_BOORU_MEDIA_BYTES) {
    return Err("Media file exceeds the 512 MiB limit".to_string());
  }

  let result = async {
    let mut file = std::fs::File::create(&temp_path).map_err(|e| e.to_string())?;
    let mut bytes_written = 0u64;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
      bytes_written += chunk.len() as u64;
      if bytes_written > MAX_BOORU_MEDIA_BYTES {
        return Err("Media file exceeds the 512 MiB limit".to_string());
      }
      file.write_all(&chunk).map_err(|e| e.to_string())?;
    }
    file.sync_all().map_err(|e| e.to_string())?;
    Ok::<(), String>(())
  }
  .await;

  if let Err(error) = result {
    let _ = std::fs::remove_file(&temp_path);
    return Err(error);
  }

  if let Err(error) = std::fs::rename(&temp_path, &cache_path) {
    if cache_path.is_file() {
      let _ = std::fs::remove_file(&temp_path);
    } else {
      let _ = std::fs::remove_file(&temp_path);
      return Err(error.to_string());
    }
  }
  prune_booru_cache(cache_dir, &cache_path);
  Ok(cache_path)
}

/// Fetch booru media natively with the Referer the source expects, then expose
/// it through Tauri's range-capable asset protocol. The webview cannot set a
/// Referer itself, so hotlink-protected boorus (which may be any host the user
/// configured) are only loadable through this path.
#[tauri::command]
async fn cache_booru_media(
  app: tauri::AppHandle,
  url: String,
  referer: String,
) -> Result<String, String> {
  let cache_dir = app
    .path()
    .app_cache_dir()
    .map_err(|e| e.to_string())?
    .join(BOORU_MEDIA_CACHE_DIR);
  let path = download_booru_media(&url, &referer, &cache_dir).await?;
  Ok(path.to_string_lossy().into_owned())
}

/// Best-effort download notification, sent from the Rust side.
/// The plugin's JS API cannot be used for this: it does not expose
/// create_channel to the webview (so notifications are silently dropped on
/// Android 8+, which requires a channel) and its sendNotification swallows
/// errors. Reusing the same id makes "Saved" replace "Downloading…".
fn notify_download(app: &tauri::AppHandle, id: i32, body: &str) {
  let notification = app.notification();

  match notification.permission_state() {
    Ok(tauri_plugin_notification::PermissionState::Prompt)
    | Ok(tauri_plugin_notification::PermissionState::PromptWithRationale) => {
      let _ = notification.request_permission();
    }
    _ => {}
  }

  #[cfg(target_os = "android")]
  {
    use tauri_plugin_notification::{Channel, Importance};
    // Creating a channel that already exists is a no-op.
    if let Err(e) = notification.create_channel(
      Channel::builder(DOWNLOAD_CHANNEL_ID, "Downloads")
        .description("Download status for saved posts")
        .importance(Importance::Default)
        .build(),
    ) {
      log::warn!("Failed to create notification channel: {e}");
    }
  }

  let builder = notification.builder().id(id).title("BooruRamen").body(body);
  #[cfg(target_os = "android")]
  let builder = builder.channel_id(DOWNLOAD_CHANNEL_ID);
  if let Err(e) = builder.show() {
    log::warn!("Failed to send notification: {e}");
  }
}

fn notification_id(path: &str) -> i32 {
  use std::hash::{DefaultHasher, Hash, Hasher};
  let mut hasher = DefaultHasher::new();
  path.hash(&mut hasher);
  hasher.finish() as i32
}

/// Download a file natively so the bytes never cross the WebView IPC bridge.
/// Streaming large videos through JS froze the UI on Android and could OOM.
#[tauri::command]
async fn download_file(app: tauri::AppHandle, url: String, path: String) -> Result<(), String> {
  let filename = std::path::Path::new(&path)
    .file_name()
    .map(|n| n.to_string_lossy().into_owned())
    .unwrap_or_else(|| "file".to_string());
  let id = notification_id(&path);

  notify_download(&app, id, &format!("Downloading {filename}…"));
  match perform_download(&url, &path).await {
    Ok(()) => {
      notify_download(&app, id, &format!("Saved {filename}"));
      Ok(())
    }
    Err(e) => {
      notify_download(&app, id, &format!("Download failed: {filename}"));
      Err(e)
    }
  }
}

/// Delete everything inside the configured download directory (but not the
/// directory itself). The webview cannot touch the filesystem directly.
#[tauri::command]
async fn clear_downloads(path: String) -> Result<(), String> {
  let dir = std::path::Path::new(&path);
  if dir.parent().is_none() {
    return Err("Refusing to clear a filesystem root".to_string());
  }
  if !dir.exists() {
    return Ok(());
  }
  if !dir.is_dir() {
    return Err("Download location is not a directory".to_string());
  }

  for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
    let entry_path = entry.map_err(|e| e.to_string())?.path();
    let result = if entry_path.is_dir() {
      std::fs::remove_dir_all(&entry_path)
    } else {
      std::fs::remove_file(&entry_path)
    };
    result.map_err(|e| e.to_string())?;
  }
  Ok(())
}

async fn perform_download(url: &str, path: &str) -> Result<(), String> {
  use std::io::Write;

  let parent = std::path::Path::new(path)
    .parent()
    .ok_or_else(|| "Invalid download path".to_string())?;
  std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;

  let client = tauri_plugin_http::reqwest::Client::new();
  let mut response = client
    .get(url)
    .header("User-Agent", "BooruRamen")
    .send()
    .await
    .map_err(|e| e.to_string())?;
  if !response.status().is_success() {
    return Err(format!("HTTP {}", response.status()));
  }

  let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
  loop {
    match response.chunk().await {
      Ok(Some(chunk)) => {
        if let Err(e) = file.write_all(&chunk) {
          drop(file);
          let _ = std::fs::remove_file(&path);
          return Err(e.to_string());
        }
      }
      Ok(None) => break,
      Err(e) => {
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Err(e.to_string());
      }
    }
  }
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![
      cache_booru_media,
      download_file,
      clear_downloads,
      updater::install_update,
      updater::open_install_permission_settings,
      updater::sideload_updates_supported
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn media_url_rejects_foreign_and_insecure_hosts() {
    // Media that does not live on the referer's own site.
    assert!(booru_media_request("https://example.com/image.jpg", "https://gelbooru.com/").is_err());
    // Lookalike suffix that only shares the TLD.
    assert!(booru_media_request(
      "https://gelbooru.com.example.com/image.jpg",
      "https://gelbooru.com/"
    )
    .is_err());
    // Plain HTTP, even on the right site.
    assert!(booru_media_request("http://img4.gelbooru.com/image.jpg", "https://gelbooru.com/").is_err());
    // Non-HTTPS referer.
    assert!(booru_media_request(
      "https://img4.gelbooru.com/image.jpg",
      "http://gelbooru.com/"
    )
    .is_err());
    // A different address on the same scheme is still a different site.
    assert!(booru_media_request("https://127.0.0.2/i.jpg", "https://127.0.0.1/").is_err());
  }

  #[test]
  fn media_url_accepts_supported_cdn_files_on_any_configured_site() {
    let (_, extension, referer) = booru_media_request(
      "https://img4.gelbooru.com/images/f3/82/f3824ad985f121187065c4eaeae22875.jpg",
      "https://gelbooru.com/",
    )
    .expect("valid Gelbooru image URL");
    assert_eq!(extension, "jpg");
    assert_eq!(referer, "https://gelbooru.com/");

    // A user-configured booru on its own domain works without any host list.
    let (_, _, _) = booru_media_request(
      "https://cdn.some-other-booru.test/media/abc.png",
      "https://some-other-booru.test/",
    )
    .expect("valid custom booru image URL");

    // A self-hosted booru on an address serves media from that same address.
    let (_, _, _) = booru_media_request("https://127.0.0.1/i.jpg", "https://127.0.0.1/")
      .expect("valid self-hosted media URL");
  }

  #[test]
  #[ignore = "live booru transport check"]
  fn downloads_media_with_required_referer() {
    let cache_dir = std::env::temp_dir().join(format!(
      "booruramen-media-test-{}",
      std::process::id()
    ));
    let urls = [
      "https://img4.gelbooru.com/images/f3/82/f3824ad985f121187065c4eaeae22875.jpg",
      "https://img4.gelbooru.com/images/bf/7f/bf7fa57e3e226307ffcc3b41052510bc.webm",
    ];
    for url in urls {
      let result = tauri::async_runtime::block_on(download_booru_media(
        url,
        "https://gelbooru.com/",
        &cache_dir,
      ));
      let path = result.expect("booru media download should succeed");
      assert!(std::fs::metadata(path).expect("cached media metadata").len() > 0);
    }
    let _ = std::fs::remove_dir_all(cache_dir);
  }
}
