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
 *   2. Tauri mobile (Android/iOS) — uses downloadDir() from path API as the base,
 *      fs plugin for writing. Folder picker via SAF dialog.
 *   3. Browser (web) — uses File System Access API when available,
 *      falls back to anchor-download with subpath encoded in filename
 *
 * Status callbacks via setStatusCallback(fn):
 *   fn({ state: 'idle'|'downloading'|'complete'|'error', message, progress, filename })
 */

import { useSettingsStore } from '../stores/settings';

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

let _isTauri = null;
let _isMobile = null;

export function isTauri() {
  if (_isTauri !== null) return _isTauri;
  _isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
  return _isTauri;
}

export function isMobile() {
  if (_isMobile !== null) return _isMobile;
  if (!isTauri()) {
    _isMobile = false;
    return false;
  }
  try {
    const ua = navigator.userAgent || '';
    _isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  } catch {
    _isMobile = false;
  }
  return _isMobile;
}

// ---------------------------------------------------------------------------
// Lazy-loaded Tauri plugins
// ---------------------------------------------------------------------------

let _tauriFs = null;
let _tauriDialog = null;
let _tauriPath = null;

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

async function getTauriPath() {
  if (_tauriPath !== null) return _tauriPath;
  try {
    _tauriPath = await import('@tauri-apps/api/path');
  } catch {
    _tauriPath = false;
  }
  return _tauriPath;
}

// ---------------------------------------------------------------------------
// Status callback (set by App.vue for UI indicator)
// ---------------------------------------------------------------------------

let _statusCallback = null;

export function setStatusCallback(fn) {
  _statusCallback = fn;
}

