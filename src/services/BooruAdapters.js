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
 * BooruAdapters.js
 * Adapter pattern for different Booru API types
 */

import { gelbooruTagCache } from './GelbooruTagCache.js';
import { httpFetch } from './httpClient.js';

class BooruAdapter {
    constructor(baseUrl, type) {
        this.baseUrl = baseUrl;
        this.type = type;
        // Limit tags to 5 for all sources to prevent queries becoming too complex/strict for searches.
        // Even if API allows 100 upload tags, search usually limits to ~6 terms or has complexity penalty.
        // This forces "Hybrid Mode" (Client Side Filtering) in RecommendationSystem, ensuring we get posts.
        this.tagLimit = type === 'danbooru' ? 2 : 5;
    }

    async getPosts(query) {
        throw new Error('Not implemented');
    }

    async testConnection() {
        try {
            const posts = await this.getPosts({ limit: 1, tags: '', _isTest: true }); // Pass _isTest flag
            if (posts && posts.length >= 0) {
                return { success: true, message: `Connected! Found ${posts.length} sample posts.` };
            }
            return { success: false, message: 'Connected but returned invalid data.' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Test authentication for this booru source
     * @returns {{ success: boolean, message: string, tier?: 'free' | 'authenticated' }}
     */
    async testAuthentication() {
        // Default implementation: just test connection (for sources without auth)
        const result = await this.testConnection();
        if (result.success) {
            return {
                success: true,
                message: 'Authenticated Successfully! (Free Tier)',
                tier: 'free'
            };
        }
        return { success: false, message: result.message };
    }

    // Explicitly test connection/auth, throwing errors on failure (Used by UI 'Verify' button)
    async verifyConnection() {
        const result = await this.testConnection();
        if (result.success) return true;
        throw new Error(result.message);
    }

    // Helper to extract relevant post data into a normalized format
    normalizePost(post) {
        return post;
    }

    /**
     * Fetch comments for a specific post
     * @param {number} postId - The ID of the post to fetch comments for
     * @returns {Promise<Array>} - Array of normalized comment objects
     */
    async getComments(postId) {
        throw new Error('Not implemented');
    }

    /**
     * Normalize a comment to a standard format
     * @param {Object} comment - Raw comment from API
     * @returns {Object} - Normalized comment object
     */
    normalizeComment(comment) {
        return {
            id: comment.id,
            postId: comment.post_id,
            body: comment.body || comment.comment || '',
            creator: comment.creator || comment.creator_name || comment.owner || 'Anonymous',
            createdAt: comment.created_at || new Date().toISOString(),
            score: comment.score || 0
        };
    }
}

export class DanbooruAdapter extends BooruAdapter {
    constructor(baseUrl = 'https://danbooru.donmai.us', credentials = {}) {
        super(baseUrl, 'danbooru');
        this.credentials = credentials;
        // Cache for user lookups to avoid repeated API calls
        this.userCache = new Map();
    }

    /**
     * Test authentication for Danbooru
     * - No credentials: Returns free tier message
     * - With credentials: Tests via /profile.json endpoint
     */
    async testAuthentication() {
        // If no credentials provided, test connectivity and return free tier message
        if (!this.credentials.userId || !this.credentials.apiKey) {
            const connectionResult = await this.testConnection();
            if (!connectionResult.success) {
                return { success: false, message: connectionResult.message };
            }
            return {
                success: true,
                message: 'Authenticated Successfully! (Free Tier)',
                tier: 'free'
            };
        }

        // Test authentication via /profile.json endpoint
        try {
            const params = new URLSearchParams({
                login: this.credentials.userId,
                api_key: this.credentials.apiKey
            });

            const url = `${this.baseUrl}/profile.json?${params.toString()}`;
            console.log(`[Danbooru] Testing authentication...`);

            const response = await httpFetch(url);

            if (response.status === 401) {
                return {
                    success: false,
                    message: 'Authentication failed: Invalid credentials'
                };
            }

            if (!response.ok) {
                return {
                    success: false,
                    message: `Authentication failed: HTTP ${response.status}`
                };
            }

            const data = await response.json();
            const username = data.name || this.credentials.userId;

            return {
                success: true,
                message: `Authenticated as ${username}!`,
                tier: 'authenticated'
            };
        } catch (error) {
            console.error('[Danbooru] Auth test error:', error);
            return {
                success: false,
                message: 'Failed to Authenticate'
            };
        }
    }

    async getPosts({ tags, page, limit, sort, sortOrder, skipSort, _isTest }) {
        const hasOrder = tags.includes('order:');

        // Danbooru supports comma syntax for filetypes natively (e.g., filetype:mp4,webm)
        // No expansion needed
        // Strip explicit 'video' tag as we rely on filetype filters for Danbooru as per user request
        let queryTags = tags.replace(/\bvideo\b/g, '').replace(/\s+/g, ' ').trim();

        // Smart sort logic specific to Danbooru's low tag limit
        if (!hasOrder && !skipSort) {
            const tagList = queryTags.split(' ');
            const expensiveTags = tagList.filter(t =>
                !t.startsWith('rating:') &&
                !t.startsWith('filetype:') &&
                !t.startsWith('-filetype:') &&
                !t.startsWith('status:') &&
                t.trim() !== ''
            );

            if (expensiveTags.length < 2) {
                if (sort === 'score') {
                    queryTags = `${queryTags} order:score`;
                } else if (sort === 'popular') {
                    queryTags = `${queryTags} order:popular`;
                } else {
                    queryTags = `${queryTags}`;
                }
            }
        }

        const params = new URLSearchParams({
            tags: queryTags,
            page,
            limit,
        });

        // Add credentials if available
        if (this.credentials.userId && this.credentials.apiKey) {
            params.append('login', this.credentials.userId);
            params.append('api_key', this.credentials.apiKey);
        }

        // Danbooru supports CORS natively, no proxy needed generally.
        // If we really need proxy, we can uncomment, but it seems to break things if headers aren't perfect.
        const url = `${this.baseUrl}/posts.json?${params.toString()}`;

        try {
            console.log(`[Danbooru] Fetching: ${url}`);
            const response = await httpFetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            // Attach actual query for debugging
            const normalizedPosts = data.filter(post => post.id && (post.file_url || post.large_file_url))
                .map(p => {
                    const normalized = this.normalizePost(p);
                    normalized._actualQuery = queryTags;
                    return normalized;
                });

            // posts.json only exposes uploader_id/approver_id; resolve them to
            // usernames before returning, since the feed pipeline clones posts
            // and would not see a late in-place update.
            try {
                await this.resolveUserNames(normalizedPosts);
            } catch (e) {
                console.error('[Danbooru] Failed to resolve user names:', e);
            }

            return normalizedPosts;
        } catch (error) {
            console.error('Error fetching posts from Danbooru:', error);
            if (_isTest) throw error; // Re-throw for testConnection to catch
            return [];
        }
    }

    normalizePost(post) {
        // For videos, prefer file_url (original) since large_file_url may not exist
        // For images, large_file_url may be a resized version
        if (!post.file_url && post.large_file_url) {
            post.file_url = post.large_file_url;
        }

        post.post_url = `${this.baseUrl}/posts/${post.id}`;
        // post.source from the API is the artist-reported source (e.g. a pixiv
        // link); keep it around before overwriting source with the booru URL,
        // which the rest of the app relies on as the post's origin key.
        post.original_source = post.source || '';
        post.source = this.baseUrl;
        return post;
    }

    /**
     * Resolve uploader/approver IDs on posts to usernames via the users API.
     * Mutates the post objects in place (they are reactive by the time the
     * lookup completes, so the UI updates automatically).
     * @param {Object[]} posts - Normalized posts
     */
    async resolveUserNames(posts) {
        const unknownIds = new Set();
        for (const post of posts) {
            if (post.uploader_id && !this.userCache.has(post.uploader_id)) unknownIds.add(post.uploader_id);
            if (post.approver_id && !this.userCache.has(post.approver_id)) unknownIds.add(post.approver_id);
        }

        if (unknownIds.size > 0) {
            await this.fetchUsernames([...unknownIds]);
        }

        for (const post of posts) {
            if (post.uploader_id && this.userCache.has(post.uploader_id)) {
                post.uploader_name = this.userCache.get(post.uploader_id);
            }
            if (post.approver_id && this.userCache.has(post.approver_id)) {
                post.approver_name = this.userCache.get(post.approver_id);
            }
        }
    }

    /**
     * Fetch comments for a specific post from Danbooru
     * @param {number} postId - The ID of the post
     * @returns {Promise<Array>} - Array of normalized comments
     */
    async getComments(postId) {
        const params = new URLSearchParams({
            'search[post_id]': postId,
            'limit': 100
        });

        // Add credentials if available
        if (this.credentials.userId && this.credentials.apiKey) {
            params.append('login', this.credentials.userId);
            params.append('api_key', this.credentials.apiKey);
        }

        const url = `${this.baseUrl}/comments.json?${params.toString()}`;

        try {
            console.log(`[Danbooru] Fetching comments for post ${postId}`);
            const response = await httpFetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();

            // Collect unique creator IDs that need to be looked up
            const creatorIds = [...new Set(data.map(c => c.creator_id).filter(id => id && !this.userCache.has(id)))];

            // Batch fetch usernames for all unknown creators
            if (creatorIds.length > 0) {
                await this.fetchUsernames(creatorIds);
            }

            // Map comments with resolved usernames
            return data.map(comment => this.normalizeComment(comment));
        } catch (error) {
            console.error('[Danbooru] Error fetching comments:', error);
            return [];
        }
    }

    /**
     * Fetch usernames for a list of user IDs
     * @param {number[]} userIds - Array of user IDs to look up
     */
    async fetchUsernames(userIds) {
        // Danbooru supports fetching multiple users with search[id] parameter
        const params = new URLSearchParams({
            'search[id]': userIds.join(','),
            'only': 'id,name',
            'limit': userIds.length
        });

        if (this.credentials.userId && this.credentials.apiKey) {
            params.append('login', this.credentials.userId);
            params.append('api_key', this.credentials.apiKey);
        }

        const url = `${this.baseUrl}/users.json?${params.toString()}`;

        try {
            console.log(`[Danbooru] Fetching usernames for ${userIds.length} users`);
            const response = await httpFetch(url);
            if (!response.ok) {
                console.warn(`[Danbooru] Failed to fetch usernames: ${response.status}`);
                return;
            }
            const users = await response.json();
            console.log(`[Danbooru] Got ${users.length} users:`, users.map(u => u.name));

            // Cache the results
            for (const user of users) {
                if (user.id && user.name) {
                    this.userCache.set(user.id, user.name);
                }
            }
        } catch (error) {
            console.error('[Danbooru] Error fetching usernames:', error);
        }
    }

    normalizeComment(comment) {
        // Look up username from cache
        const creatorName = this.userCache.get(comment.creator_id) || 'Anonymous';

        return {
            id: comment.id,
            postId: comment.post_id,
            body: comment.body || '',
            creator: creatorName,
            createdAt: comment.created_at || new Date().toISOString(),
            score: comment.score || 0
        };
    }
}

export class GelbooruAdapter extends BooruAdapter {
    constructor(baseUrl, credentials = {}) {
        super(baseUrl, 'gelbooru');
        this.credentials = credentials;
        // Rate limiting - Gelbooru has strict limits
        this.lastRequestTime = 0;
        this.minRequestInterval = 500; // Minimum 500ms between requests
        // Detect if this site supports actual video files (MP4/WebM)
        this.supportsVideoFiles = this.detectVideoSupport(baseUrl);
    }

    /**
     * Detect if this Gelbooru-engine site supports actual video files
     * @param {string} baseUrl - The base URL of the site
     * @returns {boolean} - True if the site hosts video files
     */
    detectVideoSupport(baseUrl) {
        const url = baseUrl.toLowerCase();
        // Only gelbooru.com is known to have actual video file support
        // Other Gelbooru-engine sites (safebooru.org, etc.) only host images/gifs
        if (url.includes('gelbooru.com')) return true;
        return false;
    }

    // Convert age: query to id: query
    translateAgeToId(operator, amount, unit) {
        // ID mapping for Jan 1st of each year (User provided + extrapolated)
        const YEAR_IDS = {
            2007: 1,
            2008: 132204,
            2009: 407581,
            2010: 676805,
            2011: 1020436,
            2012: 1382384,
            2013: 1757245,
            2014: 2116687,
            2015: 2536659,
            2016: 2994708,
            2017: 3497715,
            2018: 4038325,
            2019: 4550300,
            2020: 5065398,
            2021: 5781187,
            2022: 6790766,
            2023: 8084028,
            2024: 9425769,
            2025: 11229486
        };

        // Calculate target date
        const now = new Date();
        let targetDate = new Date();

        const value = parseInt(amount);
        if (unit.startsWith('y')) targetDate.setFullYear(now.getFullYear() - value);
        else if (unit.startsWith('mo')) targetDate.setMonth(now.getMonth() - value);
        else if (unit.startsWith('w')) targetDate.setDate(now.getDate() - (value * 7));
        else if (unit.startsWith('d')) targetDate.setDate(now.getDate() - value);
        else return ''; // Unknown unit

        // Find standard ID for that year
        const targetYear = targetDate.getFullYear();

        // Estimation check
        if (targetYear < 2007) return operator === '>' ? 'id:<1' : 'id:>1'; // Before time
        if (targetYear > 2025) return ''; // Future??

        // Get bounds
        const startId = YEAR_IDS[targetYear] || YEAR_IDS[2024]; // Fallback
        const nextId = YEAR_IDS[targetYear + 1] || (startId + 2000000); // Rough estimate for next year

        // Interpolate within the year
        // Day of year / 365
        const startOfYear = new Date(targetYear, 0, 1);
        const dayOfYear = Math.floor((targetDate - startOfYear) / (1000 * 60 * 60 * 24));
        const totalPostsInYear = nextId - startId;
        const offset = Math.floor(totalPostsInYear * (dayOfYear / 365));

        const estimatedId = startId + offset;

        // "age:<1y" (Newer than 1 year) -> ID > estimatedID
        if (operator === '<') return `id:>${estimatedId}`;

        // "age:>1y" (Older than 1 year) -> ID < estimatedID
        if (operator === '>') return `id:<${estimatedId}`;

        return '';
    }

    /**
     * Check if this Gelbooru-engine site has a free tier (no auth required)
     * @returns {boolean}
     */
    hasFreeTier() {
        const url = this.baseUrl.toLowerCase();
        // Safebooru.org has a free tier
        // Gelbooru.com requires authentication
        return url.includes('safebooru.org');
    }

    /**
     * Test if the website is reachable (doesn't check authentication)
     * This overrides the base method to avoid calling getPosts which requires auth for Gelbooru
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async testConnection() {
        try {
            await this.throttle();

            // Use a simple request to check if the site responds
            // We request the main page rather than the API to avoid auth requirements
            let cleanBaseUrl = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
            if (import.meta.env && import.meta.env.DEV) {
                if (cleanBaseUrl.includes('gelbooru.com')) cleanBaseUrl = '/api/gelbooru';
                if (cleanBaseUrl.includes('safebooru.org')) cleanBaseUrl = '/api/safebooru';
            }

            // Make a minimal request - just check if the endpoint responds
            const url = `${cleanBaseUrl}/index.php?page=dapi&s=post&q=index&json=1&limit=0`;
            console.log(`[Gelbooru] Testing connection to ${url}...`);

            const response = await httpFetch(url, { method: 'GET' });

            // Any response (even 401/403) means the site is reachable
            // We only care about network errors or complete failures
            if (response.ok || response.status === 401 || response.status === 403) {
                return { success: true, message: 'Site is reachable.' };
            }

            return { success: false, message: `Site returned HTTP ${response.status}` };
        } catch (error) {
            console.error('[Gelbooru] Connection test error:', error);
            return { success: false, message: `Cannot reach site: ${error.message}` };
        }
    }

    /**
     * Test authentication for Gelbooru-engine sites
     * - Safebooru: Has free tier, auth optional
     * - Gelbooru: Requires authentication
     */
    async testAuthentication() {
        const isGelbooru = this.baseUrl.toLowerCase().includes('gelbooru.com');
        const isSafebooru = this.baseUrl.toLowerCase().includes('safebooru.org');
        const hasCreds = this.credentials.userId && this.credentials.apiKey;

        // Gelbooru requires authentication
        if (isGelbooru && !hasCreds) {
            return {
                success: false,
                message: 'Gelbooru requires authentication. Please enter your User ID and API Key.'
            };
        }

        // Safebooru is a public API that doesn't validate credentials
        if (isSafebooru && hasCreds) {
            // Test connectivity first
            const connectionResult = await this.testConnection();
            if (!connectionResult.success) {
                return { success: false, message: connectionResult.message };
            }
            // Safebooru ignores credentials - they're not validated
            return {
                success: true,
                message: 'Authenticated Successfully! (Free Tier - credentials not required)',
                tier: 'free'
            };
        }

        // If no credentials and this site has free tier, test connectivity and return free tier message
        if (!hasCreds) {
            const connectionResult = await this.testConnection();
            if (!connectionResult.success) {
                return { success: false, message: connectionResult.message };
            }
            return {
                success: true,
                message: 'Authenticated Successfully! (Free Tier)',
                tier: 'free'
            };
        }

        // With credentials, test them by making an API call
        try {
            await this.throttle();

            const params = new URLSearchParams({
                page: 'dapi',
                s: 'post',
                q: 'index',
                json: 1,
                limit: 1,
                user_id: this.credentials.userId,
                api_key: this.credentials.apiKey
            });

            let cleanBaseUrl = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
            if (import.meta.env && import.meta.env.DEV) {
                if (cleanBaseUrl.includes('gelbooru.com')) cleanBaseUrl = '/api/gelbooru';
                if (cleanBaseUrl.includes('safebooru.org')) cleanBaseUrl = '/api/safebooru';
            }

            const url = `${cleanBaseUrl}/index.php?${params.toString()}`;
            console.log(`[Gelbooru] Testing authentication...`);

            const response = await httpFetch(url);

            if (response.status === 401 || response.status === 403) {
                return {
                    success: false,
                    message: 'Failed to Authenticate'
                };
            }

            if (!response.ok) {
                return {
                    success: false,
                    message: 'Failed to Authenticate'
                };
            }

            // Try to parse response - invalid credentials might still return 200 with error in body
            const text = await response.text();

            // Try to parse as JSON first
            try {
                const data = JSON.parse(text);
                // Check for explicit error responses from the API
                if (data.error || data.success === false) {
                    return {
                        success: false,
                        message: 'Failed to Authenticate'
                    };
                }
                // If we got valid JSON with posts or attributes, authentication worked
                return {
                    success: true,
                    message: 'Authenticated Successfully!',
                    tier: 'authenticated'
                };
            } catch (parseError) {
                // If not valid JSON, check for error text in the raw response
                const lowerText = text.toLowerCase();
                if (lowerText.includes('access denied') ||
                    lowerText.includes('invalid api') ||
                    lowerText.includes('authentication failed')) {
                    return {
                        success: false,
                        message: 'Failed to Authenticate'
                    };
                }
                // If we got a response that's not JSON but also not an obvious error, assume success
                return {
                    success: true,
                    message: 'Authenticated Successfully!',
                    tier: 'authenticated'
                };
            }
        } catch (error) {
            console.error('[Gelbooru] Auth test error:', error);
            return {
                success: false,
                message: 'Failed to Authenticate'
            };
        }
    }

    // Throttle helper to prevent 429 errors
    async throttle() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.minRequestInterval) {
            const waitTime = this.minRequestInterval - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        this.lastRequestTime = Date.now();
    }

    /**
     * Fetch tag categories from Gelbooru API for tags not in cache
     * @param {string[]} tags - Array of tag names to look up
     * @returns {Promise<void>}
     */
    async fetchTagCategories(tags) {
        // Only fetch tag categories for Gelbooru.com (not Safebooru or other sites)
        // Other Gelbooru-engine sites don't use the same tag API or require different auth
        if (!this.baseUrl.includes('gelbooru.com')) {
            return;
        }

        // Filter to only tags we haven't cached yet
        const uncachedTags = gelbooruTagCache.getUncachedTags(tags);
        if (uncachedTags.length === 0) return;

        // Batch tags in groups of 100 (API limit)
        const batchSize = 100;
        for (let i = 0; i < uncachedTags.length; i += batchSize) {
            const batch = uncachedTags.slice(i, i + batchSize);

            try {
                await this.throttle();

                // Build the tag query - Gelbooru accepts comma-separated names
                const tagQuery = batch.join(' ');

                // Build URL with authentication
                const params = new URLSearchParams({
                    page: 'dapi',
                    s: 'tag',
                    q: 'index',
                    json: '1',
                    limit: '100',
                    names: tagQuery,
                });

                // Add credentials if available
                if (this.credentials.userId) {
                    params.append('user_id', this.credentials.userId);
                }
                if (this.credentials.apiKey) {
                    params.append('api_key', this.credentials.apiKey);
                }

                const url = `/api/gelbooru/index.php?${params.toString()}`;
                console.log(`[Gelbooru] Fetching tag categories for ${batch.length} tags`);

                const response = await httpFetch(url);
                if (!response.ok) {
                    console.warn(`[Gelbooru] Tag API returned ${response.status}`);
                    // Mark these tags as general (0) on failure to prevent repeated requests
                    for (const tag of batch) {
                        gelbooruTagCache.setCategory(tag, 0);
                    }
                    continue;
                }

                const data = await response.json();

                // Process the response - it should be an array of tag objects
                let tagList = Array.isArray(data) ? data : (data.tag || []);

                // Map fetched tags to cache
                const fetchedTagNames = new Set();
                for (const tagObj of tagList) {
                    const name = tagObj.name || tagObj.tag;
                    const category = tagObj.type ?? tagObj.category ?? 0;
                    if (name) {
                        gelbooruTagCache.setCategory(name, category);
                        fetchedTagNames.add(name);
                    }
                }

                // Mark any tags that weren't found as general
                for (const tag of batch) {
                    if (!fetchedTagNames.has(tag)) {
                        gelbooruTagCache.setCategory(tag, 0);
                    }
                }

                console.log(`[Gelbooru] Cached ${tagList.length} tag categories`);
            } catch (error) {
                console.error('[Gelbooru] Error fetching tag categories:', error);
                // Mark as general on error
                for (const tag of batch) {
                    gelbooruTagCache.setCategory(tag, 0);
                }
            }
            // Note: With IndexedDB, saves happen incrementally via setCategory
        }
    }

    async getPosts({ tags, page, limit, sort, sortOrder, _isTest }) {
        // Gelbooru 0.2 syntax: index.php?page=dapi&s=post&q=index&json=1...
        // Safebooru matches this.

        let queryTags = tags;

        const params = new URLSearchParams({
            page: 'dapi',
            s: 'post',
            q: 'index',
            json: 1,
            limit: limit,
            pid: page - 1 // usually 0-indexed
        });

        if (this.credentials.userId && this.credentials.apiKey) {
            params.append('user_id', this.credentials.userId);
            params.append('api_key', this.credentials.apiKey);
        }

        if (queryTags) {
            let cleanTags = queryTags;

            // 1. Handle Ratings (Danbooru style 'rating:g,s' -> Gelbooru style 'rating:general rating:sensitive')
            // Match any rating: tag
            cleanTags = cleanTags.replace(/rating:([gsqe,]+)/g, (match, codeString) => {
                const codes = codeString.split(',');

                // If only one rating, use direct inclusion
                if (codes.length === 1) {
                    const c = codes[0];
                    if (c === 'g') return 'rating:general';
                    if (c === 's') return 'rating:sensitive';
                    if (c === 'q') return 'rating:questionable';
                    if (c === 'e') return 'rating:explicit';
                    return '';
                }

                // If multiple ratings, use NEGATION of the missing ones
                // This is safer than OR (~) which often fails for metatags
                const allCodes = ['g', 's', 'q', 'e'];
                const missingCodes = allCodes.filter(c => !codes.includes(c));

                const exclusions = missingCodes.map(c => {
                    if (c === 'g') return '-rating:general';
                    if (c === 's') return '-rating:sensitive';
                    if (c === 'q') return '-rating:questionable';
                    if (c === 'e') return '-rating:explicit';
                    return '';
                }).filter(t => t !== '');

                return exclusions.join(' ');
            });

            // 2. Handle Filetypes
            // Remove unsupported date/order tags
            cleanTags = cleanTags
                .replace(/date:\S+/g, '')
                .replace(/order:\S+/g, '');

            // Handle -filetype:mp4,webm,gif
            cleanTags = cleanTags.replace(/-filetype:([a-z0-9,]+)/g, (match, types) => {
                // Convert exclusion list to individual excluded tags
                const typeList = types.split(',');
                const exclusions = [];
                if (typeList.includes('mp4') || typeList.includes('webm')) {
                    if (this.supportsVideoFiles) exclusions.push('-video');
                }
                if (typeList.includes('gif')) {
                    exclusions.push('-animated_gif');
                }
                if (typeList.includes('swf')) {
                    exclusions.push('-flash'); // Gelbooru uses flash tag? or -filetype:swf works? Gelbooru usually supports filetype:swf.
                    // But safest for "image only" is likely excluding known video/anim tags.
                    // Actually let's just stick to the specific mappings we know
                }
                return exclusions.join(' ');
            });

            // Handle +filetype (inclusion) - rarely used for Gelbooru in this App but good to have
            cleanTags = cleanTags.replace(/filetype:([a-z0-9,]+)/g, (match, types) => {
                const typeList = types.split(',');
                if (typeList.includes('mp4') || typeList.includes('webm')) {
                    if (this.supportsVideoFiles) return 'video';
                }
                return '';
            });

            // 3. Handle 'age:' filters (convert to id range for Gelbooru)
            // Gelbooru doesn't support age/date, but we can approximate using IDs
            if (cleanTags.includes('age:')) {
                cleanTags = cleanTags.replace(/age:([<>])?(\d+)([a-z]+)/g, (match, operator, amount, unit) => {
                    return this.translateAgeToId(operator, amount, unit);
                });
            }

            // Cleanup and ensure sort order
            cleanTags = cleanTags.replace(/\s+/g, ' ').trim();

            // Apply sort if requested and not present in tags
            // Note: Gelbooru uses 'sort:score:desc'
            if (!cleanTags.includes('sort:') && (sort === 'score' || tags.includes('order:score') || tags.includes('order:rank'))) {
                cleanTags = `${cleanTags} sort:score:desc`;
            }

            // If cleanTags becomes empty due to stripping (e.g. valid 'date:>1d' became ''),
            // we default to 'sort:updated' to ensure we get recent posts instead of an error or empty set.
            if (cleanTags.length === 0) {
                cleanTags = 'sort:updated';
            }

            params.append('tags', cleanTags);
        }

        // SafeBooru / Gelbooru URL handling
        // Ensure strictly NO trailing slash before query
        let cleanBaseUrl = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;

        // Proxy rewriting for Development
        if (import.meta.env && import.meta.env.DEV) {
            if (cleanBaseUrl.includes('gelbooru.com')) cleanBaseUrl = '/api/gelbooru';
            if (cleanBaseUrl.includes('safebooru.org')) cleanBaseUrl = '/api/safebooru';
        }

        const url = `${cleanBaseUrl}/index.php?${params.toString()}`;

        try {
            // Rate limit requests to avoid 429 errors
            await this.throttle();
            console.log(`[Gelbooru] Fetching: ${url}`);
            const response = await httpFetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            // Safely handle non-JSON or empty responses
            const text = await response.text();
            if (!text || text.trim().length === 0) {
                console.warn(`[Gelbooru] Empty response from ${url}`);
                return [];
            }

            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                // If text is not JSON (e.g. XML or HTML), return empty
                console.warn(`[Gelbooru] Failed to parse JSON from ${url}:`, e);
                if (_isTest) throw new Error(`Failed to parse JSON response: ${e.message}`); // Re-throw for testConnection
                return [];
            }

            // Format check - Gelbooru API varies slightly by version/site
            let posts = [];
            if (Array.isArray(data)) {
                posts = data;
            } else if (data.post) {
                posts = Array.isArray(data.post) ? data.post : [data.post];
            }

            // Attach actual query for debugging
            const finalQueryTags = params.get('tags');

            // Normalize posts first
            const normalizedPosts = posts.filter(post => post.id && (post.file_url || post.image))
                .map(p => {
                    const normalized = this.normalizePost(p);
                    normalized._actualQuery = finalQueryTags;
                    return normalized;
                });

            // Collect all unique tags from all posts
            const allTags = new Set();
            for (const post of normalizedPosts) {
                if (post.tag_string) {
                    for (const tag of post.tag_string.split(' ')) {
                        if (tag) allTags.add(tag);
                    }
                }
            }

            // Fetch categories for any new tags (async but non-blocking for UX)
            // We'll still return posts immediately while categories are being fetched
            this.fetchTagCategories(Array.from(allTags)).then(() => {
                // Re-categorize tags on posts after cache is updated
                for (const post of normalizedPosts) {
                    this.applyTagCategories(post);
                }
            }).catch(e => console.error('[Gelbooru] Tag category fetch failed:', e));

            // Apply any cached categories immediately
            for (const post of normalizedPosts) {
                this.applyTagCategories(post);
            }

            return normalizedPosts;
        } catch (error) {
            console.error(`Error fetching from ${this.baseUrl}:`, error);
            if (_isTest) throw error; // Re-throw for testConnection to catch
            return [];
        }
    }

    /**
     * Apply tag categories from cache to a post
     * @param {Object} post - Normalized post object
     */
    applyTagCategories(post) {
        if (!post.tag_string) return;

        const tags = post.tag_string.split(' ').filter(t => t);
        const categorized = gelbooruTagCache.categorizeTags(tags);

        post.tag_string_general = categorized.general.join(' ');
        post.tag_string_artist = categorized.artist.join(' ');
        post.tag_string_character = categorized.character.join(' ');
        post.tag_string_copyright = categorized.copyright.join(' ');
        post.tag_string_meta = categorized.meta.join(' ');
    }

    normalizePost(post) {
        // Determine file URL
        // Safebooru/Gelbooru often gives 'directory' and 'image' relative paths, OR 'file_url' absolute (modern)
        let fileUrl = post.file_url;
        if (!fileUrl && post.directory && post.image) {
            // Basic construction for older gelbooru/safebooru (images/directory/image)
            const cleanBase = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
            fileUrl = `${cleanBase}/images/${post.directory}/${post.image}`;
        }

        const normalizedPost = {
            ...post, // Spread first so our explicit properties override
            id: Number(post.id),
            created_at: (() => {
                if (!post.created_at) return new Date().toISOString();
                // Check if it's a timestamp (numeric string or number)
                if (!isNaN(post.created_at)) {
                    return new Date(post.created_at * 1000).toISOString();
                }
                // Try parsing as date string
                const d = new Date(post.created_at);
                if (!isNaN(d.getTime())) return d.toISOString();
                return new Date().toISOString();
            })(),
            score: post.score,
            // Ensure width/height are numbers (both naming conventions for compatibility)
            width: Number(post.width) || 0,
            height: Number(post.height) || 0,
            image_width: Number(post.width) || 0,
            image_height: Number(post.height) || 0,
            // File size - Gelbooru may use 'file_size' or just 'size'
            file_size: Number(post.file_size || post.size || post.filesize) || 0,
            // Keep Gelbooru's authoritative CDN URL. Media display supplies the
            // required Referer separately; rewriting the host breaks current
            // img*.gelbooru.com video URLs and their TLS certificates.
            file_url: fileUrl || post.file_url,
            preview_file_url: post.preview_url,
            // Map rating properly
            rating: this.mapRating(post.rating),
            tag_string: post.tags,
            // Gelbooru doesn't provide tag categories in the posts API
            // All tags go to general for now
            tag_string_general: post.tags,
            tag_string_artist: '',
            tag_string_character: '',
            tag_string_copyright: '',
            tag_string_meta: '',
            // Gelbooru reports the uploader username directly as 'owner'
            uploader_name: post.owner || '',
            // Keep the artist-reported source before source becomes the booru URL
            original_source: post.source || '',
            source: this.baseUrl,
            directory: post.directory,
            image: post.image,
            post_url: `${this.baseUrl}/index.php?page=post&s=view&id=${post.id}`,
        };

        // Extract file extension from the FINAL file_url (after rewriting)
        normalizedPost.file_ext = normalizedPost.file_url
            ? normalizedPost.file_url.split('.').pop().split('?')[0]
            : (post.image ? post.image.split('.').pop() : 'jpg');

        return normalizedPost;
    }

    mapRating(rating) {
        if (!rating) return 'g'; // default to general
        const r = rating.toLowerCase();
        // Return short codes to match Danbooru format (g, s, q, e)
        if (r === 'safe' || r === 's' || r === 'general' || r === 'g') return 'g';
        if (r === 'sensitive') return 's';
        if (r === 'questionable' || r === 'q') return 'q';
        if (r === 'explicit' || r === 'e') return 'e';
        return 'g'; // fallback to general
    }

    /**
     * Fetch comments for a specific post from Gelbooru
     * Since the API is disabled, we scrape from the post page HTML
     * @param {number} postId - The ID of the post
     * @returns {Promise<Array>} - Array of normalized comments
     */
    async getComments(postId) {
        await this.throttle();

        // The API is disabled, so we scrape the post page directly
        let cleanBaseUrl = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
        if (import.meta.env && import.meta.env.DEV) {
            if (cleanBaseUrl.includes('gelbooru.com')) cleanBaseUrl = '/api/gelbooru';
            if (cleanBaseUrl.includes('safebooru.org')) cleanBaseUrl = '/api/safebooru';
        }

        const url = `${cleanBaseUrl}/index.php?page=post&s=view&id=${postId}`;

        try {
            console.log(`[Gelbooru] Fetching comments from post page ${postId}`);
            const response = await httpFetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const html = await response.text();

            // Parse comments from HTML
            const comments = this.parseCommentsFromHtml(html, postId);
            console.log(`[Gelbooru] Parsed ${comments.length} comments from HTML`);
            return comments;
        } catch (error) {
            console.error('[Gelbooru] Error fetching comments:', error);
            return [];
        }
    }

    /**
     * Parse comments from Gelbooru post page HTML
     * @param {string} html - The HTML content
     * @param {number} postId - The post ID
     * @returns {Array} - Array of normalized comments
     */
    parseCommentsFromHtml(html, postId) {
        const comments = [];

        // Debug: Check various patterns
        const hasCommentedAt = html.includes('commented at');
        const hasCommentBody = html.includes('commentBody');
        const hasUserComments = html.includes('User Comments');
        console.log(`[Gelbooru] HTML length: ${html.length}, has 'commented at': ${hasCommentedAt}, 'commentBody': ${hasCommentBody}, 'User Comments': ${hasUserComments}`);

        // Log a sample of the HTML around commentBody class
        if (hasCommentBody) {
            const idx = html.indexOf('commentBody');
            console.log('[Gelbooru] Sample around "commentBody":', html.substring(idx, idx + 400));
        }

        // Gelbooru comment structure:
        // <div class="commentBody ">
        //   <a href="..."><b>Username</b></a> commented at DATE » #ID<br><br>BODY<br><br>
        //   <span>...<span id="scID">SCORE</span> Points</span>
        //   <span>...Flag</span>
        // </div>

        // Match comments using the commentBody structure
        const commentRegex = /<div\s+class="commentBody[^"]*">\s*<a[^>]*><b>([^<]+)<\/b><\/a>\s*commented\s+at\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*(?:»|&raquo;|&#187;)\s*#(\d+)<br\s*\/?><br\s*\/?>([\s\S]*?)<span\s+id="sc\d+"[^>]*>(\d+)<\/span>\s*Points/gi;

        let match;
        let matchCount = 0;
        while ((match = commentRegex.exec(html)) !== null) {
            matchCount++;
            const creator = match[1].trim();
            const dateStr = match[2];
            const commentId = match[3];
            let body = match[4];
            const score = parseInt(match[5]) || 0;

            // Clean up the body
            body = body
                .replace(/<br\s*\/?>/gi, '\n')  // Convert <br> to newlines
                .replace(/<[^>]*>/g, '')         // Remove other HTML tags
                .replace(/&amp;/g, '&')          // Decode HTML entities
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#0?39;/g, "'")
                .replace(/&raquo;/g, '»')
                .replace(/&#187;/g, '»')
                .replace(/\n{3,}/g, '\n\n')      // Limit consecutive newlines
                .trim();

            console.log(`[Gelbooru] Matched comment #${commentId} by ${creator}, score ${score}: "${body.substring(0, 50)}..."`);

            if (body && body.length > 0) {
                comments.push(this.normalizeComment({
                    id: commentId,
                    post_id: postId,
                    body: body,
                    creator: creator,
                    created_at: dateStr,
                    score: score
                }));
            }
        }

        console.log(`[Gelbooru] Found ${comments.length} comments (${matchCount} regex matches)`);
        return comments;
    }

    normalizeComment(comment) {
        return {
            id: parseInt(comment.id) || 0,
            postId: comment.post_id,
            body: comment.body || '',
            // Gelbooru usually returns 'creator' as the username. Fallback to owner/user/username.
            creator: comment.creator || comment.owner || comment.user || comment.username || 'Anonymous',
            createdAt: comment.created_at || new Date().toISOString(),
            score: parseInt(comment.score) || 0
        };
    }
}

export class MoebooruAdapter extends BooruAdapter {
    constructor(baseUrl) {
        super(baseUrl, 'moebooru');
    }

