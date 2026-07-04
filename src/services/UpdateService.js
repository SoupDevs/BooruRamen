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
 * UpdateService.js
 * Checks for new app releases and hands off installation to the Rust side.
 *
 * Release lookup goes through an UpdateProvider so the distribution channel
 * can change per platform without touching the callers. Today both desktop
 * and Android are distributed through GitHub releases. When the Android app
 * moves to the Google Play Store, add a PlayStoreProvider (Play manages the
 * update flow itself, so its provider would report "no update" here and let
 * the store handle it) and return it from getUpdateProvider() on Android.
 */
/* global __APP_VERSION__ */

import httpFetch from './httpClient';
import { isTauri, isAndroid } from './DownloadService';

const GITHUB_REPO = 'SoupDevs/BooruRamen';

class GitHubReleaseProvider {
    /**
     * Fetch the latest published release.
     * @returns {Promise<{version: string, notes: string, releaseUrl: string, assets: Array<{name: string, url: string}>}>}
     */
    async getLatestRelease() {
        const response = await httpFetch(
            `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
            { headers: { Accept: 'application/vnd.github+json' } }
        );
        if (!response.ok) {
            throw new Error(`Update check failed (HTTP ${response.status})`);
        }
        const release = await response.json();
        return {
            version: (release.tag_name || '').replace(/^v/, ''),
            notes: release.body || '',
            releaseUrl: release.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
            assets: (release.assets || []).map(asset => ({
                name: asset.name,
                url: asset.browser_download_url,
            })),
        };
    }
}

/**
 * Pick the update provider for the current platform.
 * Android will switch to a PlayStoreProvider once the app is distributed
 * through Google Play; until then it also updates from GitHub releases.
 */
export function getUpdateProvider() {
    return new GitHubReleaseProvider();
}

/**
 * Compare two dotted version strings numerically.
 * @returns {number} positive if a > b, negative if a < b, 0 if equal
 */
export function compareVersions(a, b) {
    const partsA = String(a).split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
    const partsB = String(b).split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
    const length = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < length; i++) {
        const diff = (partsA[i] || 0) - (partsB[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

/**
 * Check whether a newer release than the running version exists.
 * @returns {Promise<{available: boolean, currentVersion: string, latestVersion: string, notes: string, releaseUrl: string, assets: Array}>}
 */
export async function checkForUpdates() {
    const currentVersion = __APP_VERSION__;
    const release = await getUpdateProvider().getLatestRelease();
    const available = !!release.version && compareVersions(release.version, currentVersion) > 0;
    return {
        available,
        currentVersion,
        latestVersion: release.version,
        notes: release.notes,
        releaseUrl: release.releaseUrl,
        assets: release.assets,
    };
}

/**
 * Download and launch the platform installer for an available update.
 * The Rust side picks the right asset (APK / NSIS exe / MSI), reports
 * progress through "update://progress" events, and takes over from there:
 * on desktop the app exits so the installer can replace it, on Android the
 * system package installer opens.
 * @param {object} update - result of checkForUpdates()
 * @param {(progress: {phase: string, downloaded: number, total: number}) => void} [onProgress]
 */
export async function downloadAndInstall(update, onProgress) {
    if (!isTauri()) {
        throw new Error('Automatic updates are only available in the installed app.');
    }
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen('update://progress', event => {
        if (onProgress) onProgress(event.payload);
    });
    try {
        await invoke('install_update', { assets: update.assets });
    } finally {
        unlisten();
    }
}

export default {
    getUpdateProvider,
    compareVersions,
    checkForUpdates,
    downloadAndInstall,
    isAndroid,
};
