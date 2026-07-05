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

use serde::Deserialize;
use tauri::Emitter;

#[derive(Debug, Deserialize)]
pub struct UpdateAsset {
  pub name: String,
  pub url: String,
}

/// Emit download progress to the webview. Best-effort: progress display
/// failing is no reason to abort an update.
#[cfg(any(windows, target_os = "android"))]
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
#[cfg(any(windows, target_os = "android"))]
async fn download_installer(
  app: &tauri::AppHandle,
  url: &str,
  dest: &std::path::Path,
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
  Ok(())
}

#[cfg(any(windows, target_os = "android"))]
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
  download_installer(&app, &asset.url, &dest).await?;
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

#[cfg(target_os = "android")]
async fn perform_install(app: tauri::AppHandle, asset: &UpdateAsset) -> Result<(), String> {
  use tauri::Manager;

  // Must match the <cache-path path="updates/"> of the update FileProvider
  // that the release workflow patches into AndroidManifest.xml.
  let dest = app
    .path()
    .app_cache_dir()
    .map_err(|e| e.to_string())?
    .join("updates")
    .join(filename_from_url(&asset.url));
  download_installer(&app, &asset.url, &dest).await?;
  emit_progress(&app, "installing", 0, 0);

  install_apk(&dest.to_string_lossy())
}

/// Fire the system package-installer for a downloaded APK, equivalent to:
///
/// ```java
/// Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".updates.provider", file);
/// Intent intent = new Intent(Intent.ACTION_VIEW);
/// intent.setDataAndType(uri, "application/vnd.android.package-archive");
/// intent.addFlags(FLAG_ACTIVITY_NEW_TASK | FLAG_GRANT_READ_URI_PERMISSION);
/// ctx.startActivity(intent);
/// ```
///
/// The user still confirms the install in the system dialog - Android does
/// not allow sideloaded apps to replace themselves fully silently. Once the
/// app is distributed through Google Play this whole path goes away.
#[cfg(target_os = "android")]
fn install_apk(apk_path: &str) -> Result<(), String> {
  let ctx = ndk_context::android_context();
  let vm =
    unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
  let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
  let context = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };

  let result = fire_install_intent(&mut env, &context, apk_path);
  if let Err(e) = &result {
    // Surface any pending Java exception in logcat, then recover.
    if env.exception_check().unwrap_or(false) {
      let _ = env.exception_describe();
      let _ = env.exception_clear();
    }
    return Err(format!("Failed to open the package installer: {e}"));
  }
  Ok(())
}

#[cfg(target_os = "android")]
fn fire_install_intent(
  env: &mut jni::JNIEnv,
  context: &jni::objects::JObject,
  apk_path: &str,
) -> jni::errors::Result<()> {
  use jni::objects::{JClass, JString, JValue};

  const FLAG_GRANT_READ_URI_PERMISSION: i32 = 0x0000_0001;
  const FLAG_ACTIVITY_NEW_TASK: i32 = 0x1000_0000;

  // FileProvider is an androidx class, invisible to the JVM's system class
  // loader that FindClass uses on native threads. Load it through the app
  // context's own class loader instead.
  let class_loader = env
    .call_method(context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?
    .l()?;
  let provider_name = env.new_string("androidx.core.content.FileProvider")?;
  let provider_class: JClass = env
    .call_method(
      &class_loader,
      "loadClass",
      "(Ljava/lang/String;)Ljava/lang/Class;",
      &[JValue::Object(&provider_name)],
    )?
    .l()?
    .into();

  let package_name = env
    .call_method(context, "getPackageName", "()Ljava/lang/String;", &[])?
    .l()?;
  let package_name: String = env.get_string(&JString::from(package_name))?.into();
  let authority = env.new_string(format!("{package_name}.updates.provider"))?;

  let path = env.new_string(apk_path)?;
  let file = env.new_object(
    "java/io/File",
    "(Ljava/lang/String;)V",
    &[JValue::Object(&path)],
  )?;

  let uri = env
    .call_static_method(
      provider_class,
      "getUriForFile",
      "(Landroid/content/Context;Ljava/lang/String;Ljava/io/File;)Landroid/net/Uri;",
      &[
        JValue::Object(context),
        JValue::Object(&authority),
        JValue::Object(&file),
      ],
    )?
    .l()?;

  let action = env.new_string("android.intent.action.VIEW")?;
  let intent = env.new_object(
    "android/content/Intent",
    "(Ljava/lang/String;)V",
    &[JValue::Object(&action)],
  )?;
  let mime = env.new_string("application/vnd.android.package-archive")?;
  env.call_method(
    &intent,
    "setDataAndType",
    "(Landroid/net/Uri;Ljava/lang/String;)Landroid/content/Intent;",
    &[JValue::Object(&uri), JValue::Object(&mime)],
  )?;
  env.call_method(
    &intent,
    "addFlags",
    "(I)Landroid/content/Intent;",
    &[JValue::Int(
      FLAG_ACTIVITY_NEW_TASK | FLAG_GRANT_READ_URI_PERMISSION,
    )],
  )?;
  env.call_method(
    context,
    "startActivity",
    "(Landroid/content/Intent;)V",
    &[JValue::Object(&intent)],
  )?;
  Ok(())
}

#[cfg(not(any(windows, target_os = "android")))]
async fn perform_install(_app: tauri::AppHandle, _asset: &UpdateAsset) -> Result<(), String> {
  Err("Automatic updates are not supported on this platform yet".to_string())
}
