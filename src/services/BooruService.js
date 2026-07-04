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
 * BooruService.js
 * Manages active Booru adapters and provides a unified interface for fetching posts.
 */

import { DanbooruAdapter, GelbooruAdapter, MoebooruAdapter } from './BooruAdapters';
import StorageService from './StorageService';

class BooruService {
    constructor() {
        this.adapters = [];
        this.activeSources = [];
        this.initializationPromise = this.initializeInternal();
    }

    // Public initialize that just waits for the internal one
    async initialize() {
        return this.initializationPromise;
    }

    async initializeInternal() {
        // Prioritize Preferences (new location)
        const preferences = await StorageService.getPreferences();
        const settings = await StorageService.loadAppSettings();

        let sources = preferences?.activeSources;

        // Fallback or Migration from AppSettings or Default
        if (!sources || sources.length === 0) {
            if (settings?.activeSources && settings.activeSources.length > 0) {
                sources = settings.activeSources;
            } else if (settings?.activeSource) {
                sources = [settings.activeSource];
            } else {
                sources = [{ type: 'danbooru', url: 'https://danbooru.donmai.us', name: 'Danbooru' }];
            }
            // Save to preferences to complete migration
            await this.setActiveSources(sources);
        } else {
            await this.setActiveSources(sources, false);
        }
    }

    async setActiveSources(sources, save = true) {
        console.log(`Setting active Booru sources:`, sources);
        this.activeSources = sources;
        this.adapters = sources.map(source => this.createAdapter(source));

        if (save) {
            await StorageService.storePreferences({
                activeSources: sources
            });
        }
    }

    createAdapter(source) {
        switch (source.type) {
            case 'danbooru':
                return new DanbooruAdapter(source.url, { userId: source.userId, apiKey: source.apiKey });
            case 'gelbooru':
                return new GelbooruAdapter(source.url, { userId: source.userId, apiKey: source.apiKey });
            case 'moebooru':
                return new MoebooruAdapter(source.url);
            default:
                console.warn(`Unknown source type: ${source.type}, falling back to Danbooru`);
                return new DanbooruAdapter(source.url || 'https://danbooru.donmai.us');
        }
    }

    /**
     * Apply the user's tag query overrides to a tag string right before it is
     * sent to the booru source: strip "Never Include" tags from the query and
     * append "Always Include" tags that are missing. If a tag appears in both
     * lists, Never Include wins.
     * @param {string} tags - Space-separated tag query
     * @returns {Promise<string>} - The adjusted tag query
     */
    async applyTagOverrides(tags) {
        const saved = await StorageService.loadAppSettings();
        const settings = saved && saved.settings ? saved.settings : {};
        const alwaysInclude = Array.isArray(settings.tagAlwaysInclude) ? settings.tagAlwaysInclude : [];
        const neverInclude = Array.isArray(settings.tagNeverInclude) ? settings.tagNeverInclude : [];

        if (alwaysInclude.length === 0 && neverInclude.length === 0) {
            return tags;
        }

        let tokens = (tags || '').split(/\s+/).filter(t => t.length > 0);
        tokens = tokens.filter(t => !neverInclude.includes(t));

        for (const tag of alwaysInclude) {
            if (!neverInclude.includes(tag) && !tokens.includes(tag)) {
                tokens.push(tag);
            }
        }

        const result = tokens.join(' ');
        if (result !== (tags || '')) {
            console.log(`Tag overrides applied: "${tags}" -> "${result}"`);
        }
        return result;
    }

    async getPosts(params) {
        if (this.adapters.length === 0) await this.initialize();

        params = { ...params, tags: await this.applyTagOverrides(params.tags) };

        // If only one adapter, behave simply
        if (this.adapters.length === 1) {
            return this.adapters[0].getPosts(params);
        }

        // Multiple adapters: Fetch from all in parallel
        // We strictly use the same page number for all (simple strategy)
        // or we could track state, but stateless is safer for this 'getPosts' interface.

        console.log(`Fetching from ${this.adapters.length} sources...`);

        const promises = this.adapters.map(adapter =>
            adapter.getPosts(params).catch(err => {
                console.error(`Status check failed for ${adapter.baseUrl}:`, err);
                return [];
            })
        );

        const results = await Promise.all(promises);

        // Flatten results
        let allPosts = results.flat();

        // Deduplicate logic
        // We use a Map keyed by file_url or md5 to dedup
        const uniquePosts = new Map();
        allPosts.forEach(post => {
            // Prefer MD5 if available, otherwise file_url
            const key = post.md5 || post.file_url;
            if (key && !uniquePosts.has(key)) {
                uniquePosts.set(key, post);
            } else if (!key) {
                // No key? just add it (unlikely for valid posts)
                uniquePosts.set(Math.random(), post);
            }
        });

        // Convert back to array
        let mergedPosts = Array.from(uniquePosts.values());

        // Shuffle/Interleave results to mix sources? 
        // Basic shuffle to prevent source A from dominating top of feed
        // Deterministic shuffle using page number would be better but let's just random shuffle for "Feed" feel
        mergedPosts.sort(() => Math.random() - 0.5);

        return mergedPosts;
    }

