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
 * Unified fetch function that uses Tauri HTTP in production and browser fetch in development.
 * API is compatible with standard fetch.
 * @param {string} url - The URL to fetch
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<Response>}
 */
export async function httpFetch(url, options = {}) {
    // Initialize Tauri fetch if not already done
    const tauriFetchFn = await initTauriFetch();

    if (tauriFetchFn) {
        // Use Tauri's HTTP plugin fetch (bypasses CORS)
        return tauriFetchFn(url, options);
    }

    // Fall back to browser fetch (works in dev with Vite proxy)
    return fetch(url, {
        ...options,
        referrerPolicy: 'strict-origin-when-cross-origin'
    });
}

// Export a default fetch-like function for convenience
export default httpFetch;
