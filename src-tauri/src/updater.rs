// BooruRamen - A personalized booru browser
// Copyright (C) 2025 SoupDevs
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Self-update: download a release asset and hand it to the platform
//! installer. The webview only decides *that* an update should happen;
//! picking the right asset and running the install is done here because
//! it needs filesystem and process access.
//!
//! On Android this is a sideload-only mechanism: the app downloads an APK and
//! asks the system package installer to run it. That needs the
//! `sideload-updates` Cargo feature (manifest permission + FileProvider come
//! from `scripts/android/patch_android_project.mjs`). A store build ships with
//! the feature off, and `install_update` then reports that the store owns
//! updates instead.

use serde::Deserialize;
#[cfg(any(
  windows,
  all(target_os = "android", feature = "sideload-updates")
))]
use tauri::Emitter;

/// Error marker returned when Android will not show the package installer
/// because the user has not allowed installs from this app yet. The webview
/// turns it into an actionable "allow installs, then try again" message
/// instead of a generic failure.
#[cfg(all(target_os = "android", feature = "sideload-updates"))]
pub const INSTALL_PERMISSION_REQUIRED: &str = "install-permission-required";

/// Release asset as reported by the update provider. Not every build reads
/// every field (`url`/`size` only matter where the app downloads the asset
/// itself), so silence the wire-format dead_code noise.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct UpdateAsset {
  pub name: String,
  pub url: String,
  /// Size in bytes as reported by the release API. Used to verify a download
  /// finished and to reuse a previous one instead of downloading again.
  #[serde(default)]
  pub size: Option<u64>,
}

/// Emit download progress to the webview. Best-effort: progress display
/// failing is no reason to abort an update.
#[cfg(any(
  windows,
  all(target_os = "android", feature = "sideload-updates")
))]
fn emit_progress(app: &tauri::AppHandle, phase: &str, downloaded: u64, total: u64) {
  let _ = app.emit(
    "update://progress",
    serde_json::json!({
      "phase": phase,
      "downloaded": downloaded,
      "total": total,
    }),
  );
}

/// Download `url` to `dest`, emitting progress events along the way.
/// `expected_size` (when the release API reported one) guards against
/// installing a truncated file: a short download is deleted and reported
/// rather than handed to the installer.
#[cfg(any(
  windows,
  all(target_os = "android", feature = "sideload-updates")
))]
async fn download_installer(
  app: &tauri::AppHandle,
  url: &str,
  dest: &std::path::Path,
  expected_size: Option<u64>,
) -> Result<(), String> {
  use std::io::Write;

  if let Some(parent) = dest.parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }

  let client = tauri_plugin_http::reqwest::Client::new();
  let mut response = client
    .get(url)
    .header("User-Agent", "BooruRamen")
    .send()
    .await
    .map_err(|e| e.to_string())?;
  if !response.status().is_success() {
    return Err(format!("Update download failed: HTTP {}", response.status()));
  }

  let total = response.content_length().unwrap_or(0);
  let mut downloaded: u64 = 0;
  let mut last_emitted: u64 = 0;
  emit_progress(app, "downloading", 0, total);

  let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
  loop {
    match response.chunk().await {
      Ok(Some(chunk)) => {
        if let Err(e) = file.write_all(&chunk) {
          drop(file);
          let _ = std::fs::remove_file(dest);
          return Err(e.to_string());
        }
        downloaded += chunk.len() as u64;
        // Throttle events to roughly every 256 KiB.
        if downloaded - last_emitted >= 256 * 1024 {
          last_emitted = downloaded;
          emit_progress(app, "downloading", downloaded, total);
        }
      }
      Ok(None) => break,
      Err(e) => {
        drop(file);
        let _ = std::fs::remove_file(dest);
        return Err(e.to_string());
      }
    }
  }
  emit_progress(app, "downloading", downloaded, total.max(downloaded));

  // A short file means the transfer was cut off. Fail here, with a message the
  // user can act on, instead of handing a truncated file to the platform
  // installer where the failure is much harder to see.
  if let Some(expected) = expected_size {
    if expected > 0 && downloaded != expected {
      drop(file);
      let _ = std::fs::remove_file(dest);
      return Err(format!(
        "Update download incomplete ({downloaded} of {expected} bytes)"
      ));
    }
  }
  Ok(())
}

#[cfg(any(
  windows,
  all(target_os = "android", feature = "sideload-updates")
))]
fn filename_from_url(url: &str) -> String {
  url
    .split('/')
    .next_back()
    .filter(|s| !s.is_empty())
    .unwrap_or("update.bin")
    .to_string()
}

