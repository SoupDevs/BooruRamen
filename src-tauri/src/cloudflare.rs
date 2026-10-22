// BooruRamen - A personalized booru browser
// Copyright (C) 2025 SoupDevs
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Lets the user pass a site's Cloudflare check themselves.
//!
//! Some networks (VPN exit servers especially) get every API request
//! answered with a Cloudflare challenge. A person can pass that challenge in
//! a browser, so the app shows the site in its own WebView, waits for the
//! `cf_clearance` cookie Cloudflare sets on success, then returns to the app.
//! The frontend reads the cookie back with `cloudflare_cookies` and sends it
//! (with the WebView's User-Agent, which the clearance is tied to) on that
//! site's API requests.

use std::sync::Mutex;
use tauri::{webview::PageLoadEvent, Manager, Url, Webview};

const CLEARANCE_COOKIE: &str = "cf_clearance";

/// A verification in progress: the site being verified, the app page to go
/// back to, and the clearance the site had when it started (an expired one
/// must not count as passing).
#[derive(Default)]
pub struct PendingVerification(Mutex<Option<Pending>>);

#[derive(Clone)]
struct Pending {
  site: Url,
  back: Url,
  stale_clearance: Option<String>,
}

fn https_url(url: &str) -> Result<Url, String> {
  let url = Url::parse(url).map_err(|e| e.to_string())?;
  if url.scheme() != "https" || url.host_str().is_none() {
    return Err("Only https sites can be verified".into());
  }
  Ok(url)
}

/// The cookies the WebView holds for `url`, as a `Cookie` header value.
#[cfg(not(target_os = "android"))]
fn cookie_header<R: tauri::Runtime>(webview: &Webview<R>, url: &Url) -> Result<String, String> {
  let cookies = webview.cookies_for_url(url.clone()).map_err(|e| e.to_string())?;
  Ok(
    cookies
      .iter()
      .map(|c| format!("{}={}", c.name(), c.value()))
      .collect::<Vec<_>>()
      .join("; "),
  )
}

/// Android: asks CookieManager directly. wry's own cookie read crashes the
/// app when a site has no cookies yet (its Kotlin helper returns the null
/// from CookieManager as a non-null String, and the resulting exception
/// aborts the process), which is exactly the state before a first check.
#[cfg(target_os = "android")]
fn cookie_header<R: tauri::Runtime>(webview: &Webview<R>, url: &Url) -> Result<String, String> {
  let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
  let url = url.to_string();
  webview
    .with_webview(move |platform| {
      platform.jni_handle().exec(move |env, _activity, _webview| {
        let result = android_cookie_header(env, &url);
        if env.exception_check().unwrap_or(false) {
          let _ = env.exception_describe();
          let _ = env.exception_clear();
        }
        let _ = tx.send(result);
      });
    })
    .map_err(|e| e.to_string())?;
  rx.recv_timeout(std::time::Duration::from_secs(10))
    .map_err(|_| "Reading the WebView's cookies timed out".to_string())?
}

#[cfg(target_os = "android")]
fn android_cookie_header(env: &mut jni::JNIEnv, url: &str) -> Result<String, String> {
  use jni::objects::JString;

  let manager = env
    .call_static_method(
      "android/webkit/CookieManager",
      "getInstance",
      "()Landroid/webkit/CookieManager;",
      &[],
    )
    .and_then(|v| v.l())
    .map_err(|e| e.to_string())?;
  let url = env.new_string(url).map_err(|e| e.to_string())?;
  let value = env
    .call_method(
      &manager,
      "getCookie",
      "(Ljava/lang/String;)Ljava/lang/String;",
      &[(&url).into()],
    )
    .and_then(|v| v.l())
    .map_err(|e| e.to_string())?;
  if value.is_null() {
    return Ok(String::new());
  }
  let value = JString::from(value);
  let value = env.get_string(&value).map_err(|e| e.to_string())?;
  Ok(value.into())
}

fn clearance<R: tauri::Runtime>(webview: &Webview<R>, site: &Url) -> Option<String> {
  clearance_in(&cookie_header(webview, site).ok()?)
}

