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
 * Get a playable video URL. In dev mode, fetches the video through Vite proxy
 * and creates a blob URL to bypass CORP restrictions. In Tauri production,
 * uses Tauri HTTP to fetch as blob.
 * @param {string} url - The original video URL
 * @returns {Promise<string>} - A playable URL (blob URL or proxied URL)
 */
export async function getPlayableVideoUrl(url) {
    if (!url) return url;

    // Check if it's a video URL that needs proxying
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url);
    if (!isVideo) return url;

    // Rewrite CDN URLs to use Vite proxy in dev mode
    let proxiedUrl = url;
    if (import.meta.env && import.meta.env.DEV) {
        proxiedUrl = url
            .replace('https://cdn.donmai.us/', '/danbooru-cdn/')
            .replace('https://video-cdn4.gelbooru.com/', '/gelbooru-video/');
    }

    // In Tauri production, fetch as blob
    if (isTauri()) {
        // Check cache first
        if (blobUrlCache.has(url)) {
            return blobUrlCache.get(url);
        }

        try {
            console.log('[VideoProxy] Fetching video as blob:', url);
            const response = await httpFetch(url, {
                method: 'GET',
            });

            if (!response.ok) {
                console.error('[VideoProxy] Failed to fetch video:', response.status);
                return proxiedUrl; // Fall back to proxied URL
            }

            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);

            // Cache the blob URL
            blobUrlCache.set(url, blobUrl);
            console.log('[VideoProxy] Created blob URL for video');

            return blobUrl;
        } catch (error) {
            console.error('[VideoProxy] Error proxying video:', error);
            return proxiedUrl; // Fall back to proxied URL
        }
    }

    return proxiedUrl;
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