/// Download the right release asset for this platform and start installing
/// it. On Windows the app exits so the installer can replace it and the
/// installer relaunches it afterwards; on Android the system package
/// installer takes over.
#[tauri::command]
pub async fn install_update(
  app: tauri::AppHandle,
  assets: Vec<UpdateAsset>,
) -> Result<(), String> {
  let asset = pick_asset(&assets)?;
  log::info!("Installing update from asset {}", asset.name);
  perform_install(app, asset).await
}

/// Whether this build installs downloaded updates itself. False in a build
/// without the `sideload-updates` feature, where a store owns updates and the
/// UI should not offer a download.
#[tauri::command]
pub fn sideload_updates_supported() -> bool {
  cfg!(feature = "sideload-updates")
}

/// Open the system screen that lets the user allow installs from this app
/// ("Install unknown apps"). Android only needs it when the grant is missing,
/// which `install_update` reports as `INSTALL_PERMISSION_REQUIRED`.
#[tauri::command]
pub fn open_install_permission_settings(app: tauri::AppHandle) -> Result<(), String> {
  open_install_permission_settings_impl(&app)
}

#[cfg(target_os = "android")]
fn pick_asset<'a>(assets: &'a [UpdateAsset]) -> Result<&'a UpdateAsset, String> {
  assets
    .iter()
    .find(|a| a.name.ends_with(".apk"))
    .ok_or_else(|| "This release has no Android package".to_string())
}

#[cfg(windows)]
fn pick_asset<'a>(assets: &'a [UpdateAsset]) -> Result<&'a UpdateAsset, String> {
  let exe = std::env::current_exe()
    .map(|p| p.to_string_lossy().to_lowercase())
    .unwrap_or_default();
  // MSI installs live under Program Files; NSIS installs are per-user.
  // Update with the same kind of installer the app was installed with so
  // we don't end up with two side-by-side installs.
  let msi_installed = exe.contains("program files");
  let nsis = assets.iter().find(|a| a.name.ends_with("-setup.exe"));
  let msi = assets.iter().find(|a| a.name.ends_with(".msi"));
  let preferred = if msi_installed { msi.or(nsis) } else { nsis.or(msi) };
  preferred.ok_or_else(|| "This release has no Windows installer".to_string())
}

#[cfg(not(any(windows, target_os = "android")))]
fn pick_asset<'a>(_assets: &'a [UpdateAsset]) -> Result<&'a UpdateAsset, String> {
  Err("Automatic updates are not supported on this platform yet".to_string())
}

#[cfg(windows)]
async fn perform_install(app: tauri::AppHandle, asset: &UpdateAsset) -> Result<(), String> {
  use std::os::windows::process::CommandExt;
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;

  let dest = std::env::temp_dir()
    .join("BooruRamen-update")
    .join(filename_from_url(&asset.url));
  download_installer(&app, &asset.url, &dest, asset.size).await?;
  emit_progress(&app, "installing", 0, 0);

  let installer = dest.to_string_lossy().to_string();
  let current_exe = std::env::current_exe()
    .map_err(|e| e.to_string())?
    .to_string_lossy()
    .to_string();

  // The ping is a portable ~2s sleep so this app has exited before the
  // installer tries to replace its files. NSIS installs silently; MSI shows
  // a progress-only UI (and a UAC prompt for per-machine installs). Either
  // way the old executable path stays valid, so relaunch it when done.
  let script = if installer.to_lowercase().ends_with(".msi") {
    format!(
      "ping -n 3 127.0.0.1 > nul & msiexec /i \"{installer}\" /passive /norestart & start \"\" \"{current_exe}\""
    )
  } else {
    format!(
      "ping -n 3 127.0.0.1 > nul & \"{installer}\" /S & start \"\" \"{current_exe}\""
    )
  };

  // raw_arg: cmd.exe does not understand the C-style quote escaping that
  // Command's normal argument handling would apply to the embedded quotes.
  std::process::Command::new("cmd")
    .raw_arg(format!("/C {script}"))
    .creation_flags(CREATE_NO_WINDOW)
    .spawn()
    .map_err(|e| format!("Failed to launch installer: {e}"))?;

  // Give the invoke response and the "installing" splash a moment to reach
  // the webview, then get out of the installer's way.
  std::thread::spawn(move || {
    std::thread::sleep(std::time::Duration::from_millis(800));
    app.exit(0);
  });
  Ok(())
}

