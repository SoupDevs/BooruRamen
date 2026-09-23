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

// Export/import format: one JSON file carrying a profile's registry entry
// plus every row of its database.
export const EXPORT_FORMAT = 'booruramen-profile-export';
export const EXPORT_VERSION = 1;
// Tables written to (and read from) an export, settings first so a restored
// profile is usable even if a later table is missing from an older file.
const EXPORT_TABLES = [
    'preferences', 'appSettings', 'profileSnapshot', 'interactions',
    'viewHistory', 'reports', 'tagCache'
];
const MAX_PROFILE_NAME = 40;

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
 * The schema lives here, not in db.js, so export and import can open any
 * profile's database; db.js applies these same steps to the active one.
 * v1: interactions (likes/dislikes/favorites/views), viewHistory, the two
 * singleton stores, and the gelbooru tag -> category cache.
 * v2: profileSnapshot (ML model, embeddings, bandit state).
 * v3: reports (blocked posts/artists/uploaders).
 */
const SCHEMA_STEPS = [
    {
        version: 1,
        stores: {
            interactions: '++id, postId, type, source, timestamp, [postId+type+source]',
            viewHistory: 'key, lastViewed',
            preferences: 'id',
            appSettings: 'id',
            tagCache: 'tag'
        }
    },
    {
        version: 2,
        stores: {
            interactions: '++id, postId, type, source, timestamp, [postId+type+source]',
            viewHistory: 'key, lastViewed',
            preferences: 'id',
            appSettings: 'id',
            tagCache: 'tag',
            profileSnapshot: 'id'
        }
    },
    {
        version: 3,
        stores: {
            interactions: '++id, postId, type, source, timestamp, [postId+type+source]',
            viewHistory: 'key, lastViewed',
            preferences: 'id',
            appSettings: 'id',
            tagCache: 'tag',
            profileSnapshot: 'id',
            reports: '++id, type, value, timestamp, [type+value]'
        }
    }
];

export const applyProfileSchema = (dexie) => {
    for (const step of SCHEMA_STEPS) {
        dexie.version(step.version).stores(step.stores);
    }
    return dexie;
};

const openProfileDb = async (profileId) => {
    const dexie = applyProfileSchema(new Dexie(getProfileDbName(profileId)));
    await dexie.open();
    return dexie;
};

const findTable = (dexie, name) => dexie.tables.find(table => table.name === name);

// IndexedDB stores typed arrays natively, JSON cannot: flatten them so an
// export round-trips as plain arrays (the ML code re-wraps them anyway).
const jsonSafe = (value) => JSON.parse(JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && ArrayBuffer.isView(v) && !(v instanceof DataView)) {
        return Array.from(v);
    }
    if (v instanceof ArrayBuffer) {
        return Array.from(new Uint8Array(v));
    }
    return v;
}));

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

/** Rename a profile; the name is the only editable piece of metadata. */
export const renameProfile = (profileId, name) => {
    const registry = getRegistry();
    const profile = registry.profiles.find(p => p.id === profileId);
    const trimmed = String(name || '').trim().slice(0, MAX_PROFILE_NAME);
    if (!profile || !trimmed) return false;
    profile.name = trimmed;
    saveRegistry(registry);
    return true;
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


/**
 * Dump a profile: its registry entry plus every row of its database, as a
 * JSON-safe payload. Opening a database that has never been used simply
 * yields empty tables - the schema is created on demand.
 */
export const dumpProfile = async (profileId) => {
    const registry = getRegistry();
    const profile = registry.profiles.find(p => p.id === profileId);
    if (!profile) return null;
    const dexie = await openProfileDb(profileId);
    const data = {};
    try {
        for (const table of EXPORT_TABLES) {
            const store = findTable(dexie, table);
            if (store) data[table] = jsonSafe(await store.toArray());
        }
    } finally {
        dexie.close();
    }
    return {
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        profile: { name: profile.name, createdAt: profile.createdAt },
        data
    };
};

/** Every profile in one file - what "Export all" writes. */
export const dumpAllProfiles = async () => {
    const profiles = [];
    for (const profile of getProfiles()) {
        const dumped = await dumpProfile(profile.id);
        if (dumped) profiles.push({ profile: dumped.profile, data: dumped.data });
    }
    return {
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        profiles
    };
};

const uniqueProfileName = (base) => {
    const taken = new Set(getProfiles().map(p => p.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    let n = 2;
    while (taken.has(`${base} (${n})`.toLowerCase())) n += 1;
    return `${base} (${n})`;
};

const normalizeExport = (payload) => {
    if (!payload || payload.format !== EXPORT_FORMAT) {
        throw new Error('That file is not a BooruRamen profile export.');
    }
    if (payload.version !== EXPORT_VERSION) {
        throw new Error(`Unsupported export version ${payload.version}.`);
    }
    const entries = Array.isArray(payload.profiles)
        ? payload.profiles
        : [{ profile: payload.profile, data: payload.data }];
    const usable = entries.filter(entry => entry && entry.profile && typeof entry.profile.name === 'string');
    if (!usable.length) throw new Error('The export contains no profiles.');
    return usable;
};

/**
 * Import one or more profiles from an export file. Every entry becomes a
 * NEW profile with a fresh id - an import never overwrites what is already
 * here - and the name is de-duplicated against the current registry.
 * Returns the created profile entries.
 */
export const importProfilesFromJson = async (text) => {
    let payload;
    try {
        payload = JSON.parse(text);
    } catch {
        throw new Error('That file is not valid JSON.');
    }
    const entries = normalizeExport(payload);
    const imported = [];
    for (const entry of entries) {
        const wanted = String(entry.profile.name || '').trim().slice(0, MAX_PROFILE_NAME)
            || 'Imported profile';
        const created = createProfile(uniqueProfileName(wanted));
        if (entry.profile.createdAt) {
            const registry = getRegistry();
            const stored = registry.profiles.find(p => p.id === created.id);
            if (stored) {
                stored.createdAt = entry.profile.createdAt;
                created.createdAt = entry.profile.createdAt;
                saveRegistry(registry);
            }
        }
        const dexie = await openProfileDb(created.id);
        try {
            for (const [table, rows] of Object.entries(entry.data || {})) {
                if (!EXPORT_TABLES.includes(table) || !Array.isArray(rows)) continue;
                const store = findTable(dexie, table);
                if (store) await store.bulkPut(jsonSafe(rows));
            }
        } finally {
            dexie.close();
        }
        imported.push(created);
    }
    return imported;
};
