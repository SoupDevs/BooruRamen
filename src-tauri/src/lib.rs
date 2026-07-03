// BooruRamen - A personalized booru browser
// Copyright (C) 2025 DottsGit
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/// Download a file natively so the bytes never cross the WebView IPC bridge.
/// Streaming large videos through JS froze the UI on Android and could OOM.
#[tauri::command]
async fn download_file(url: String, path: String) -> Result<(), String> {
  use std::io::Write;

  let parent = std::path::Path::new(&path)
    .parent()
    .ok_or_else(|| "Invalid download path".to_string())?;
  std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;

  let client = tauri_plugin_http::reqwest::Client::new();
  let mut response = client
    .get(&url)
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
    .invoke_handler(tauri::generate_handler![download_file])
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
