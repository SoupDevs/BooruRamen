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

    // CDN URLs (danbooru) are behind Cloudflare bot protection.
    // Server-side proxies (Vite middleware, Node.js) get 403 (TLS fingerprinting).
    // Browser fetch/XHR are blocked by CORP (no CORS headers from CDN).
    // Direct <video> src works natively — browser solves Cloudflare challenge.
    // Return the original URL and let the browser handle it.
    return url;
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