#[cfg(all(target_os = "android", feature = "sideload-updates"))]
async fn perform_install(app: tauri::AppHandle, asset: &UpdateAsset) -> Result<(), String> {
  use tauri::Manager;

  // This folder has to be covered by the FileProvider paths that
  // scripts/android/patch_android_project.mjs keeps in res/xml/file_paths.xml.
  let dest = app
    .path()
    .app_cache_dir()
    .map_err(|e| e.to_string())?
    .join("updates")
    .join(filename_from_url(&asset.url));

  // A previous attempt may already have the APK - for instance one that
  // stopped to ask for the install permission. Reusing it makes "try again"
  // instant instead of pulling the whole package down twice.
  let existing = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
  let reusable = existing > 0 && asset.size.map_or(false, |expected| expected == existing);
  if reusable {
    log::info!("Reusing the update downloaded earlier at {}", dest.display());
    emit_progress(&app, "downloading", existing, existing);
  } else {
    download_installer(&app, &asset.url, &dest, asset.size).await?;
  }

  let bytes = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
  if bytes == 0 {
    let _ = std::fs::remove_file(&dest);
    return Err("The update download was empty; please try again".to_string());
  }

  emit_progress(&app, "installing", 0, 0);
  log::info!(
    "Handing {} ({bytes} bytes) to the package installer",
    dest.display()
  );
  install_apk(&app, &dest.to_string_lossy())
}

#[cfg(all(target_os = "android", not(feature = "sideload-updates")))]
async fn perform_install(_app: tauri::AppHandle, _asset: &UpdateAsset) -> Result<(), String> {
  Err("This build gets its updates from the app store".to_string())
}

#[cfg(not(any(windows, target_os = "android")))]
async fn perform_install(_app: tauri::AppHandle, _asset: &UpdateAsset) -> Result<(), String> {
  Err("Automatic updates are not supported on this platform yet".to_string())
}

/// Run `f` with the Android activity's JNI environment, on the thread that
/// owns the activity.
///
/// The activity is only reachable through the webview's JNI handle, and
/// `startActivity` belongs on the main thread anyway. Note that this is the
/// only handle Tauri hands out: `ndk_context` is never initialized for a Tauri
/// v2 app, so calling into it panics.
#[cfg(all(target_os = "android", feature = "sideload-updates"))]
fn on_android_main_thread<F>(app: &tauri::AppHandle, f: F) -> Result<(), String>
where
  F: FnOnce(&mut jni::JNIEnv, &jni::objects::JObject) -> Result<(), String> + Send + 'static,
{
  use tauri::Manager;

  let window = app
    .get_webview_window("main")
    .or_else(|| app.webview_windows().into_values().next())
    .ok_or_else(|| "No window to run the installer from".to_string())?;

  let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
  window
    .with_webview(move |webview| {
      webview.jni_handle().exec(move |env, activity, _webview| {
        let _ = tx.send(with_java_exceptions(env, |env| f(env, activity)));
      });
    })
    .map_err(|e| format!("Failed to reach the Android context: {e}"))?;

  rx.recv_timeout(std::time::Duration::from_secs(20))
    .map_err(|_| "The Android installer did not respond".to_string())?
}

/// Run `f`, and if it failed with a Java exception pending, describe that
/// exception in logcat and append its class and message to the error. The
/// message the user sees is the only diagnostic they can pass on, and a bare
/// "Java exception was thrown" hides the cause completely.
#[cfg(all(target_os = "android", feature = "sideload-updates"))]
fn with_java_exceptions<F>(env: &mut jni::JNIEnv, f: F) -> Result<(), String>
where
  F: FnOnce(&mut jni::JNIEnv) -> Result<(), String>,
{
  let result = f(env);
  if result.is_err() && env.exception_check().unwrap_or(false) {
    // Read the exception before clearing it: the throwable reference stays
    // valid for the rest of this native frame.
    let summary = pending_exception_summary(env);
    let _ = env.exception_describe();
    let _ = env.exception_clear();
    if let (Err(message), Some(summary)) = (&result, summary) {
      return Err(format!("{message} ({summary})"));
    }
  }
  result
}

/// The pending Java exception as "class: message", for the error the webview
/// shows. Falls back to None when it cannot be read, in which case the call
/// site's own message stands on its own.
#[cfg(all(target_os = "android", feature = "sideload-updates"))]
fn pending_exception_summary(env: &mut jni::JNIEnv) -> Option<String> {
  use jni::objects::JString;

  let throwable = env.exception_occurred().ok()?;
  if throwable.is_null() {
    return None;
  }
  let text = env
    .call_method(&throwable, "toString", "()Ljava/lang/String;", &[])
    .ok()?
    .l()
    .ok()?;
  let java_text = JString::from(text);
  let text = env.get_string(&java_text).ok()?;
  let text: String = text.into();
  // The whole point is to shorten "it threw" into something actionable; a
  // monster message helps nobody.
  if text.len() > 300 {
    return Some(format!("{}...", &text[..300]));
  }
  Some(text)
}

