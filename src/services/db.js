/*
 * BooruRamen - A personalized booru browser
 * Copyright (C) 2025 DottsGit
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

/**
 * db.js
 * IndexedDB database schema using Dexie.js
 * Replaces localStorage for better performance and unlimited storage
 */
import Dexie from 'dexie';

export const db = new Dexie('BooruRamenDB');

// Define database schema
db.version(1).stores({
    // Interactions: stores user interactions with posts (likes, dislikes, favorites, timeSpent, views)
    // Indexed by auto-increment id, with compound index for finding existing interactions
    interactions: '++id, postId, type, source, timestamp, [postId+type+source]',

    // View history: stores viewed posts with their full data
    // Key is composite "source|postId" for deduplication across sources
    viewHistory: 'key, lastViewed',

    // Preferences: single-row store for user preferences (avoided tags, active sources, etc.)
    // Uses 'singleton' as the fixed id
    preferences: 'id',

    // App settings: single-row store for app-level settings (ratings, debug mode, etc.)
    // Uses 'singleton' as the fixed id
    appSettings: 'id',

    // Gelbooru tag cache: maps tag names to category numbers
    // Category: 0=General, 1=Artist, 3=Copyright, 4=Character, 5=Meta
    tagCache: 'tag'
});

// Update schema to include profileSnapshot
db.version(2).stores({
    interactions: '++id, postId, type, source, timestamp, [postId+type+source]',
    viewHistory: 'key, lastViewed',
    preferences: 'id',
    appSettings: 'id',
    tagCache: 'tag',
    // Snapshot of the user profile for incremental updates
    // key: 'singleton'
    profileSnapshot: 'id'
});

/**
 * Migrate data from localStorage to IndexedDB
 * This runs once on first load after update
 */
export async function migrateFromLocalStorage() {
    const MIGRATION_KEY = 'booruRamen_indexeddb_migrated';

    // Check if environment supports localStorage
    if (typeof localStorage === 'undefined') {
        return;
    }

    // Check if already migrated
    if (localStorage.getItem(MIGRATION_KEY)) {
        return;
    }

    console.log('[DB] Starting migration from localStorage to IndexedDB...');

    try {
        // Migrate interactions
        const interactionsData = localStorage.getItem('booruRamenInteractions');
        if (interactionsData) {
            const interactions = JSON.parse(interactionsData);
            if (Array.isArray(interactions) && interactions.length > 0) {
                await db.interactions.bulkAdd(interactions);
                console.log(`[DB] Migrated ${interactions.length} interactions`);
            }
        }

        // Migrate view history
        const historyData = localStorage.getItem('booruRamenViewHistory');
        if (historyData) {
            const history = JSON.parse(historyData);
            const historyEntries = Object.entries(history).map(([key, value]) => ({
                key,
                lastViewed: value.lastViewed,
                data: value.data
            }));
            if (historyEntries.length > 0) {
                await db.viewHistory.bulkAdd(historyEntries);
                console.log(`[DB] Migrated ${historyEntries.length} view history entries`);
            }
        }

        // Migrate preferences
        const preferencesData = localStorage.getItem('booruRamenPreferences');
        if (preferencesData) {
            const preferences = JSON.parse(preferencesData);
            await db.preferences.put({ id: 'singleton', ...preferences });
            console.log('[DB] Migrated preferences');
        }

        // Migrate app settings
        const settingsData = localStorage.getItem('booruRamenAppSettings');
        if (settingsData) {
            const settings = JSON.parse(settingsData);
            await db.appSettings.put({ id: 'singleton', ...settings });
            console.log('[DB] Migrated app settings');
        }

        // Migrate tag cache
        const tagCacheData = localStorage.getItem('gelbooru_tag_cache');
        if (tagCacheData) {
            const tagCache = JSON.parse(tagCacheData);
            const tagEntries = Object.entries(tagCache).map(([tag, category]) => ({
                tag,
                category
            }));
            if (tagEntries.length > 0) {
                await db.tagCache.bulkAdd(tagEntries);
                console.log(`[DB] Migrated ${tagEntries.length} cached tags`);
            }
        }

        // Mark migration as complete
        localStorage.setItem(MIGRATION_KEY, 'true');

        // Clean up old localStorage keys (optional - keep for safety rollback)
        // localStorage.removeItem('booruRamenInteractions');
        // localStorage.removeItem('booruRamenViewHistory');
        // localStorage.removeItem('booruRamenPreferences');
        // localStorage.removeItem('booruRamenAppSettings');
        // localStorage.removeItem('gelbooru_tag_cache');

        console.log('[DB] Migration complete!');
    } catch (error) {
        console.error('[DB] Migration failed:', error);
        // Don't mark as migrated so it can retry
    }
}

export default db;