fn clearance_in(header: &str) -> Option<String> {
  header
    .split(';')
    .filter_map(|pair| pair.trim().split_once('='))
    .find(|(name, _)| *name == CLEARANCE_COOKIE)
    .map(|(_, value)| value.to_string())
}

// Both commands are async so they run off the main thread: on Android,
// reading cookies waits on the UI thread, which a sync command would block.

/// Shows `url` in this webview so the user can pass the Cloudflare check.
#[tauri::command]
pub async fn cloudflare_verify<R: tauri::Runtime>(
  webview: Webview<R>,
  state: tauri::State<'_, PendingVerification>,
  url: String,
) -> Result<(), String> {
  let site = https_url(&url)?;
  let back = webview.url().map_err(|e| e.to_string())?;
  let stale_clearance = clearance(&webview, &site);
  *state.0.lock().unwrap() = Some(Pending { site: site.clone(), back, stale_clearance });
  webview.navigate(site).map_err(|e| e.to_string())
}

/// The cookies this app's WebView holds for `url`, as a `Cookie` header value.
#[tauri::command]
pub async fn cloudflare_cookies<R: tauri::Runtime>(webview: Webview<R>, url: String) -> Result<String, String> {
  let url = https_url(&url)?;
  cookie_header(&webview, &url)
}

/// Page-load hook: while a verification is pending and the site has loaded,
/// go back to the app once the clearance cookie exists; until then show a
/// bar with a way back.
pub fn on_page_load<R: tauri::Runtime>(webview: &Webview<R>, url: &Url, event: PageLoadEvent) {
  if !matches!(event, PageLoadEvent::Finished) {
    return;
  }
  // Cookie reads wait on the UI thread, which is the thread running this hook.
  let webview = webview.clone();
  let url = url.clone();
  tauri::async_runtime::spawn(async move { after_page_load(&webview, &url) });
}

fn after_page_load<R: tauri::Runtime>(webview: &Webview<R>, url: &Url) {
  let state = webview.state::<PendingVerification>();
  let Some(Pending { site, back, stale_clearance }) = state.0.lock().unwrap().clone() else {
    return;
  };
  if url.host_str() != site.host_str() {
    return;
  }

  let current = clearance(webview, &site);
  if current.is_some() && current != stale_clearance {
    *state.0.lock().unwrap() = None;
    let _ = webview.navigate(back);
    return;
  }

  // The site's page has no access to the app; the bar only links back to it.
  let back = serde_json::to_string(back.as_str()).unwrap_or_else(|_| "\"/\"".into());
  let _ = webview.eval(format!(
    r#"(function () {{
  if (document.getElementById('booruramen-verify-bar')) return;
  var bar = document.createElement('div');
  bar.id = 'booruramen-verify-bar';
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px;background:#111827;color:#fff;font:14px system-ui,sans-serif;box-shadow:0 -2px 8px rgba(0,0,0,.4)';
  var text = document.createElement('span');
  text.textContent = 'Complete the check above. BooruRamen will reopen once it passes.';
  var link = document.createElement('a');
  link.href = {back};
  link.textContent = 'Back to BooruRamen';
  link.style.cssText = 'color:#f472b6;font-weight:600;white-space:nowrap';
  bar.appendChild(text);
  bar.appendChild(link);
  (document.body || document.documentElement).appendChild(bar);
}})();"#
  ));
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn only_https_sites_can_be_verified() {
    assert!(https_url("https://danbooru.donmai.us/").is_ok());
    assert!(https_url("http://danbooru.donmai.us/").is_err());
    assert!(https_url("javascript:alert(1)").is_err());
    assert!(https_url("not a url").is_err());
  }

  #[test]
  fn finds_the_clearance_cookie_in_a_cookie_header() {
    assert_eq!(clearance_in("a=1; cf_clearance=abc.def=; b=2"), Some("abc.def=".into()));
    assert_eq!(clearance_in("cf_clearance_x=1"), None);
    assert_eq!(clearance_in(""), None);
  }
}
