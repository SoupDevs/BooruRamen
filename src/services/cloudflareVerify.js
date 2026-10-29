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
 * cloudflareVerify.js
 * Lets the user pass a site's Cloudflare check by hand when Cloudflare
 * blocks the app's requests (typically on a VPN). The site opens in the
 * app's WebView (src-tauri/src/cloudflare.rs); once Cloudflare sets its
 * cf_clearance cookie the app reloads, and requests to that site carry the
 * WebView's cookies and User-Agent, which the clearance is tied to.
 */
import { reactive } from 'vue';

const VERIFIED_KEY = 'cloudflareVerifiedOrigins';
const PENDING_KEY = 'cloudflarePendingOrigin';
const COOKIE_CACHE_MS = 30 * 1000;
// The page the check opens. Cloudflare challenges every path on a site alike,
// but once the check passes it shows the page that was asked for; a path the
// site doesn't have shows its "not found" page, so even if that flashes up
// before the app returns, none of the site's posts (unfiltered by the app's
// content filters) are on it.
const VERIFY_PATH = '/booruramen-cloudflare-check';

/** Sites Cloudflare is currently blocking, for the banner that offers the check. */
export const cloudflareState = reactive({ blocked: [] });

const cookieCache = new Map();

/**
 * Sites whose requests only got through with the clearance this session.
 * Everything else, a verified site included, goes out as a plain request:
 * off the network Cloudflare blocked, the clearance is not needed, and its
 * media loads faster straight in the WebView (see mediaUrl.js).
 */
export const clearanceOrigins = new Set();

function readJson(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch {
        return fallback;
    }
}

function writeJson(key, value) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Storage unavailable: verification just won't survive a reload.
    }
}

function verifiedOrigins() {
    return new Set(readJson(VERIFIED_KEY, []));
}

async function invoke(command, args) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(command, args);
}

function hasClearance(cookies) {
    return /(?:^|;\s*)cf_clearance=/.test(cookies || '');
}

/**
 * Record that Cloudflare blocked a request to `origin`.
 * @param {string} origin
 */
export function noteCloudflareBlock(origin) {
    cookieCache.delete(origin);
    clearanceOrigins.delete(origin);
    if (!cloudflareState.blocked.includes(origin)) cloudflareState.blocked.push(origin);
}

/** Hide the banner for `origin` without verifying. */
export function dismissCloudflareBlock(origin) {
    cloudflareState.blocked = cloudflareState.blocked.filter(o => o !== origin);
}

/**
 * Whether `origin` was verified before and Cloudflare is blocking it again,
 * meaning the clearance expired or the site would not accept it from the app.
 * @param {string} origin
 */
export function wasVerified(origin) {
    return verifiedOrigins().has(origin);
}

/** Every origin the user has passed the check for. */
export function verifiedOriginList() {
    return [...verifiedOrigins()];
}

/**
 * Open `origin` in the app's WebView so the user can pass the check. The app
 * page is replaced until the check passes (or the user taps back).
 * @param {string} origin
 */
export async function startCloudflareVerification(origin) {
    writeJson(PENDING_KEY, origin);
    await invoke('cloudflare_verify', { url: `${origin}${VERIFY_PATH}` });
}

/**
 * Called on startup: if the app is coming back from a check, keep the site's
 * clearance for later requests. Returns the verified origin, if any.
 * @returns {Promise<string|null>}
 */
export async function finishPendingVerification() {
    const origin = readJson(PENDING_KEY, null);
    if (!origin) return null;
    writeJson(PENDING_KEY, null);
    try {
        const cookies = await invoke('cloudflare_cookies', { url: `${origin}/` });
        if (!hasClearance(cookies)) return null;
        const verified = verifiedOrigins();
        verified.add(origin);
        writeJson(VERIFIED_KEY, [...verified]);
        cookieCache.set(origin, { cookies, at: Date.now() });
        return origin;
    } catch (e) {
        console.warn('[cloudflareVerify] Could not read clearance cookie:', e);
        return null;
    }
}

/**
 * Headers that carry `origin`'s Cloudflare clearance, or null when the site
 * was never verified or the clearance is gone.
 * @param {string} origin
 * @returns {Promise<Record<string, string>|null>}
 */
export async function clearanceHeaders(origin) {
    if (!verifiedOrigins().has(origin)) return null;
    let entry = cookieCache.get(origin);
    if (!entry || Date.now() - entry.at > COOKIE_CACHE_MS) {
        try {
            entry = { cookies: await invoke('cloudflare_cookies', { url: `${origin}/` }), at: Date.now() };
        } catch {
            return null;
        }
        cookieCache.set(origin, entry);
    }
    if (!hasClearance(entry.cookies)) return null;
    return { Cookie: entry.cookies, 'User-Agent': navigator.userAgent };
}
