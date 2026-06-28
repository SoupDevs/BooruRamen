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
 * videoProxy.js
 * Proxies video URLs through Tauri HTTP to create blob URLs for playback.
 * This bypasses CORS issues in Tauri production builds.
 */

import { httpFetch } from './httpClient.js';

// Check if we're running in a Tauri context
const isTauri = () => {
    return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
};

// Cache for blob URLs to avoid re-fetching
const blobUrlCache = new Map();
let proxyWarningShown = false;

/**
 * Get a playable video URL. In dev mode, attempts to fetch through Vite middleware
 * to bypass CDN restrictions. Falls back to original URL if proxy fails.
 * @param {string} url - The original video URL
 * @returns {Promise<string>} - A blob URL or the original URL
 */
export async function getPlayableVideoUrl(url) {
    if (!url) return url;

    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url);
    if (!isVideo) return url;

    if (blobUrlCache.has(url)) {
        return blobUrlCache.get(url);
    }

    // In dev mode, try local Vite middleware to bypass CDN restrictions
    let fetchUrl = url;
    if (import.meta.env && import.meta.env.DEV) {
      fetchUrl = `/video-proxy/${encodeURIComponent(url)}`;
    }

    try {
        const response = await httpFetch(fetchUrl, { method: 'GET' });

        if (!response.ok) {
            // CDN blocked the request — fall back to direct URL
            return url;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('video/') && !contentType.startsWith('application/octet-stream')) {
            // Got HTML (Cloudflare challenge) instead of video — fall back
            if (import.meta.env.DEV && !proxyWarningShown) {
                proxyWarningShown = true;
                console.warn('[VideoProxy] CDN proxy unavailable — videos will load directly from CDN (subject to Cloudflare restrictions)');
            }
            return url;
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        blobUrlCache.set(url, blobUrl);
        return blobUrl;
    } catch (error) {
        return url; // Fall back to original URL
    }
}

/**
 * Revoke a blob URL to free memory
 * @param {string} blobUrl - The blob URL to revoke
 */
export function revokeBlobUrl(blobUrl) {
    if (blobUrl && blobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(blobUrl);
        // Remove from cache
        for (const [originalUrl, cachedBlobUrl] of blobUrlCache.entries()) {
            if (cachedBlobUrl === blobUrl) {
                blobUrlCache.delete(originalUrl);
                break;
            }
        }
    }
}

/**
 * Clear all cached blob URLs
 */
export function clearBlobCache() {
    for (const blobUrl of blobUrlCache.values()) {
        URL.revokeObjectURL(blobUrl);
    }
    blobUrlCache.clear();
}

export default {
    getPlayableVideoUrl,
    revokeBlobUrl,
    clearBlobCache
};