    async getPosts({ tags, page, limit, _isTest }) {
        // Map Danbooru rating tags (g,s,q,e) to verbose tags
        const queryTags = tags
            .replace(/rating:g\b/g, 'rating:safe')
            .replace(/rating:s\b/g, 'rating:questionable')
            .replace(/rating:q\b/g, 'rating:questionable')
            .replace(/rating:e\b/g, 'rating:explicit');

        const params = new URLSearchParams({
            tags: queryTags,
            page: page,
            limit: limit
        });

        let cleanBaseUrl = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;

        // Proxy rewriting for Development
        if (import.meta.env && import.meta.env.DEV) {
            if (cleanBaseUrl === 'https://konachan.com') cleanBaseUrl = '/api/konachan';
            if (cleanBaseUrl === 'https://yande.re') cleanBaseUrl = '/api/yande';
        }

        const url = `${cleanBaseUrl}/post.json?${params.toString()}`;

        try {
            console.log(`[Moebooru] Fetching: ${url}`);
            const response = await httpFetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            return data.filter(p => p.file_url).map(p => this.normalizePost(p));
        } catch (error) {
            console.error(`Error fetching from ${this.baseUrl}:`, error);
            if (_isTest) throw error; // Re-throw for testConnection to catch
            return [];
        }
    }

