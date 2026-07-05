// BooruRamen - A personalized booru browser
// Copyright (C) 2025 SoupDevs
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use tauri_plugin_notification::NotificationExt;

mod updater;

#[cfg(target_os = "android")]
const DOWNLOAD_CHANNEL_ID: &str = "downloads";

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
      download_file,
      clear_downloads,
      updater::install_update
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
