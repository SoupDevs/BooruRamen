/*
 * BooruRamen - A personalized booru browser
 * Copyright (C) 2025 SoupDevs
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

/**
 * Anti-hotlink media support.
 *
 * Some boorus refuse to serve a file unless the request carries a Referer from
 * their own pages. A browser cannot set Referer for an <img>/<video>, so those
 * files are fetched through a layer that can: the Vite dev server (browser) or
 * a native Tauri command (packaged app).
 *
 * Which hosts need this is not a fixed list — the user can configure any booru,
 * so sources register themselves here (see registerRefererMediaSources) and a
 * media URL is matched against them by site. Boorus that serve files happily
 * without a Referer are untouched: getDisplayableMediaUrl returns their URL
 * as-is.
 */

import { clearanceHeaders, clearanceOrigins } from './cloudflareVerify.js';

// Built-in booru whose media is known to need a Referer. Kept permanent so
// media already in a feed keeps working even if the source is disabled.
const BUILTIN_REFERER_SOURCES = [
    { host: 'gelbooru.com', referer: 'https://gelbooru.com/' },
];

// Two-part public suffixes (co.uk, com.au, …) so the derived referer and the
// site match do not collapse to just "co.uk".
const COMPOUND_PUBLIC_SUFFIXES = new Set([
    'co', 'com', 'org', 'net', 'gov', 'ac', 'edu',
]);

let refererSources = [...BUILTIN_REFERER_SOURCES];

function safeHost(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return '';
    }
}

/** Split a hostname into labels, dropping empty parts. */
function hostLabels(host) {
    return String(host || '')
        .toLowerCase()
        .split('.')
        .filter(Boolean);
}

/** Do two hosts belong to the same site (shared trailing labels)? */
export function hostsShareSite(a, b) {
    const hostA = String(a || '').toLowerCase();
    const hostB = String(b || '').toLowerCase();
    // Addresses (self-hosted boorus) have no labels to share: require equality.
    if (isAddressHost(hostA) || isAddressHost(hostB)) return hostA === hostB;

    const left = hostLabels(hostA);
    const right = hostLabels(hostB);
    let shared = 0;
    while (
        shared < left.length &&
        shared < right.length &&
        left[left.length - 1 - shared] === right[right.length - 1 - shared]
    ) {
        shared += 1;
    }
    if (shared < 2) return false;
    // Guard against ".co.uk"-style matches: the shared part must not be only a
    // compound public suffix.
    const sharedPart = left.slice(left.length - shared);
    return !(sharedPart.length === 2 && COMPOUND_PUBLIC_SUFFIXES.has(sharedPart[0]));
}

/** Site URL to use as the Referer for a booru host (root domain of the host). */
export function refererForHost(host) {
    const normalized = String(host || '').toLowerCase();
    // Addresses have no registrable domain to trim to — a self-hosted booru
    // commonly lives on one (http://192.168.0.10, localhost, an IPv6 literal).
    if (isAddressHost(normalized)) return `https://${normalized}/`;

    const labels = hostLabels(normalized);
    if (labels.length <= 2) return `https://${labels.join('.')}/`;
    const last = labels[labels.length - 1];
    const secondLast = labels[labels.length - 2];
    const takeThree = last.length === 2 && COMPOUND_PUBLIC_SUFFIXES.has(secondLast);
    const site = labels.slice(takeThree ? -3 : -2).join('.');
    return `https://${site}/`;
}

function isAddressHost(host) {
    return (
        host === 'localhost' ||
        host.includes(':') || // IPv6 literal, e.g. [::1]
        /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
    );
}

/**
 * Record which booru sources need Referer-based media fetching.
 * Called with the app's active sources whenever they change.
 *
 * @param {Array<{url: string, type: string}>} sources
 */