#[cfg(all(target_os = "android", feature = "sideload-updates"))]
fn install_apk(app: &tauri::AppHandle, apk_path: &str) -> Result<(), String> {
  let path = apk_path.to_string();
  on_android_main_thread(app, move |env, activity| {
    start_install_intent(env, activity, &path)
  })
}

/// Fire the system package-installer for a downloaded APK, equivalent to:
///
/// ```java
/// Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
/// Intent intent = new Intent(Intent.ACTION_VIEW);
/// intent.setDataAndType(uri, "application/vnd.android.package-archive");
/// intent.addFlags(FLAG_ACTIVITY_NEW_TASK | FLAG_GRANT_READ_URI_PERMISSION);
/// ctx.startActivity(intent);
/// ```
///
/// The user still confirms the install in the system dialog - Android does
/// not allow sideloaded apps to replace themselves fully silently. Once the
/// app is distributed through Google Play this whole path goes away.
#[cfg(all(target_os = "android", feature = "sideload-updates"))]
fn start_install_intent(
  env: &mut jni::JNIEnv,
  activity: &jni::objects::JObject,
  apk_path: &str,
) -> Result<(), String> {
  use jni::objects::{JClass, JObject, JString, JValue};

  const FLAG_GRANT_READ_URI_PERMISSION: i32 = 0x0000_0001;
  const FLAG_ACTIVITY_NEW_TASK: i32 = 0x1000_0000;

  // Android 8+ only shows the installer if the *user* allowed this app to
  // install packages ("Install unknown apps"). Without the grant the intent is
  // dropped silently and the app looks frozen mid-install, so ask the platform
  // first and let the webview point the user at the setting.
  let sdk_int = env
    .get_static_field("android/os/Build$VERSION", "SDK_INT", "I")
    .and_then(|v| v.i())
    .map_err(|e| format!("JNI error: {e}"))?;
  if sdk_int >= 26 {
    let manager = env
      .call_method(
        activity,
        "getPackageManager",
        "()Landroid/content/pm/PackageManager;",
        &[],
      )
      .and_then(|v| v.l())
      .map_err(|e| format!("JNI error: {e}"))?;
    let allowed = env
      .call_method(&manager, "canRequestPackageInstalls", "()Z", &[])
      .and_then(|v| v.z())
      .map_err(|e| format!("JNI error: {e}"))?;
    if !allowed {
      log::warn!("Not allowed to install packages: asking the user for the grant");
      return Err(INSTALL_PERMISSION_REQUIRED.to_string());
    }
  }

  // FileProvider is an androidx class, invisible to the JVM's system class
  // loader that FindClass uses from native code. Load it through the
  // activity's own class loader instead.
  let class_loader = env
    .call_method(activity, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])
    .and_then(|v| v.l())
    .map_err(|e| format!("JNI error: {e}"))?;
  let provider_name = env
    .new_string("androidx.core.content.FileProvider")
    .map_err(|e| format!("JNI error: {e}"))?;
  let provider_class: JClass = env
    .call_method(
      &class_loader,
      "loadClass",
      "(Ljava/lang/String;)Ljava/lang/Class;",
      &[JValue::Object(&JObject::from(provider_name))],
    )
    .and_then(|v| v.l())
    .map_err(|e| format!("JNI error: {e}"))?
    .into();

  let package_name: String = {
    let raw = env
      .call_method(activity, "getPackageName", "()Ljava/lang/String;", &[])
      .and_then(|v| v.l())
      .map_err(|e| format!("JNI error: {e}"))?;
    env
      .get_string(&JString::from(raw))
      .map_err(|e| format!("JNI error: {e}"))?
      .into()
  };
  // Reuse the FileProvider that `tauri android init` already declares
  // (<package>.fileprovider). Declaring a second provider with the same class
  // does not work: the framework attaches one instance per provider class, so
  // the installer opened the other authority and rejected the URI with a
  // SecurityException ("does not match the one of the contentProvider").
  let authority = env
    .new_string(format!("{package_name}.fileprovider"))
    .map_err(|e| format!("JNI error: {e}"))?;

  let path = env
    .new_string(apk_path)
    .map_err(|e| format!("JNI error: {e}"))?;
  let file = env
    .new_object(
      "java/io/File",
      "(Ljava/lang/String;)V",
      &[JValue::Object(&JObject::from(path))],
    )
    .map_err(|e| format!("JNI error: {e}"))?;

  let uri = env
    .call_static_method(
      &provider_class,
      "getUriForFile",
      "(Landroid/content/Context;Ljava/lang/String;Ljava/io/File;)Landroid/net/Uri;",
      &[
        JValue::Object(activity),
        JValue::Object(&authority),
        JValue::Object(&file),
      ],
    )
    .and_then(|v| v.l())
    .map_err(|e| format!("JNI error: {e}"))?;

  let action = env
    .new_string("android.intent.action.VIEW")
    .map_err(|e| format!("JNI error: {e}"))?;
  let mime = env
    .new_string("application/vnd.android.package-archive")
    .map_err(|e| format!("JNI error: {e}"))?;
  let intent = env
    .new_object(
      "android/content/Intent",
      "(Ljava/lang/String;)V",
      &[JValue::Object(&action)],
    )
    .map_err(|e| format!("JNI error: {e}"))?;
  env
    .call_method(
      &intent,
      "setDataAndType",
      "(Landroid/net/Uri;Ljava/lang/String;)Landroid/content/Intent;",
      &[JValue::Object(&uri), JValue::Object(&mime)],
    )
    .map_err(|e| format!("JNI error: {e}"))?;
  env
    .call_method(
      &intent,
      "addFlags",
      "(I)Landroid/content/Intent;",
      &[JValue::Int(
        FLAG_ACTIVITY_NEW_TASK | FLAG_GRANT_READ_URI_PERMISSION,
      )],
    )
    .map_err(|e| format!("JNI error: {e}"))?;

  start_activity(env, activity, &intent, "the package installer")
}

