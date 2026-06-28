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

/**
 * Get a playable video URL. Fetches the video as a blob URL to bypass
 * CORP/CORS restrictions from CDN providers (Danbooru, Gelbooru).
 * In dev mode, uses Vite proxy paths. In Tauri production, uses Tauri HTTP.
 * @param {string} url - The original video URL
 * @returns {Promise<string>} - A blob URL for playback
 */
export async function getPlayableVideoUrl(url) {
    if (!url) return url;

    // Check if it's a video URL that needs proxying
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url);
    if (!isVideo) return url;

    // Check cache first
    if (blobUrlCache.has(url)) {
        return blobUrlCache.get(url);
    }

    // In dev mode, use a public CORS proxy to bypass CDN restrictions
    let fetchUrl = url;
    if (import.meta.env && import.meta.env.DEV) {
        fetchUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    }

    try {
        console.log('[VideoProxy] Fetching video as blob:', fetchUrl);
        const response = await httpFetch(fetchUrl, {
            method: 'GET',
        });

        if (!response.ok) {
            console.error('[VideoProxy] Failed to fetch video:', response.status);
            return url; // Fall back to original URL
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        // Cache the blob URL
        blobUrlCache.set(url, blobUrl);
        console.log('[VideoProxy] Created blob URL for video');

        return blobUrl;
    } catch (error) {
        console.error('[VideoProxy] Error proxying video:', error);
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
