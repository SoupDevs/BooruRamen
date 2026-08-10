/*
 * BooruRamen - A personalized booru browser
 * Copyright (C) 2025 SoupDevs
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { httpFetch } from './httpClient.js';

const GELBOORU_REFERER = 'https://gelbooru.com/';

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

    // Tauri's HTTP plugin permits the required Referer header. A blob URL lets
    // the WebView display the authenticated response without a second request.
    const response = await httpFetch(url, {
        headers: {
            Referer: GELBOORU_REFERER,
        },
    });

    if (!response.ok) {
        throw new Error(`Gelbooru media request failed with status ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
        throw new Error('Gelbooru returned its hotlink page instead of media');
    }

    return URL.createObjectURL(await response.blob());
}

export function releaseDisplayableMediaUrl(url) {
    if (url && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }
}