function reportStatus(state, message = '', progress = 0, filename = '') {
  if (_statusCallback) {
    _statusCallback({ state, message, progress, filename });
  }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective download base location.
 */
export async function getDownloadLocation() {
  const store = useSettingsStore();
  if (store.downloadLocation) {
    const expanded = await expandPath(store.downloadLocation);
    return expanded;
  }
  return getDefaultDownloadPath();
}

/**
 * Get the default download path for the current platform.
 */
export async function getDefaultDownloadPath() {
  if (isTauri()) {
    const tp = await getTauriPath();
    if (tp) {
      try {
        return await tp.downloadDir();
      } catch {
        try {
          return await tp.documentDir();
        } catch {
          return await tp.appLocalDataDir();
        }
      }
    }
  }
  return '~/Downloads/BooruRamen';
}

/**
 * Resolve the relative file path for a post download.
 * Returns something like "Liked/danbooru_12345.png"
 */
export function resolvePostSubPath(post, interactionType = 'liked') {
  const store = useSettingsStore();
  const parts = [];

  if (store.downloadSeparateFolders) {
    if (interactionType === 'liked') {
      parts.push('Liked');
    } else if (interactionType === 'favorited') {
      parts.push('Favorited');
    }
  }

  parts.push(buildFilename(post));
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
    const match = pathname.match(/\.(\w+)(?:\?.*)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Expand a path that starts with ~ to the user's home directory.
 */
async function expandPath(inputPath) {
  if (!inputPath || !inputPath.startsWith('~/')) return inputPath;

  try {
    const tp = await getTauriPath();
    if (tp) {
      const homeDir = await tp.homeDir();
      return inputPath.replace('~', homeDir);
    }
  } catch {
    // fallback
  }
  return inputPath;
}

/**
 * Ensure a directory exists, creating parent dirs as needed.
 */
async function ensureDir(dirPath) {
  const fs = await getTauriFs();
  if (!fs) return;

  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // Already exists or cannot create
  }
}

// ---------------------------------------------------------------------------
// Tauri download (desktop + mobile unified)
// ---------------------------------------------------------------------------

/**
 * Download a post using the Tauri fs plugin.
 */
async function downloadPostTauri(post, interactionType) {
  const store = useSettingsStore();

  reportStatus('downloading', 'Preparing download...', 5, buildFilename(post));

  const basePath = await getDownloadLocation();
  const subPath = resolvePostSubPath(post, interactionType);

  reportStatus('downloading', 'Creating directories...', 10, buildFilename(post));

  // Ensure base directory exists
  await ensureDir(basePath);

  // Ensure subdirectory exists if separate folders is enabled
  if (store.downloadSeparateFolders) {
    const subDir = `${basePath}/${interactionType === 'liked' ? 'Liked' : 'Favorited'}`;
    await ensureDir(subDir);
  }

  const fullPath = `${basePath}/${subPath}`;

  reportStatus('downloading', 'Fetching file...', 20, buildFilename(post));

  // Fetch the file bytes using our unified httpClient (Tauri HTTP plugin in production)
  const { httpFetch } = await import('../services/httpClient');
  const response = await httpFetch(post.file_url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${post.file_url}: ${response.status}`);
  }

  reportStatus('downloading', 'Receiving data...', 40, buildFilename(post));

  const bytes = new Uint8Array(await response.arrayBuffer());

  reportStatus('downloading', 'Writing to disk...', 80, buildFilename(post));

  const fs = await getTauriFs();
  if (!fs) throw new Error('FS plugin not available');

  await fs.writeFile(fullPath, bytes);

  reportStatus('complete', `Saved: ${subPath}`, 100, buildFilename(post));

  console.log(`[DownloadService] Saved to ${fullPath}`);
  return { success: true, path: fullPath };
}

// ---------------------------------------------------------------------------
// Browser download (File System Access API)
// ---------------------------------------------------------------------------

let _browserDirHandle = null;

async function downloadPostBrowserFS(post, interactionType) {
  const store = useSettingsStore();

  if (!_browserDirHandle) {
    return downloadPostBrowserAnchor(post, interactionType);
  }

  const opts = { mode: 'readwrite' };
  try {
    if ((await _browserDirHandle.queryPermission(opts)) !== 'granted') {
      if ((await _browserDirHandle.requestPermission(opts)) !== 'granted') {
        return downloadPostBrowserAnchor(post, interactionType);
      }
    }
  } catch {
    return downloadPostBrowserAnchor(post, interactionType);
  }

  reportStatus('downloading', 'Fetching file...', 20, buildFilename(post));

  const response = await fetch(post.file_url);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

  reportStatus('downloading', 'Receiving data...', 40, buildFilename(post));

  const blob = await response.blob();

  let parentHandle = _browserDirHandle;

  if (store.downloadSeparateFolders) {
    const subName = interactionType === 'liked' ? 'Liked' : 'Favorited';
    parentHandle = await _browserDirHandle.getDirectoryHandle(subName, { create: true });
  }

  const filename = buildFilename(post);
  const fileHandle = await parentHandle.getFileHandle(filename, { create: true });

  reportStatus('downloading', 'Writing to disk...', 80, filename);

  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();

  reportStatus('complete', `Saved: ${filename}`, 100, filename);
  return { success: true, path: filename };
}

async function downloadPostBrowserAnchor(post, interactionType) {
  const store = useSettingsStore();

  reportStatus('downloading', 'Fetching file...', 30, buildFilename(post));

  const response = await fetch(post.file_url);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

  reportStatus('downloading', 'Receiving data...', 60, buildFilename(post));

  const blob = await response.blob();

  const filename = buildFilename(post);
  let downloadName = filename;
  if (store.downloadSeparateFolders) {
    const subName = interactionType === 'liked' ? 'Liked' : 'Favorited';
    downloadName = `${subName}_${filename}`;
  }

  reportStatus('downloading', 'Saving...', 90, filename);

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  reportStatus('complete', `Saved: ${filename}`, 100, filename);
  return { success: true, path: downloadName };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Download a post's file to the user's filesystem.
 *
 * @param {Object} post - The post object with file_url, id, file_ext, etc.
 * @param {string} interactionType - 'liked' or 'favorited'
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
export async function downloadPost(post, interactionType = 'liked') {
  if (!post || !post.file_url) {
    console.warn('DownloadService: Post has no file_url, cannot download.');
    reportStatus('error', 'No file URL', 0, '');
    return { success: false };
  }

  const store = useSettingsStore();

  // Don't download if neither auto-download setting is enabled
  if (!store.downloadLiked && !store.downloadFavorited) {
    return { success: false };
  }

  reportStatus('downloading', 'Starting download...', 0, buildFilename(post));

  try {
    let result;
    if (isTauri()) {
      result = await downloadPostTauri(post, interactionType);
    } else if (window.showDirectoryPicker && _browserDirHandle) {
      result = await downloadPostBrowserFS(post, interactionType);
    } else {
      result = await downloadPostBrowserAnchor(post, interactionType);
    }
    setTimeout(() => reportStatus('idle'), 2000);
    return result;
  } catch (error) {
    console.error('DownloadService: Download failed:', error);
    reportStatus('error', error.message || 'Download failed', 0, buildFilename(post));
    setTimeout(() => reportStatus('idle'), 4000);
    return { success: false, error: error.message };
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
 * Get information about where downloads will go (for display in UI).
 */
export async function getDownloadInfo() {
  const store = useSettingsStore();
  const base = await getDownloadLocation();
  return {
    basePath: base,
    separateFolders: store.downloadSeparateFolders,
    platform: isMobile() ? 'mobile' : (isTauri() ? 'desktop' : 'browser'),
  };
}

/**
 * Open a folder picker appropriate for the current platform.
 *
 * @returns {Promise<{ok: boolean, path: string|null, message: string}>}
 */
export async function browseDownloadFolder() {
  // --- Tauri desktop ---
  if (isTauri() && !isMobile()) {
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

  // --- Tauri mobile (Android/iOS) ---
  if (isTauri() && isMobile()) {
    const dialog = await getTauriDialog();
    if (!dialog) {
      return { ok: false, path: null, message: 'Dialog plugin not available.' };
    }
    try {
      const selected = await dialog.open({
        directory: true,
        multiple: false,
        title: 'Select Download Folder',
        recursive: true,
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
      const name = dirHandle.name;
      return { ok: true, path: name, message: `Selected: ${name}` };
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

export function getBrowserDirHandle() {
  return _browserDirHandle;
}

export function setBrowserDirHandle(handle) {
  _browserDirHandle = handle;
}

export default {
  isTauri,
  isMobile,
  getDownloadLocation,
  getDefaultDownloadPath,
  resolvePostSubPath,
  downloadPost,
  shouldAutoDownload,
  getDownloadInfo,
  getBrowserDirHandle,
  setBrowserDirHandle,
  setStatusCallback,
};
