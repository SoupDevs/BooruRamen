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
 * ProfileService.js
 * Manages user profiles. Each profile owns a complete, independent IndexedDB
 * database (interactions, history, settings, ML model, reports, ...), so a
 * profile is a full snapshot of the app's configuration and learned state.
 *
 * The registry of profiles lives in localStorage — not IndexedDB — because
 * db.js needs the active profile's database name synchronously at module
 * load, before any async storage is available.
 */
import Dexie from 'dexie';

const REGISTRY_KEY = 'booruRamenProfiles';
const PENDING_DELETES_KEY = 'booruRamenProfilePendingDeletes';

// The default profile keeps the original database name so existing
// installations adopt their current data as the "Default" profile.
export const DEFAULT_PROFILE_ID = 'default';
export const DEFAULT_DB_NAME = 'BooruRamenDB';

const hasLocalStorage = () => typeof localStorage !== 'undefined';

const defaultRegistry = () => ({
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: [
        { id: DEFAULT_PROFILE_ID, name: 'Default', createdAt: Date.now() }
    ]
});

/**
 * Read the profile registry, creating it on first use.
 */
export const getRegistry = () => {
    if (!hasLocalStorage()) return defaultRegistry();
    try {
        const raw = localStorage.getItem(REGISTRY_KEY);
        if (raw) {
            const registry = JSON.parse(raw);
            if (registry && Array.isArray(registry.profiles) && registry.profiles.length > 0) {
                // Heal a dangling active id (e.g. after a failed delete)
                if (!registry.profiles.some(p => p.id === registry.activeProfileId)) {
                    registry.activeProfileId = registry.profiles[0].id;
                    saveRegistry(registry);
                }
                return registry;
            }
        }
    } catch (e) {
        console.error('[Profiles] Failed to read registry, using default:', e);
    }
    const registry = defaultRegistry();
    saveRegistry(registry);
    return registry;
};

const saveRegistry = (registry) => {
    if (!hasLocalStorage()) return;
    try {
        localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
    } catch (e) {
        console.error('[Profiles] Failed to save registry:', e);
    }
};

export const getProfiles = () => getRegistry().profiles;

export const getActiveProfile = () => {
    const registry = getRegistry();
    return registry.profiles.find(p => p.id === registry.activeProfileId) || registry.profiles[0];
};

export const getProfileDbName = (profileId) =>
    profileId === DEFAULT_PROFILE_ID ? DEFAULT_DB_NAME : `${DEFAULT_DB_NAME}_${profileId}`;

export const getActiveProfileDbName = () => getProfileDbName(getActiveProfile().id);

/**
 * Create a new profile with a fresh, empty database.
 * Returns the new profile entry.
 */
export const createProfile = (name) => {
    const registry = getRegistry();
    const trimmed = String(name || '').trim();
    const profile = {
        id: `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        name: trimmed || `Profile ${registry.profiles.length + 1}`,
        createdAt: Date.now()
    };
    registry.profiles.push(profile);
    saveRegistry(registry);
    return profile;
};

/**
 * Switch the active profile and reload the app. A full reload is deliberate:
 * every service (Pinia stores, the recommendation worker, module singletons)
 * holds in-memory state tied to the old profile's database, and a reload is
 * the only way to swap all of it atomically.
 */
export const switchProfile = (profileId) => {
    const registry = getRegistry();
    if (!registry.profiles.some(p => p.id === profileId)) return false;
    if (registry.activeProfileId === profileId) return true;
    registry.activeProfileId = profileId;
    saveRegistry(registry);
    window.location.reload();
    return true;
};

const getPendingDeletes = () => {
    if (!hasLocalStorage()) return [];
    try {
        return JSON.parse(localStorage.getItem(PENDING_DELETES_KEY)) || [];
    } catch {
        return [];
    }
};

const setPendingDeletes = (names) => {
    if (!hasLocalStorage()) return;
    localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(names));
};

const deleteDatabaseWithTimeout = async (dbName, timeoutMs = 4000) => {
    // Dexie.delete resolves once open connections close (Dexie's default
    // versionchange handler closes them). The timeout covers the case where
    // something keeps the connection alive — the name stays in the pending
    // list and cleanupPendingDeletes retries on next launch.
    const deleted = await Promise.race([
        Dexie.delete(dbName).then(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), timeoutMs))
    ]);
    return deleted;
};

/**
 * Delete a profile and its entire database. Irreversible.
 * The last remaining profile cannot be deleted. Deleting the active profile
 * switches to the first remaining profile and reloads the app.
 */
export const deleteProfile = async (profileId) => {
    const registry = getRegistry();
    if (registry.profiles.length <= 1) return false;
    const profile = registry.profiles.find(p => p.id === profileId);
    if (!profile) return false;

    const dbName = getProfileDbName(profileId);
    const wasActive = registry.activeProfileId === profileId;

    // Remove from the registry first so a hung database delete can never
    // leave a ghost profile in the list.
    registry.profiles = registry.profiles.filter(p => p.id !== profileId);
    if (wasActive) {
        registry.activeProfileId = registry.profiles[0].id;
    }
    saveRegistry(registry);

    setPendingDeletes([...new Set([...getPendingDeletes(), dbName])]);
    try {
        const deleted = await deleteDatabaseWithTimeout(dbName);
        if (deleted) {
            setPendingDeletes(getPendingDeletes().filter(n => n !== dbName));
        }
    } catch (e) {
        console.error('[Profiles] Failed to delete profile database:', e);
    }

    if (wasActive) {
        window.location.reload();
    }
    return true;
};

/**
 * Retry deleting databases whose delete was interrupted (e.g. by a reload
 * while the connection was still open). Called once on app startup.
 */
export const cleanupPendingDeletes = async () => {
    const activeDbName = getActiveProfileDbName();
    for (const dbName of getPendingDeletes()) {
        if (dbName === activeDbName) {
            // Should not happen (registry is updated before deletion), but
            // never delete the database the app is currently running on.
            setPendingDeletes(getPendingDeletes().filter(n => n !== dbName));
            continue;
        }
        try {
            const deleted = await deleteDatabaseWithTimeout(dbName);
            if (deleted) {
                setPendingDeletes(getPendingDeletes().filter(n => n !== dbName));
            }
        } catch (e) {
            console.error('[Profiles] Pending delete failed:', e);
        }
    }
};
