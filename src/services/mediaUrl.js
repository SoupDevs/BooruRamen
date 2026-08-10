/*
 * BooruRamen - A personalized booru browser
 * Copyright (C) 2025 SoupDevs
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

export function isGelbooruMediaUrl(url) {
    if (!url) return false;

    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return hostname === 'gelbooru.com' || hostname.endsWith('.gelbooru.com');
    } catch {
        return false;
    }
}

/**
 * Resolve a URL that an img/video element can load without triggering
 * Gelbooru's anti-hotlink redirect.
 */
export async function getDisplayableMediaUrl(url) {
    if (!isGelbooruMediaUrl(url)) return url;

    // Browsers cannot set Referer themselves, so Vite supplies it server-side.
    if (import.meta.env && import.meta.env.DEV) {
        return `/gelbooru-media?url=${encodeURIComponent(url)}`;
    }

    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined) {
        const { convertFileSrc, invoke } = await import('@tauri-apps/api/core');
        const cachedPath = await invoke('cache_gelbooru_media', { url });
        return convertFileSrc(cachedPath);
    }

    throw new Error('Gelbooru media requires the Vite proxy or a packaged Tauri app');
}

export function releaseDisplayableMediaUrl(url) {
    if (url && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }
}