#[cfg(all(target_os = "android", feature = "sideload-updates"))]
fn start_activity(
  env: &mut jni::JNIEnv,
  activity: &jni::objects::JObject,
  intent: &jni::objects::JObject,
  what: &str,
) -> Result<(), String> {
  use jni::objects::JValue;

  match env.call_method(
    activity,
    "startActivity",
    "(Landroid/content/Intent;)V",
    &[JValue::Object(intent)],
  ) {
    Ok(_) => {
      log::info!("Opened {what}");
      Ok(())
    }
    Err(e) => Err(format!("Android refused to open {what}: {e}")),
  }
}

#[cfg(all(target_os = "android", feature = "sideload-updates"))]
fn open_install_permission_settings_impl(app: &tauri::AppHandle) -> Result<(), String> {
  on_android_main_thread(app, |env, activity| open_unknown_sources(env, activity))
}

#[cfg(all(target_os = "android", feature = "sideload-updates"))]
fn open_unknown_sources(
  env: &mut jni::JNIEnv,
  activity: &jni::objects::JObject,
) -> Result<(), String> {
  use jni::objects::{JObject, JString, JValue};

  const FLAG_ACTIVITY_NEW_TASK: i32 = 0x1000_0000;

  let package_name: String = {
    let raw = env
      .call_method(activity, "getPackageName", "()Ljava/lang/String;", &[])
      .and_then(|v| v.l())
      .map_err(|e| format!("JNI error: {e}"))?;
    env
      .get_string(&JString::from(raw))
      .map_err(|e| format!("JNI error: {e}"))?
      .into()
  };

  let action = env
    .new_string("android.settings.MANAGE_UNKNOWN_APP_SOURCES")
    .map_err(|e| format!("JNI error: {e}"))?;
  let package_uri = env
    .new_string(format!("package:{package_name}"))
    .map_err(|e| format!("JNI error: {e}"))?;
  let uri = env
    .call_static_method(
      "android/net/Uri",
      "parse",
      "(Ljava/lang/String;)Landroid/net/Uri;",
      &[JValue::Object(&JObject::from(package_uri))],
    )
    .and_then(|v| v.l())
    .map_err(|e| format!("JNI error: {e}"))?;
  let intent = env
    .new_object(
      "android/content/Intent",
      "(Ljava/lang/String;Landroid/net/Uri;)V",
      &[JValue::Object(&action), JValue::Object(&uri)],
    )
    .map_err(|e| format!("JNI error: {e}"))?;
  env
    .call_method(
      &intent,
      "addFlags",
      "(I)Landroid/content/Intent;",
      &[JValue::Int(FLAG_ACTIVITY_NEW_TASK)],
    )
    .map_err(|e| format!("JNI error: {e}"))?;

  start_activity(env, activity, &intent, "the install permissions screen")
}

#[cfg(not(all(target_os = "android", feature = "sideload-updates")))]
fn open_install_permission_settings_impl(_app: &tauri::AppHandle) -> Result<(), String> {
  Err("This build gets its updates from the app store".to_string())
}