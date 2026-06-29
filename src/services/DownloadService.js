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
 * Works in both web and Tauri contexts.
 */

import { useSettingsStore } from '../stores/settings';

/**
 * Resolve the effective download location.
 * If the user has set a custom path, use that.
 * Otherwise, default to the user's Downloads folder + /BooruRamen.
 */
export function getDownloadLocation() {
  const store = useSettingsStore();
  if (store.downloadLocation) {
    return store.downloadLocation;
  }
  // Default: ~/Downloads/BooruRamen (cross-platform convention)
  // In browsers we can't resolve ~, so we return a sensible default
  // that the download function will handle.
  return getDefaultDownloadPath();
}

/**
 * Get the default download path for the current platform.
 */
export function getDefaultDownloadPath() {
  // In Tauri, we could use the API to get the download dir.
  // For browser context, we use a conventional path that the
  // browser download will handle via the filename suggestion.
  return '~/Downloads/BooruRamen';
}

/**
 * Resolve the full file path for a post download,
 * accounting for separate subfolders if enabled.
 */
export function resolvePostPath(post, interactionType = 'liked') {
  const store = useSettingsStore();
  const basePath = getDownloadLocation();
  const parts = [basePath];

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
 * Uses the browser's download API (blob + anchor click).
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
    // Fetch the file
    const response = await fetch(post.file_url);
    if (!response.ok) {
      console.error(`DownloadService: Failed to fetch ${post.file_url} - ${response.status}`);
      return false;
    }

    const blob = await response.blob();
    const filePath = resolvePostPath(post, interactionType);

    // Extract just the filename for the browser download API
    const filename = filePath.split('/').pop();

    // Trigger browser download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    // The download attribute suggests the filename; the browser puts it
    // in the user's default download directory. For path control we'd
    // need Tauri's fs API, but this works for the common case.
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
  getDownloadLocation,
  getDefaultDownloadPath,
  resolvePostPath,
  downloadPost,
  shouldAutoDownload,
};
