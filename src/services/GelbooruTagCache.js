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
 * Service for caching Gelbooru tag categories using IndexedDB
 * This avoids making repeated API calls for the same tags
 */

import { db } from './db.js';

class GelbooruTagCache {
    constructor() {
        // In-memory cache for fast lookups during session
        this.memoryCache = new Map();
        this.initialized = false;
    }

    /**
     * Initialize the cache by loading from IndexedDB into memory
     */
    async init() {
        if (this.initialized) return;
        try {
            const entries = await db.tagCache.toArray();
            for (const entry of entries) {
                this.memoryCache.set(entry.tag, entry.category);
            }
            console.log(`[TagCache] Loaded ${this.memoryCache.size} cached tags from IndexedDB`);
            this.initialized = true;
        } catch (e) {
            console.error('[TagCache] Failed to load from IndexedDB:', e);
        }
    }

    /**
     * Save a batch of tag categories to IndexedDB
     * @param {Map|Object} tagCategories - Map or object of tag -> category
     */
    async saveBatch(tagCategories) {
        try {
            const entries = [];
            const iterator = tagCategories instanceof Map
                ? tagCategories.entries()
                : Object.entries(tagCategories);

            for (const [tag, category] of iterator) {
                this.memoryCache.set(tag, category);
                entries.push({ tag, category });
            }

            if (entries.length > 0) {
                await db.tagCache.bulkPut(entries);
            }
        } catch (e) {
            console.error('[TagCache] Failed to save batch to IndexedDB:', e);
        }
    }

    /**
     * Get the category number for a tag
     * @param {string} tag - Tag name
     * @returns {number|null} - Category number (0=General, 1=Artist, 3=Copyright, 4=Character, 5=Meta) or null if not cached
     */
    getCategory(tag) {
        return this.memoryCache.get(tag) ?? null;
    }

    /**
     * Get the category number for a tag (async version that checks DB if not in memory)
     * @param {string} tag - Tag name
     * @returns {Promise<number|null>} - Category number or null if not cached
     */
    async getCategoryAsync(tag) {
        // Check memory first
        if (this.memoryCache.has(tag)) {
            return this.memoryCache.get(tag);
        }
        // Check IndexedDB
        try {
            const entry = await db.tagCache.get(tag);
            if (entry) {
                this.memoryCache.set(tag, entry.category);
                return entry.category;
            }
        } catch (e) {
            console.error('[TagCache] Failed to get tag from IndexedDB:', e);
        }
        return null;
    }

    /**
     * Set the category for a tag
     * @param {string} tag - Tag name
     * @param {number} category - Category number
     */
    async setCategory(tag, category) {
        this.memoryCache.set(tag, category);
        try {
            await db.tagCache.put({ tag, category });
        } catch (e) {
            console.error('[TagCache] Failed to save tag to IndexedDB:', e);
        }
    }

    /**
     * Get tags that are NOT in the cache
     * @param {string[]} tags - Array of tag names
     * @returns {string[]} - Tags that need to be fetched
     */
    getUncachedTags(tags) {
        return tags.filter(tag => !this.memoryCache.has(tag));
    }

    /**
     * Categorize tags into groups based on their category
     * @param {string[]} tags - Array of tag names
     * @returns {Object} - Object with categorized tags
     */
    categorizeTags(tags) {
        const result = {
            general: [],
            artist: [],
            copyright: [],
            character: [],
            meta: [],
        };

        for (const tag of tags) {
            const category = this.memoryCache.get(tag);
            switch (category) {
                case 1:
                    result.artist.push(tag);
                    break;
                case 3:
                    result.copyright.push(tag);
                    break;
                case 4:
                    result.character.push(tag);
                    break;
                case 5:
                    result.meta.push(tag);
                    break;
                default:
                    // Category 0 or unknown = general
                    result.general.push(tag);
                    break;
            }
        }

        return result;
    }

    /**
     * Get cache statistics
     * @returns {Object} - Stats about the cache
     */
    getStats() {
        let general = 0, artist = 0, copyright = 0, character = 0, meta = 0;
        for (const category of this.memoryCache.values()) {
            switch (category) {
                case 0: general++; break;
                case 1: artist++; break;
                case 3: copyright++; break;
                case 4: character++; break;
                case 5: meta++; break;
            }
        }
        return {
            total: this.memoryCache.size,
            general,
            artist,
            copyright,
            character,
            meta,
        };
    }

    /**
     * Clear the entire cache
     */
    async clear() {
        this.memoryCache.clear();
        try {
            await db.tagCache.clear();
            console.log('[TagCache] Cache cleared');
        } catch (e) {
            console.error('[TagCache] Failed to clear IndexedDB cache:', e);
        }
    }
}

// Export a singleton instance
export const gelbooruTagCache = new GelbooruTagCache();

// Initialize on module load
gelbooruTagCache.init();

export default gelbooruTagCache;
