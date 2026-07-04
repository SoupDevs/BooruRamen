/*
 * BooruRamen - A personalized booru browser
 * Copyright (C) 2025 DottsGit
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
/**
 * DownloadService.js
 * Handles downloading post files to the user's filesystem.
 * In Tauri (desktop and Android) files are written directly to the
 * configured download directory with no save dialog. In plain browser
 * contexts it falls back to a standard anchor-click download.
 */

import { useSettingsStore } from '../stores/settings';
import httpFetch from './httpClient';

// Legacy default that older settings may still have persisted.
// Treated as "use the platform default" rather than a literal path.
const LEGACY_DEFAULT_LOCATION = '~/Downloads/BooruRamen';

// Public Downloads directory on Android. Tauri's downloadDir() resolves to
// the app-private external dir on Android, which is not what users expect,
// so the public collection path is used instead. Writing there via direct
// file paths works without permissions on Android 11+.
const ANDROID_PUBLIC_DOWNLOAD_DIR = '/storage/emulated/0/Download';

export function isTauri() {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
}

export function isAndroid() {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
}

/**
 * Get the default download path for the current platform.
 * Resolves to <Downloads>/BooruRamen.
 */
export async function getDefaultDownloadPath() {
  if (isTauri()) {
    if (isAndroid()) {
      return `${ANDROID_PUBLIC_DOWNLOAD_DIR}/BooruRamen`;
    }
    try {
      const { downloadDir } = await import('@tauri-apps/api/path');
      const dir = await downloadDir();
      return joinPath(dir, 'BooruRamen');
    } catch (error) {
      console.error('DownloadService: Failed to resolve download dir:', error);
    }
  }
  // Browser context: the browser controls the real location; this value is
  // only used for display in settings.
  return LEGACY_DEFAULT_LOCATION;
}

/**
 * Resolve the effective download location.
 * If the user has set a custom path, use that (expanding a leading "~").
 * Otherwise, default to the user's Downloads folder + /BooruRamen.
 */
export async function getDownloadLocation() {
  const store = useSettingsStore();
  const loc = (store.downloadLocation || '').trim();

  // Empty or the legacy default sentinel -> platform default
  if (!loc || loc === LEGACY_DEFAULT_LOCATION) {
    return getDefaultDownloadPath();
  }

  if (loc.startsWith('~') && isTauri()) {
    return expandHomePath(loc);
  }

  return loc;
}

/**
 * Expand a "~/..." path to an absolute path for the current platform.
 */
async function expandHomePath(loc) {
  const rest = loc.replace(/^~[/\\]?/, '');
  if (isAndroid()) {
    // Map "~/Downloads/..." (and "~/Download/...") to the public Downloads dir
    const mapped = rest.replace(/^Downloads?([/\\]|$)/, '');
    return mapped ? joinPath(ANDROID_PUBLIC_DOWNLOAD_DIR, mapped) : ANDROID_PUBLIC_DOWNLOAD_DIR;
  }
  try {
    const { homeDir } = await import('@tauri-apps/api/path');
    const home = await homeDir();
    return rest ? joinPath(home, rest) : home;
  } catch (error) {
    console.error('DownloadService: Failed to resolve home dir:', error);
    return loc;
  }
}

function joinPath(...parts) {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/[/\\]+$/, '') : p.replace(/^[/\\]+|[/\\]+$/g, '')))
    .filter(Boolean)
    .join('/');
}

/**
 * Resolve the directory a post should be saved into,
 * accounting for separate Liked/Favorited subfolders if enabled.
 */
export async function resolveDownloadDir(interactionType = 'liked') {
  const store = useSettingsStore();
  let dir = await getDownloadLocation();

  if (store.downloadSeparateFolders) {
    if (interactionType === 'liked') {
      dir = joinPath(dir, 'Liked');
    } else if (interactionType === 'favorited') {
      dir = joinPath(dir, 'Favorited');
    }
  }
  return dir;
}

/**
 * Resolve the full file path for a post download.
 */
export async function resolvePostPath(post, interactionType = 'liked') {
  const dir = await resolveDownloadDir(interactionType);
  return joinPath(dir, buildFilename(post));
}

/**
 * Build a safe filename from a post object.
 */
function buildFilename(post) {
  const id = post.id || 'unknown';
  const ext = post.file_ext || getFileExtensionFromUrl(post.file_url) || 'png';
  // Include source in filename to avoid collisions
  const source = post.source ? post.source.replace(/[^a-zA-Z0-9]/g, '') : '';
  const prefix = source ? `${source}_` : '';
  return `${prefix}${id}.${ext}`;
}

/**
 * Extract file extension from a URL.
 */
function getFileExtensionFromUrl(url) {
  if (!url) return null;
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.(\w+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Download a post's file to the user's filesystem.
 * In Tauri the download runs entirely on the Rust side (only the URL and
 * destination path cross the IPC bridge) so large videos don't stall the
 * WebView; the Rust command also handles the download notifications.
 * In the browser it falls back to an anchor download.
 *
 * @param {Object} post - The post object with file_url, id, file_ext, etc.
 * @param {string} interactionType - 'liked' or 'favorited'
 * @returns {Promise<boolean>} Whether the download succeeded.
 */
export async function downloadPost(post, interactionType = 'liked') {
  if (!post || !post.file_url) {
    console.warn('DownloadService: Post has no file_url, cannot download.');
    return false;
  }

  if (isTauri()) {
    const filePath = await resolvePostPath(post, interactionType);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('download_file', { url: post.file_url, path: filePath });
      console.log(`DownloadService: Saved ${filePath}`);
      return true;
    } catch (error) {
      console.error('DownloadService: Download failed:', error);
      return false;
    }
  }

  try {
    // Browser fallback: anchor-click download handled by the browser.
    const response = await httpFetch(post.file_url);
    if (!response.ok) {
      console.error(`DownloadService: Failed to fetch ${post.file_url} - ${response.status}`);
      return false;
    }
    const blob = await response.blob();
    const filename = buildFilename(post);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return true;
  } catch (error) {
    console.error('DownloadService: Download failed:', error);
    return false;
  }
}

/**
 * Delete everything inside the configured download directory.
 * Only available in Tauri; the browser has no filesystem access.
 */
export async function clearDownloads() {
  if (!isTauri()) {
    console.warn('DownloadService: Clearing downloads is only available in the app.');
    return false;
  }
  const dir = await getDownloadLocation();
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('clear_downloads', { path: dir });
  return true;
}

/**
 * Check if a post should be auto-downloaded based on the interaction type
 * and the current settings.
 */
export function shouldAutoDownload(interactionType) {
  const store = useSettingsStore();
  if (interactionType === 'like' && store.downloadLiked) return true;
  if (interactionType === 'favorite' && store.downloadFavorited) return true;
  return false;
}

export default {
  isTauri,
  isAndroid,
  getDownloadLocation,
  getDefaultDownloadPath,
  resolveDownloadDir,
  resolvePostPath,
  downloadPost,
  clearDownloads,
  shouldAutoDownload,
};