export function registerRefererMediaSources(sources) {
    const registered = [];
    for (const source of sources || []) {
        // Only engine families known to hotlink-protect their files; other
        // sources keep loading media directly.
        if (!source || source.type !== 'gelbooru' || !source.url) continue;
        const host = safeHost(source.url);
        if (!host) continue;
        if (registered.some(entry => entry.host === host)) continue;
        registered.push({ host, referer: refererForHost(host) });
    }
    refererSources = [...BUILTIN_REFERER_SOURCES, ...registered];
}

/**
 * The referer entry this media URL belongs to, if any.
 *
 * Only HTTPS can go through the referer layer (both the dev server and the
 * native cache command refuse plain HTTP), so an HTTP URL is left for the
 * webview to load directly, exactly as before this support existed. A
 * plain-HTTP booru is nearly always the user's own host, which has no reason to
 * check hotlinks.
 */
function refererSourceFor(url) {
    if (!url || !/^https:\/\//i.test(url)) return null;
    const host = safeHost(url);
    if (!host) return null;
    return (
        refererSources.find(entry => hostsShareSite(host, entry.host)) || null
    );
}

/**
 * Does this media URL need a Referer, i.e. must it be fetched outside the
 * webview? Exported so video handling can make the same decision.
 */
export function needsRefererProxy(url) {
    return Boolean(refererSourceFor(url));
}

/** The Referer this media URL must be requested with, or null if none. */
export function refererForMediaUrl(url) {
    return refererSourceFor(url)?.referer || null;
}

/** @deprecated kept for callers that only know about the built-in booru. */
export function isGelbooruMediaUrl(url) {
    return needsRefererProxy(url);
}

function isTauri() {
    return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
}

/**
 * The Cloudflare clearance for this media URL's site, if the site's requests
 * needed it this session. Media often lives on a separate host (cdn.donmai.us
 * for danbooru.donmai.us), so any such origin on the same site counts.
 * On a network Cloudflare blocks, the WebView's own <img>/<video> requests
 * are refused even after the check, so those files are fetched natively with
 * the clearance instead (see the cache_booru_media command). Anywhere else
 * the WebView loads them itself, which streams and runs in parallel, so a
 * site verified on a VPN is not slowed down once the VPN is off.
 * @returns {Promise<{referer: string, cookie: string, userAgent: string}|null>}
 */
async function clearanceFor(url) {
    if (!isTauri() || !/^https:\/\//i.test(url || '')) return null;
    const host = safeHost(url);
    const origin = [...clearanceOrigins].find(o => hostsShareSite(host, safeHost(o)));
    if (!origin) return null;
    const headers = await clearanceHeaders(origin);
    if (!headers) return null;
    return { referer: `${origin}/`, cookie: headers.Cookie, userAgent: headers['User-Agent'] };
}

/**
 * Resolve a URL that an img/video element can load even when the booru blocks
 * hotlinks or Cloudflare blocks the WebView. Other URLs pass through untouched.
 */
export async function getDisplayableMediaUrl(url) {
    const clearance = await clearanceFor(url);
    if (clearance) {
        const { convertFileSrc, invoke } = await import('@tauri-apps/api/core');
        try {
            const cachedPath = await invoke('cache_booru_media', { url, ...clearance });
            return convertFileSrc(cachedPath);
        } catch (error) {
            // The native fetch was refused or timed out: let the WebView try
            // the file itself rather than leave the post blank.
            console.warn('[mediaUrl] Fetching media with the clearance failed:', url, error);
        }
    }

    const source = refererSourceFor(url);
    if (!source) return url;

    // Browsers cannot set Referer themselves, so Vite supplies it server-side.
    if (import.meta.env && import.meta.env.DEV) {
        return `/booru-media?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(source.referer)}`;
    }

    if (isTauri()) {
        const { convertFileSrc, invoke } = await import('@tauri-apps/api/core');
        const cachedPath = await invoke('cache_booru_media', {
            url,
            referer: source.referer,
        });
        return convertFileSrc(cachedPath);
    }

    throw new Error('This booru protects its media; use the Vite proxy or a packaged Tauri app');
}

export function releaseDisplayableMediaUrl(url) {
    if (url && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }
}