    normalizePost(post) {
        return {
            ...post, // Spread first so the normalized properties below win
            id: post.id,
            created_at: post.created_at ? new Date(post.created_at * 1000).toISOString() : new Date().toISOString(),
            score: post.score,
            width: post.width,
            height: post.height,
            image_width: post.width,
            image_height: post.height,
            file_ext: post.file_url ? post.file_url.split('.').pop() : 'jpg',
            file_url: post.file_url,
            rating: this.mapRating(post.rating),
            tag_string: post.tags,
            tag_string_general: post.tags,
            // Moebooru reports the uploader username as 'author'
            uploader_name: post.author || '',
            // Keep the artist-reported source before source becomes the booru URL
            original_source: post.source || '',
            post_url: `${this.baseUrl}/post/show/${post.id}`,
            source: this.baseUrl,
        };
    }

    mapRating(rating) {
        if (!rating) return 'g';
        const r = rating.toLowerCase();
        // Return short codes to match Danbooru format (g, s, q, e)
        if (r === 's' || r === 'safe') return 'g'; // Moebooru 's' = safe = general
        if (r === 'q' || r === 'questionable') return 'q';
        if (r === 'e' || r === 'explicit') return 'e';
        return 'g';
    }

    /**
     * Fetch comments for a specific post from Moebooru
     * @param {number} postId - The ID of the post
     * @returns {Promise<Array>} - Array of normalized comments
     */
    async getComments(postId) {
        let cleanBaseUrl = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;

        // Proxy rewriting for Development
        if (import.meta.env && import.meta.env.DEV) {
            if (cleanBaseUrl === 'https://konachan.com') cleanBaseUrl = '/api/konachan';
            if (cleanBaseUrl === 'https://yande.re') cleanBaseUrl = '/api/yande';
        }

        const url = `${cleanBaseUrl}/comment.json?post_id=${postId}`;

        try {
            console.log(`[Moebooru] Fetching comments for post ${postId}`);
            const response = await httpFetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            return data.map(comment => this.normalizeComment(comment));
        } catch (error) {
            console.error('[Moebooru] Error fetching comments:', error);
            return [];
        }
    }

    normalizeComment(comment) {
        return {
            id: comment.id,
            postId: comment.post_id,
            body: comment.body || '',
            creator: comment.creator || comment.creator_name || comment.owner || 'Anonymous',
            createdAt: comment.created_at ? new Date(comment.created_at * 1000).toISOString() : new Date().toISOString(),
            score: parseInt(comment.score) || 0
        };
    }
}
