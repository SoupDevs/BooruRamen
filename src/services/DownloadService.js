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
 * Works in three contexts:
 *   1. Tauri desktop (Windows/macOS/Linux) — uses native fs + dialog plugins
 *   2. Tauri mobile (Android/iOS) — uses native dialog for folder selection,
 *      then writes via the fs plugin (scoped storage on Android)
 *   3. Browser (web) — uses File System Access API when available,
 *      falls back to anchor-download with subpath encoded in filename
 */

import { useSettingsStore } from '../stores/settings';

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

let _isTauri = null;

export function isTauri() {
  if (_isTauri !== null) return _isTauri;
  _isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
  return _isTauri;
}

// ---------------------------------------------------------------------------
// Lazy-loaded Tauri plugins (only imported when running inside Tauri)
// ---------------------------------------------------------------------------

let _tauriFs = null;
let _tauriDialog = null;

async function getTauriFs() {
  if (_tauriFs !== null) return _tauriFs;
  try {
    _tauriFs = await import('@tauri-apps/plugin-fs');
  } catch {
    _tauriFs = false;
  }
  return _tauriFs;
}

async function getTauriDialog() {
  if (_tauriDialog !== null) return _tauriDialog;
  try {
    _tauriDialog = await import('@tauri-apps/plugin-dialog');
  } catch {
    _tauriDialog = false;
  }
  return _tauriDialog;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective download location.
 * Returns the user-configured path or the platform default.
 */
export function getDownloadLocation() {
  const store = useSettingsStore();
  if (store.downloadLocation) {
    return store.downloadLocation;
  }
  return getDefaultDownloadPath();
}

/**
 * Get the default download path for the current platform.
 */
export function getDefaultDownloadPath() {
  return '~/Downloads/BooruRamen';
}

/**
 * Resolve the full file path for a post download,
 * accounting for separate subfolders if enabled.
 * Returns a path like "BooruRamen/Liked/danbooru_12345.png"
 * (relative to the chosen base directory).
 */
export function resolvePostPath(post, interactionType = 'liked') {
  const store = useSettingsStore();
  const parts = [];

  if (store.downloadSeparateFolders) {
    if (interactionType === 'liked') {
      parts.push('Liked');
    } else if (interactionType === 'favorited') {
      parts.push('Favorited');
    }
  }

  const filename = buildFilename(post);
  parts.push(filename);
  return parts.join('/');
}

/**
 * Build a safe filename from a post object.
 */
function buildFilename(post) {
  const id = post.id || 'unknown';
  const ext = post.file_ext || getFileExtensionFromUrl(post.file_url) || 'png';
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

// ---------------------------------------------------------------------------
// Tauri native download (desktop + mobile)
// ---------------------------------------------------------------------------

/**
 * Download a post using the Tauri fs plugin.
 * Writes the file to <downloadLocation>/<resolvePostPath result>.
 * Creates intermediate directories as needed.
 */
async function downloadPostTauri(post, interactionType) {
  const fs = await getTauriFs();
  const dialog = await getTauriDialog();
  if (!fs) {
    throw new Error('Tauri fs plugin not available');
  }

  const store = useSettingsStore();
  const basePath = store.downloadLocation || getDefaultDownloadPath();
  const relativePath = resolvePostPath(post, interactionType);

  // Expand ~ to home directory
  const expandedBase = await expandPath(basePath);

  // Ensure the base directory exists
  try {
    await fs.mkdir(expandedBase, { recursive: true });
  } catch {
    // Directory may already exist — that's fine
  }

  // Ensure subdirectory exists if separate folders is enabled
  const fullPath = `${expandedBase}/${relativePath}`;
  const dirPart = fullPath.substring(0, fullPath.lastIndexOf('/'));
  if (dirPart && dirPart !== expandedBase) {
    try {
      await fs.mkdir(dirPart, { recursive: true });
    } catch {
      // Already exists
    }
  }

  // Fetch the file bytes using the unified httpClient (uses Tauri HTTP in production)
  const { httpFetch } = await import('../services/httpClient');
  const response = await httpFetch(post.file_url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${post.file_url}: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  // Write to disk
  await fs.writeFile(fullPath, bytes);

  console.log(`[DownloadService] Saved to ${fullPath}`);
  return true;
}

/**
 * Expand a path that starts with ~ to the user's home directory.
 * Uses Tauri's path API when available, otherwise returns as-is.
 */
async function expandPath(inputPath) {
  if (!inputPath.startsWith('~/')) return inputPath;

  try {
    const pathApi = await import('@tauri-apps/api/path');
    const homeDir = await pathApi.homeDir();
    return inputPath.replace('~', homeDir);
  } catch {
    // Fallback: return as-is (Tauri fs will handle it relative to BaseDirectory)
    return inputPath;
  }
}

// ---------------------------------------------------------------------------
// Browser download (File System Access API)
// ---------------------------------------------------------------------------

// Cache the directory handle across downloads in the same session
let _browserDirHandle = null;

/**
 * Browser download using the File System Access API.
 * Stores the directory handle so subsequent downloads go to the same place.
 */
async function downloadPostBrowserFS(post, interactionType) {
  const store = useSettingsStore();

  // If the user changed the location or we don't have a handle, we need a new one
  if (!_browserDirHandle) {
    // We can't silently get a handle — user must pick via browseDownloadFolder first
    // Fall back to anchor download
    return downloadPostBrowserAnchor(post, interactionType);
  }

  // Verify we still have permission
  const opts = { mode: 'readwrite' };
  if ((await _browserDirHandle.queryPermission(opts)) !== 'granted') {
    if ((await _browserDirHandle.requestPermission(opts)) !== 'granted') {
      return downloadPostBrowserAnchor(post, interactionType);
    }
  }

  // Build subdirectory if needed
  let parentHandle = _browserDirHandle;
  if (store.downloadSeparateFolders) {
    const subName = interactionType === 'liked' ? 'Liked' : 'Favorited';
    parentHandle = await _browserDirHandle.getDirectoryHandle(subName, { create: true });
  }

  // Fetch the file
  const response = await fetch(post.file_url);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  const blob = await response.blob();

  // Write via File System Access API
  const filename = buildFilename(post);
  const fileHandle = await parentHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();

  return true;
}

/**
 * Fallback browser download using anchor element.
 * Encodes the subpath in the filename since browsers ignore path in download attr.
 */
async function downloadPostBrowserAnchor(post, interactionType) {
  const store = useSettingsStore();
  const response = await fetch(post.file_url);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  const blob = await response.blob();

  const filename = buildFilename(post);
  // If separate folders is on, prefix the filename so the user knows the intended subfolder
  let downloadName = filename;
  if (store.downloadSeparateFolders) {
    const subName = interactionType === 'liked' ? 'Liked' : 'Favorited';
    downloadName = `${subName}_${filename}`;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Download a post's file to the user's filesystem.
 *
 * @param {Object} post - The post object with file_url, id, file_ext, etc.
 * @param {string} interactionType - 'liked' or 'favorited'
 * @returns {Promise<boolean>} Whether the download was initiated successfully.
 */
export async function downloadPost(post, interactionType = 'liked') {
  if (!post || !post.file_url) {
    console.warn('DownloadService: Post has no file_url, cannot download.');
    return false;
  }

  const store = useSettingsStore();

  // Don't download if neither auto-download setting is enabled
  if (!store.downloadLiked && !store.downloadFavorited) {
    return false;
  }

  try {
    if (isTauri()) {
      return await downloadPostTauri(post, interactionType);
    } else if (window.showDirectoryPicker && _browserDirHandle) {
      return await downloadPostBrowserFS(post, interactionType);
    } else {
      return await downloadPostBrowserAnchor(post, interactionType);
    }
  } catch (error) {
    console.error('DownloadService: Download failed:', error);
    return false;
  }
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

/**
 * Open a folder picker appropriate for the current platform.
 * @returns {Promise<{ok: boolean, path: string|null, message: string}>}
 */
export async function browseDownloadFolder() {
  // --- Tauri (desktop + mobile) ---
  if (isTauri()) {
    const dialog = await getTauriDialog();
    if (!dialog) {
      return { ok: false, path: null, message: 'Dialog plugin not available.' };
    }
    try {
      const selected = await dialog.open({
        directory: true,
        multiple: false,
        title: 'Select Download Folder',
        defaultPath: useSettingsStore().downloadLocation || '~/Downloads/BooruRamen',
      });
      if (selected) {
        return { ok: true, path: selected, message: `Selected: ${selected}` };
      }
      return { ok: false, path: null, message: 'Folder selection cancelled.' };
    } catch (err) {
      return { ok: false, path: null, message: `Could not open folder picker: ${err.message}` };
    }
  }

  // --- Browser with File System Access API (Chromium desktop) ---
  if (window.showDirectoryPicker) {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      _browserDirHandle = dirHandle;
      // We can only store the name for display; the actual handle is cached in memory
      return { ok: true, path: dirHandle.name, message: `Selected: ${dirHandle.name}` };
    } catch (err) {
      if (err.name !== 'AbortError') {
        return { ok: false, path: null, message: 'Could not open folder picker. Enter the path manually.' };
      }
      return { ok: false, path: null, message: 'Folder selection cancelled.' };
    }
  }

  // --- Fallback: manual path input ---
  const current = useSettingsStore().downloadLocation || '~/Downloads/BooruRamen';
  const path = prompt('Enter download folder path:', current);
  if (path !== null) {
    return { ok: true, path, message: `Path set to: ${path}` };
  }
  return { ok: false, path: null, message: 'Cancelled.' };
}

/**
 * Get the cached browser directory handle (for checking if a folder has been picked).
 */
export function getBrowserDirHandle() {
  return _browserDirHandle;
}

/**
 * Set the browser directory handle (e.g. after a successful browse).
 */
export function setBrowserDirHandle(handle) {
  _browserDirHandle = handle;
}

export default {
  isTauri,
  getDownloadLocation,
  getDefaultDownloadPath,
  resolvePostPath,
  downloadPost,
  shouldAutoDownload,
  browseDownloadFolder,
  getBrowserDirHandle,
  setBrowserDirHandle,
};