    getTagLimit() {
        // Return the generic limit. If we have multiple sources, 
        // we should probably use the LOWEST limit if we want to be safe,
        // OR use a strategy where we query separately.

        // If we use "Hybrid Query" logic (RecSys), it asks for a limit to know if it should filter client side.
        // If we have Mixed sources (Danbooru + Gelbooru), Danbooru needs 2 tags, Gelbooru needs 100.
        // If we return 100, we send long query to Danbooru -> It fails.
        // If we return 2, we send short query to Gelbooru -> Inefficient but works.

        // SAFE STRATEGY: Return the minimum tag limit of all active adapters.
        if (this.adapters.length === 0) return 2;
        return Math.min(...this.adapters.map(a => a.tagLimit));
    }

    async testConnection() {
        if (this.adapters.length === 0) return [{ source: 'None', success: false, message: 'No active sources' }];

        const results = await Promise.all(this.adapters.map(async adapter => {
            const result = await adapter.testConnection();
            return {
                source: adapter.baseUrl,
                success: result.success,
                message: result.message
            };
        }));
        return results;
    }

    /**
     * Test authentication for a specific list of sources (not the saved ones)
     * This is used by the UI to test currently selected sources before saving
     * @param {Array} sources - Array of source configs to test
     * @returns {Promise<Array>} - Array of test results
     */
    async testAuthenticationForSources(sources) {
        if (!sources || sources.length === 0) {
            return [{ source: 'None', success: false, message: 'No sources selected' }];
        }

        const results = await Promise.all(sources.map(async source => {
            const adapter = this.createAdapter(source);
            const result = await adapter.testAuthentication();
            return {
                source: source.name || adapter.baseUrl,
                url: adapter.baseUrl,
                success: result.success,
                message: result.message,
                tier: result.tier
            };
        }));
        return results;
    }

    /**
     * Test reachability for a specific list of sources (connection only, not authentication)
     * This is used by the UI status indicators to show if a site is reachable
     * @param {Array} sources - Array of source configs to test
     * @returns {Promise<Array>} - Array of test results
     */
    async testConnectionForSources(sources) {
        if (!sources || sources.length === 0) {
            return [{ source: 'None', success: false, message: 'No sources selected' }];
        }

        const results = await Promise.all(sources.map(async source => {
            const adapter = this.createAdapter(source);
            const result = await adapter.testConnection();
            return {
                source: source.name || adapter.baseUrl,
                url: adapter.baseUrl,
                success: result.success,
                message: result.message
            };
        }));
        return results;
    }

    /**
     * Fetch comments for a specific post
     * @param {Object} post - The post object (must have id and source)
     * @returns {Promise<Array>} - Array of normalized comments
     */
    async getComments(post) {
        if (!post || !post.id) {
            console.warn('[BooruService] getComments called without valid post');
            return [];
        }

        // Find the adapter that matches this post's source
        const adapter = this.adapters.find(a =>
            post.source && (a.baseUrl === post.source || post.source.includes(a.baseUrl))
        );

        if (!adapter) {
            console.warn(`[BooruService] No adapter found for source: ${post.source}`);
            // Try to create a temporary adapter based on the source URL
            if (post.source) {
                const tempSource = this.guessSourceFromUrl(post.source);
                if (tempSource) {
                    const tempAdapter = this.createAdapter(tempSource);
                    return tempAdapter.getComments(post.id);
                }
            }
            return [];
        }

        return adapter.getComments(post.id);
    }

    /**
     * Guess source configuration from a URL
     * @param {string} url - The source URL
     * @returns {Object|null} - Source config or null
     */
    guessSourceFromUrl(url) {
        if (!url) return null;
        const lowerUrl = url.toLowerCase();

        if (lowerUrl.includes('danbooru')) {
            return { type: 'danbooru', url: 'https://danbooru.donmai.us' };
        }
        if (lowerUrl.includes('gelbooru.com')) {
            return { type: 'gelbooru', url: 'https://gelbooru.com' };
        }
        if (lowerUrl.includes('safebooru.org')) {
            return { type: 'gelbooru', url: 'https://safebooru.org' };
        }
        if (lowerUrl.includes('konachan')) {
            return { type: 'moebooru', url: 'https://konachan.com' };
        }
        if (lowerUrl.includes('yande.re')) {
            return { type: 'moebooru', url: 'https://yande.re' };
        }

        return null;
    }
}

// Singleton instance
export default new BooruService();
