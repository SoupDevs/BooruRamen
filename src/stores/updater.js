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
 * Updater store: drives the update splash shown on app open and the manual
 * "Check for Updates" flow in the advanced settings.
 */

import { defineStore } from 'pinia';
import UpdateService from '../services/UpdateService';

export const useUpdaterStore = defineStore('updater', {
    state: () => ({
        // idle | checking | available | upToDate | downloading | installing
        // | permissionRequired | error
        status: 'idle',
        // Android: the install is waiting for the user to allow installs from
        // this app. The APK is already downloaded, so retrying is instant.
        needsInstallPermission: false,
        showSplash: false,
        currentVersion: '',
        latestVersion: '',
        releaseNotes: '',
        releaseUrl: '',
        // { phase: 'downloading'|'installing', downloaded, total } or null
        progress: null,
        error: '',
        // Full result of the last successful check, kept for installUpdate()
        lastCheck: null,
    }),
    actions: {
        /**
         * Check for a new release. Silent checks (app open) only surface the
         * splash when an update exists; manual checks always show a result.
         */
        async checkForUpdates({ manual = false } = {}) {
            if (['checking', 'downloading', 'installing'].includes(this.status)) return;
            this.error = '';
            this.status = 'checking';
            if (manual) this.showSplash = true;

            try {
                const result = await UpdateService.checkForUpdates();
                this.lastCheck = result;
                this.currentVersion = result.currentVersion;
                this.latestVersion = result.latestVersion;
                this.releaseNotes = result.notes;
                this.releaseUrl = result.releaseUrl;
                if (result.available) {
                    this.status = 'available';
                    this.showSplash = true;
                } else {
                    this.status = 'upToDate';
                    this.showSplash = manual;
                }
            } catch (e) {
                this.error = e?.message || String(e);
                this.status = 'error';
                this.showSplash = manual;
                if (!manual) {
                    console.warn('[Updater] Silent update check failed:', e);
                }
            }
        },

        /** Download the new release and hand off to the platform installer. */
        async installUpdate() {
            if (!this.lastCheck?.available) return;

            // A build without the sideload feature leaves installing to the
            // store; say so instead of downloading an APK it may not use.
            if (!(await UpdateService.isSideloadUpdatesSupported())) {
                this.error = 'This build installs updates through the app store.';
                this.status = 'error';
                return;
            }

            this.status = 'downloading';
            this.progress = null;
            this.needsInstallPermission = false;
            try {
                await UpdateService.downloadAndInstall(this.lastCheck, progress => {
                    this.progress = progress;
                    if (progress?.phase === 'installing') {
                        this.status = 'installing';
                    }
                });
                // On desktop the app exits before we get here; on Android the
                // system installer has been opened.
                this.status = 'installing';
            } catch (e) {
                if (UpdateService.isInstallPermissionError(e)) {
                    // Android will not show the installer until the user allows
                    // installs from this app. Ask for that instead of showing a
                    // failure the user cannot act on.
                    this.error = '';
                    this.needsInstallPermission = true;
                    this.status = 'permissionRequired';
                } else {
                    this.error = e?.message || String(e);
                    this.status = 'error';
                }
            }
        },

        /** Open the Android screen where installs from this app are allowed. */
        async openInstallPermissionSettings() {
            this.error = '';
            try {
                await UpdateService.openInstallPermissionSettings();
            } catch (e) {
                this.error = e?.message || String(e);
                this.status = 'error';
            }
        },

        /**
         * Hide the splash (the "Ignore" path, or closing the installing
         * notice on Android after the system installer has taken over).
         * Anything but an in-flight download resets to idle so the user can
         * check again later.
         */
        dismiss() {
            this.showSplash = false;
            this.needsInstallPermission = false;
            if (this.status !== 'downloading') {
                this.status = 'idle';
            }
        },
    },
});
