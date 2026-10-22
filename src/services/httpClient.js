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
 * httpClient.js
 * Provides a unified fetch interface that works in both development (browser) and production (Tauri).
 * In Tauri production builds, uses the @tauri-apps/plugin-http fetch for CORS bypass.
 * In development or browser contexts, uses native browser fetch.
 */

/* global __APP_VERSION__ */

// Sent on native (Tauri) requests. Without it the HTTP plugin identifies us as
// "tauri-plugin-http/x.y.z", a generic library agent that Danbooru's bot
// protection can answer with a 403 (seen on Android while desktop still got
// through). Danbooru asks API clients to name themselves, so we do.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const APP_USER_AGENT = `BooruRamen/${APP_VERSION} (+https://github.com/SoupDevs/BooruRamen)`;

/**
 * Request headers with our User-Agent added, unless the caller set one.
 * @param {HeadersInit|undefined} headers
 * @returns {Headers}
 */
export function withAppUserAgent(headers) {
    const merged = new Headers(headers || {});
    if (!merged.has('User-Agent')) merged.set('User-Agent', APP_USER_AGENT);
    return merged;
}

/**
 * A readable error for a failed response, with a hint at what refused it:
 * Danbooru's own JSON error message, or a Cloudflare block page.
 * @param {Response} response
 * @returns {Promise<Error>}
 */
// Cloudflare blocks by IP reputation, and shared VPN exit servers are the
// usual reason a user's requests get flagged while the site works elsewhere.
const CLOUDFLARE_BLOCK = "blocked by Cloudflare. If you're on a VPN, try another server or turn it off";

export async function httpError(response) {
    let detail = '';
    try {
        const body = (await response.text()).slice(0, 2000);
        try {
            const json = JSON.parse(body);
            detail = json.message || json.reason || json.error || '';
        } catch {
            if (/cloudflare|cf-ray|just a moment|attention required/i.test(body)) {
                detail = CLOUDFLARE_BLOCK;
            }
        }
    } catch {
        // Body unreadable; the status alone will have to do.
    }
    if (!detail && response.headers?.get?.('cf-mitigated')) detail = CLOUDFLARE_BLOCK;
    const error = new Error(`HTTP error! status: ${response.status}${detail ? ` (${detail})` : ''}`);
    error.status = response.status;
    return error;
}

// Check if we're running in a Tauri context
const isTauri = () => {
    return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
};

// Dynamic import of Tauri plugin to avoid issues in non-Tauri environments
let tauriFetch = null;

/**
 * Initialize the Tauri HTTP plugin fetch function
 * @returns {Promise<Function|null>}
 */
async function initTauriFetch() {
    if (tauriFetch !== null) return tauriFetch;

    if (isTauri()) {
        try {
            const { fetch } = await import('@tauri-apps/plugin-http');
            tauriFetch = fetch;
            console.log('[httpClient] Using Tauri HTTP plugin for requests');
            return tauriFetch;
        } catch (e) {
            console.warn('[httpClient] Failed to load Tauri HTTP plugin:', e);
            tauriFetch = false; // Mark as failed to avoid retry
            return null;
        }
    }

    tauriFetch = false; // Not in Tauri context
    return null;
}

/**
 * A signal that aborts after `ms`, or when the caller's own signal does.
 * @param {AbortSignal|undefined} signal
 * @param {number} ms
 * @returns {AbortSignal}
 */
function withTimeout(signal, ms) {
    let timeout;
    if (typeof AbortSignal.timeout === 'function') {
        timeout = AbortSignal.timeout(ms);
    } else {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), ms);
        timeout = controller.signal;
    }
    if (!signal) return timeout;
    return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal;
}

/**
 * Unified fetch function that uses Tauri HTTP in production and browser fetch in development.
 * API is compatible with standard fetch, plus `timeoutMs`: the request (and
 * reading its body) is aborted once that many milliseconds have passed.
 * @param {string} url - The URL to fetch
 * @param {RequestInit & { timeoutMs?: number }} options - Fetch options
 * @returns {Promise<Response>}
 */
export async function httpFetch(url, { timeoutMs, ...options } = {}) {
    if (timeoutMs) options = { ...options, signal: withTimeout(options.signal, timeoutMs) };

    // Initialize Tauri fetch if not already done
    const tauriFetchFn = await initTauriFetch();

    if (tauriFetchFn) {
        const origin = originOf(url);
        if (webviewOrigins.has(origin)) return browserFetch(url, options);

        // Use Tauri's HTTP plugin fetch (bypasses CORS)
        const response = await tauriFetchFn(url, { ...options, headers: withAppUserAgent(options.headers) });
        if (!isCloudflareBlock(response)) return response;

        // Cloudflare refused the plugin's client (seen on Android for
        // Danbooru, whatever User-Agent we send), so the block is on how the
        // connection looks rather than on what we ask for. The WebView's own
        // fetch goes out as the system browser would, and APIs that allow
        // CORS (Danbooru does) answer it. Remember the origin so later
        // requests skip the refused attempt; keep the plugin's 403 when CORS
        // rules the WebView out.
        try {
            const retry = await browserFetch(url, options);
            webviewOrigins.add(origin);
            console.warn(`[httpClient] Cloudflare blocked native requests to ${origin}; using the WebView's fetch instead`);
            return retry;
        } catch (e) {
            if (options.signal?.aborted) throw e;
            return response;
        }
    }

    // Fall back to browser fetch (works in dev with Vite proxy)
    return browserFetch(url, options);
}

// Origins whose native requests Cloudflare blocks; see httpFetch.
const webviewOrigins = new Set();

function originOf(url) {
    try {
        return new URL(url).origin;
    } catch {
        return String(url);
    }
}

function browserFetch(url, options) {
    return fetch(url, {
        ...options,
        referrerPolicy: 'strict-origin-when-cross-origin'
    });
}

/**
 * Whether a response is Cloudflare refusing the client rather than the site
 * answering: a 403 Cloudflare marks as a challenge, or an HTML block page it
 * served in place of the API's JSON.
 * @param {Response} response
 * @returns {boolean}
 */
function isCloudflareBlock(response) {
    if (response?.status !== 403) return false;
    const headers = response.headers;
    if (!headers?.get) return false;
    if (headers.get('cf-mitigated')) return true;
    return /cloudflare/i.test(headers.get('server') || '') &&
        /text\/html/i.test(headers.get('content-type') || '');
}

// Export a default fetch-like function for convenience
export default httpFetch;
