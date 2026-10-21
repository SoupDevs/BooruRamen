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
 * RecommendationSystem.js
 * Proxy class that forwards heavy recommendation logic to a Web Worker.
 */

import StorageService from './StorageService';
import BooruService from './BooruService';
import { getActiveProfileDbName } from './ProfileService';
import imageAnalysis from './ImageAnalysisService.js';
import { hydrateImageAnalysis } from './ImageAnalysisCache.js';
import { excludeDuplicateContent } from './contentIdentity.js';
import { useSettingsStore } from '../stores/settings.js';
import { reactive } from 'vue';
import { postKey } from './postKey.js';

export const deepDiveState = reactive({ active: false, anchorKey: null, anchorId: null, busy: false, error: '', generation: 0 });

export const COMMON_TAGS = [
  '1girl', '1boy', '2girls', '2boys', 'solo', 'comic', 'monochrome',
  'greyscale', 'unknown_artist', 'text', 'commentary', 'translated',
  'multiple_girls', 'multiple_boys', 'scenery', 'original', 'highres',
  'absurdres', 'check_commentary', 'photo', 'parody',
  'long_hair', 'breasts', 'large_breasts', 'looking_at_user', 'short_hair',
  'animated', 'tagme', 'copyright_request', 'spoiler', 'source_request',
  'artist_request', 'character_request', 'cosplay_request', 'check_character',
  'duplicate', 'sound', 'looking_at_viewer', 'looking_at_another',
  'simple_background'
];

const instanceId = Math.floor(Math.random() * 10000);

const RATING_CODES = { general: 'g', sensitive: 's', questionable: 'q', explicit: 'e' };

// Unused candidates kept between feed fetches.
const POOL_CAP = 150;
const POOL_SKIP_FETCH_FACTOR = 3;

class RecommendationSystem {
  constructor() {
    this.instanceId = instanceId;
    console.log(`[RecommendationSystem Proxy] Constructed instance #${this.instanceId}`);

    // Spawn Web Worker. The worker can't read localStorage, so the active
    // profile's database name is passed as the worker name and picked up by
    // db.js via self.name.
    this.worker = new Worker(new URL('../workers/recommendation.worker.js', import.meta.url), {
      type: 'module',
      name: getActiveProfileDbName(),
    });
    this.messageId = 0;
    this.resolvers = new Map();
    this.sessionListeners = new Set();
    this.modeListeners = new Set();
    imageAnalysis.subscribe(async post => {
      try {
        await this.callWorker('imageAnalysisReady', post);
        if (deepDiveState.active) this.sessionListeners.forEach(listener => listener());
      } catch (error) { console.warn('[Recommendation] Visual update failed:', error.message); }
    });

    // Local session state for strategy pagination cursors
    this.strategyCursors = {};
    this.candidatePool = [];

    // Set up message listener from worker
    this.worker.onmessage = (e) => {
      const { id, type, result, error } = e.data;
      if (this.resolvers.has(id)) {
        const { resolve, reject } = this.resolvers.get(id);
        this.resolvers.delete(id);
        if (type === 'error') reject(new Error(error));
        else resolve(result);
      }
    };

    this.worker.onerror = (error) => {
      console.error('[RecommendationWorker] Fatal error:', error);
      // Reject all pending promises so the app doesn't hang
      for (const [id, { reject }] of this.resolvers.entries()) {
        reject(new Error(`Worker fatal error: ${error.message}`));
      }
      this.resolvers.clear();
    };
  }

  callWorker(type, payload = null) {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      this.resolvers.set(id, { resolve, reject });

      // Strip Vue reactive Proxy objects before sending to Web Worker
      // Web Workers cannot clone Proxy objects directly via structured clone algorithm
      let sanitizedPayload = payload;
      if (payload !== null && payload !== undefined) {
        try {
          sanitizedPayload = JSON.parse(JSON.stringify(payload));
        } catch (e) {
          console.warn('[RecommendationSystem] Failed to sanitize payload for Web Worker:', e);
        }
      }

      this.worker.postMessage({ id, type, payload: sanitizedPayload });
    });
  }

  async initialize() {
    this.strategyCursors = {};
    this.candidatePool = [];
    return this.callWorker('initialize');
  }

  resetExploreSession() {
    this.strategyCursors = {};
    this.candidatePool = [];
    this.callWorker('resetExploreSession');
    console.log("Explore session reset");
  }

  async updateUserProfile() {
    return this.callWorker('updateUserProfile');
  }

  async resetRecommendations() {
    this.strategyCursors = {};
    this.candidatePool = [];
    const result = await this.callWorker('resetRecommendations');
    this.publishDeepDive(null);
    return result;
  }

  async factoryReset() {
    this.strategyCursors = {};
    this.candidatePool = [];
    const result = await this.callWorker('factoryReset');
    this.publishDeepDive(null);
    return result;
  }

  async trackInteraction(postId, interactionType, value, postData, updateImmediately = false, context = null) {
    const result = await this.callWorker('trackInteraction', { postId, interactionType, value, postData, updateImmediately, context: context || { deepDive: deepDiveState.active } });
    if (postData && (value || interactionType === 'timeSpent')) this.sessionListeners.forEach(listener => listener());
    return result;
  }

  subscribeSession(listener) { this.sessionListeners.add(listener); return () => this.sessionListeners.delete(listener); }

  subscribeMode(listener) { this.modeListeners.add(listener); return () => this.modeListeners.delete(listener); }
  publishDeepDive(post) {
    Object.assign(deepDiveState, { active: !!post, anchorKey: post ? postKey(post) : null, anchorId: post?.id ?? null, generation: deepDiveState.generation + 1 });
    this.strategyCursors = {};
    this.candidatePool = [];
    this.modeListeners.forEach(listener => listener());
  }
  async setDeepDive(post = null) {
    if (deepDiveState.busy) return false;
    Object.assign(deepDiveState, { busy: true, error: '' });
    try {
      await this.callWorker('setDeepDive', post);
      this.publishDeepDive(post);
      return true;
    } catch (error) { deepDiveState.error = error.message; return false; }
    finally { deepDiveState.busy = false; }
  }

  // Returns a promise now instead of a direct value
  async scorePost(post) {
    return this.callWorker('scorePost', post);
  }

  async getPostScoreDetails(post) {
    return this.callWorker('getPostScoreDetails', post);
  }

  async rankPosts(posts, context = []) {
    return this.callWorker('rankPosts', { posts, context });
  }

  async summarizeTagScores(limit = 10) {
    return this.callWorker('summarizeTagScores', limit);
  }

  async getRecommendedTags(limit = 5) {
    return this.callWorker('getRecommendedTags', limit);
  }

  async getRecommendedRatings() {
    return this.callWorker('getRecommendedRatings');
  }

  async buildRecommendedQueryParams(includeUserTags = true) {
    return this.callWorker('buildRecommendedQueryParams', { includeUserTags });
  }

  async getQueryableTags() {
    return this.callWorker('getQueryableTags');
  }

  async getQueryableTagsWithScores() {
    return this.callWorker('getQueryableTagsWithScores');
  }

  async generateMultiStrategyQueries(selectedRatings = ['general'], whitelist = []) {
    return this.callWorker('generateMultiStrategyQueries', { selectedRatings, whitelist });
  }

  async selectNextBestPost(postPool) {
    return this.callWorker('selectNextBestPost', postPool);
  }

  async selectBanditTag() {
    return this.callWorker('selectBanditTag');
  }

  async getMLStats() {
    return this.callWorker('getMLStats');
  }

  async findSimilarTags(query, topK = 10, exclude = []) {
    return this.callWorker('findSimilarTags', { query, topK, exclude });
  }

  applyClientSideFilters(posts, { whitelist = [], blacklist = [] }) {
    if (!posts || posts.length === 0) return [];

    return posts.filter(post => {
      const tagString = ' ' + (post.tag_string || '').toLowerCase() + ' ';

      if (blacklist.some(tag => tagString.includes(' ' + String(tag).toLowerCase() + ' '))) return false;

      if (whitelist.length > 0) {
        if (!whitelist.every(tag => tagString.includes(' ' + String(tag).toLowerCase() + ' '))) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Final content gate every candidate passes before it can be shown: no
   * blacklisted tag, and a rating the feed asked for. The blacklist is
   * applied here rather than in the booru query so it never costs one of
   * the source's search-tag slots (Danbooru's free tier has two), and the
   * rating check keeps a source that ignores the rating metatag from
   * leaking other content. Posts without a rating are kept: every built-in
   * adapter fills one in.
   */
  applyContentFilters(posts, { blacklist = [], selectedRatings = [] } = {}) {
    const ratingCodes = new Set(selectedRatings.map(rating => RATING_CODES[rating] || rating));
    const allowed = this.applyClientSideFilters(posts, { blacklist });
    if (ratingCodes.size === 0) return allowed;
    return allowed.filter(post => !post.rating || ratingCodes.has(RATING_CODES[post.rating] || post.rating));
  }

  async getCuratedExploreFeed(fetchFunction, options = {}) {
    const modeGeneration = deepDiveState.generation;
    const {
      postsPerFetch = 20,
      maxTotal = 10,
      selectedRatings = ['general'],
      whitelist = [],
      blacklist = [],
      existingPostIds = new Set(),
      contextPosts = []
    } = options;

    // Only rebuilds when interactions arrived since the last build: the feed
    // can call this many times while filling one runway.
    await this.callWorker('refreshUserProfile');
    if (modeGeneration !== deepDiveState.generation) return [];

    // Candidates left over from earlier batches are re-scored with the
    // current profile and session. While the pool is deep the network is
    // skipped entirely, so refilling the runway is near-instant.
    const skipFetch = this.candidatePool.length >= maxTotal * POOL_SKIP_FETCH_FACTOR;
    const queries = skipFetch ? [] : await this.generateMultiStrategyQueries(selectedRatings, whitelist);
    console.log("Explore queries:", queries);

    const buildHybridQuery = (baseQuery) => {
      let apiTags = baseQuery.tags ? baseQuery.tags.split(' ') : [];

      if (apiTags.includes('order:random')) {
        apiTags = apiTags.filter(tag => !tag.startsWith('order:'));
        apiTags.push('order:random');
      }

      const freeTags = [];

      if (selectedRatings && selectedRatings.length > 0) {
        const shortRatings = selectedRatings.map(r => RATING_CODES[r] || r);
        freeTags.push(`rating:${shortRatings.join(',')}`);
      }

      // Ugoira (zip) are kept: Danbooru serves them as webm. Sources that
      // can't are filtered after the fetch (BooruService).
      if (options.wantsVideos && !options.wantsImages) {
        freeTags.push('filetype:mp4,webm,zip');
      } else if (!options.wantsVideos && options.wantsImages) {
        freeTags.push('-filetype:mp4,webm,gif,zip,swf');
      } else {
        freeTags.push('-filetype:swf');
      }

      const tagLimit = BooruService.getTagLimit();

      // freeTags (rating:, filetype:, -filetype:) are meta-tags that don't count
      // toward Danbooru's search tag limit, so we can always append them.
      // Positive tags (whitelist, then base) get the slots first. Slots left
      // over carry blacklist exclusions so the booru drops those posts
      // itself; the blacklist is also always applied locally
      // (applyContentFilters), so exclusions that don't fit cost nothing but
      // some fetched-and-discarded posts.
      const availableForSearch = tagLimit;

      // Prioritize whitelist tags (mandatory) then fill remaining slots with base tags
      const prioritizedTags = [...new Set([...whitelist, ...apiTags])];
      let finalApiTags = prioritizedTags.slice(0, availableForSearch);
      const spareSlots = availableForSearch - finalApiTags.length;
      if (spareSlots > 0) {
        finalApiTags.push(...[...new Set(blacklist)].slice(0, spareSlots).map(tag => `-${tag}`));
      }

      // Whitelist tags that didn't fit are checked client-side
      const clientSideFilterNeeded = prioritizedTags.length > availableForSearch;

      if (clientSideFilterNeeded) {
        console.log(`Query "${baseQuery.tags}" + filters exceeds API limit (${prioritizedTags.length} > ${availableForSearch}). Using Client-Side Filtering.`);
      }

      finalApiTags.push(...freeTags);

      return {
        apiQuery: { tags: finalApiTags.join(' ') },
        clientSideFilterNeeded,
        originalBaseTags: baseQuery.tags
      };
    };

    try {
      // Different strategies can collapse to the same API request once the
      // query is trimmed to the tag limit. Send each request only once.
      const seenRequests = new Set();
      const plannedQueries = [];
      for (const query of queries) {
        const built = buildHybridQuery(query);
        const currentPage = this.strategyCursors[query.tags] || 1;
        const requestKey = `${built.apiQuery.tags}|${currentPage}`;
        if (seenRequests.has(requestKey)) {
          console.log(`Skipping duplicate query: "${built.apiQuery.tags}" Page: ${currentPage}`);
          continue;
        }
        seenRequests.add(requestKey);
        plannedQueries.push({ query, built, currentPage });
      }

      const fetchPromises = plannedQueries.map(({ query, built, currentPage }) => {
        const { apiQuery, clientSideFilterNeeded } = built;

        const limit = clientSideFilterNeeded ? 100 : postsPerFetch;

        apiQuery.page = currentPage;

        console.log(`Processing query: "${apiQuery.tags}" Page: ${currentPage} (ClientFilter: ${clientSideFilterNeeded})`);

        return fetchFunction(apiQuery, limit)
          .then(async posts => {
            if (!posts || posts.length === 0) {
              this.callWorker('updateExhausted', query.tags);
              console.log(`Explorer: Strategy exhausted: "${query.tags}"`);
              return [];
            }

            let processedPosts = posts;

            if (clientSideFilterNeeded) {
              const beforeCount = processedPosts.length;
              processedPosts = this.applyClientSideFilters(processedPosts, { whitelist, blacklist });
              console.log(`Client-filter for "${query.tags}": ${beforeCount} -> ${processedPosts.length} posts`);
            }

            if (posts.length > 0) {
              this.strategyCursors[query.tags] = currentPage + 1;
            }

            return processedPosts.map(post => {
              const apiTagsSent = apiQuery.tags;
              let clientFilterString = 'None';
              const appliedFilters = [];
              if (clientSideFilterNeeded && whitelist.length > 0) appliedFilters.push(...whitelist.map(t => `+${t}`));
              if (blacklist.length > 0) appliedFilters.push(...blacklist.map(t => `-${t}`));
              if (appliedFilters.length > 0) clientFilterString = appliedFilters.join(' ');

              let sortOrder = 'dflt/random';
              if (apiTagsSent.includes('order:')) {
                const parts = apiTagsSent.split(' ');
                const orderTag = parts.find(t => t.startsWith('order:'));
                if (orderTag) sortOrder = orderTag.replace('order:', '');
              }

              let ratingDebug = 'N/A';
              if (apiTagsSent.includes('rating:')) {
                const parts = apiTagsSent.split(' ');
                const ratingTag = parts.find(t => t.startsWith('rating:'));
                if (ratingTag) ratingDebug = ratingTag.replace('rating:', '');
              } else if (selectedRatings && selectedRatings.length > 0) {
                ratingDebug = selectedRatings.join(',');
              }

              let filetypeDebug = 'N/A';
              if (options.wantsVideos && !options.wantsImages) filetypeDebug = 'Videos (Only)';
              else if (!options.wantsVideos && options.wantsImages) filetypeDebug = 'Images (Static Only - No GIF/Video)';
              else if (options.wantsVideos && options.wantsImages) filetypeDebug = 'All Media';

              post._debugMetadata = {
                apiQuery: apiTagsSent,
                clientFilters: clientFilterString,
                order: sortOrder,
                rating: ratingDebug,
                filetype: filetypeDebug,
                strategy: query.type || 'unknown',
                intent: query.intent || 'N/A'
              };

              post._strategy = query.type || 'unknown';
              post._searchCriteria = apiTagsSent;
              // What the "why this post" chip names (adjacent, trending).
              if (query.reason) post._reason = query.reason;

              return post;
            });
          })
          .catch(error => {
            console.error(`Query failed for tags: ${query.tags}`, error);
            return [];
          });
      });

      const fetchResults = await Promise.all(fetchPromises);
      if (modeGeneration !== deepDiveState.generation) return [];

      let allPosts = [];
      fetchResults.forEach((posts, index) => {
        const queryTags = plannedQueries[index].query.tags;
        const queryType = (plannedQueries[index].query.type || 'UNKNOWN').toUpperCase();

        if (posts && posts.length) {
          console.log(`Query [${queryType}] "${queryTags}" returned ${posts.length} posts`);
          allPosts = [...allPosts, ...posts];
        } else {
          console.warn(`Query [${queryType}] "${queryTags}" returned NO posts`);
        }
      });

      const prepare = async (posts) => {
        const uniqueMap = new Map();
        posts.forEach(post => {
          const key = post.source ? `${post.source}|${post.id}` : String(post.id);
          if (!uniqueMap.has(key)) uniqueMap.set(key, post);
        });
        let unique = this.applyContentFilters(Array.from(uniqueMap.values()), { blacklist, selectedRatings });
        await hydrateImageAnalysis(unique, { includeAi: useSettingsStore().aiTaggingEnabled });
        unique = excludeDuplicateContent(unique, existingPostIds);
        if (existingPostIds.size > 0) {
          unique = unique.filter(post => {
            const key = post.source ? `${post.source}|${post.id}` : String(post.id);
            return !existingPostIds.has(key);
          });
        }
        return unique;
      };

      // Broad queries with their own page cursors. They only run when the
      // strategies came back (nearly) all seen, and each call moves one page
      // deeper, so a long session keeps finding unseen posts instead of
      // re-requesting page 1 and running dry.
      const fetchFallback = async (tags) => {
        const cursorKey = `fallback:${tags}`;
        const { apiQuery, clientSideFilterNeeded } = buildHybridQuery({ tags });
        const page = this.strategyCursors[cursorKey] || 1;
        apiQuery.page = page;
        console.log(`Running fallback query: "${apiQuery.tags}" Page: ${page}`);
        const posts = await fetchFunction(apiQuery, clientSideFilterNeeded ? 100 : postsPerFetch);
        if (!posts || posts.length === 0) return [];
        this.strategyCursors[cursorKey] = page + 1;
        const filtered = clientSideFilterNeeded ? this.applyClientSideFilters(posts, { whitelist, blacklist }) : posts;
        return filtered.map(post => Object.assign(post, {
          _strategy: 'fallback',
          _searchCriteria: apiQuery.tags,
          _debugMetadata: { apiQuery: apiQuery.tags, strategy: 'fallback', intent: 'Broad fallback' }
        }));
      };

      // Every fetched post teaches the tag graph (adjacent interests,
      // trends, ubiquitous tags), seen or not. Fire and forget. Dive batches
      // are all about one post, so they would skew the feed's view of the
      // booru toward the dive's topic and are left out.
      if (allPosts.length && !deepDiveState.active) this.callWorker('observeCandidates', allPosts).catch(() => {});
      let uniquePosts = await prepare([...this.candidatePool, ...allPosts]);
      const minFresh = Math.min(5, maxTotal);
      const FALLBACK_QUERIES = ['order:rank', 'order:favcount', ''];
      for (let attempt = 0; uniquePosts.length < minFresh && !deepDiveState.active && attempt < FALLBACK_QUERIES.length * 2; attempt++) {
        let extra = [];
        try { extra = await fetchFallback(FALLBACK_QUERIES[attempt % FALLBACK_QUERIES.length]); }
        catch (fallbackError) { console.error('Fallback query failed:', fallbackError); }
        if (modeGeneration !== deepDiveState.generation) return [];
        if (extra.length) uniquePosts = await prepare([...uniquePosts, ...extra]);
      }
      console.log(`Found ${uniquePosts.length} unique posts after deduplication`);

      // Scoring, exploration and diversity all live in the worker.
      const { feed, rest } = await this.callWorker('assembleFeed', { posts: uniquePosts, options: { maxTotal, context: contextPosts.slice(-5) } });
      if (modeGeneration !== deepDiveState.generation) return [];
      this.candidatePool = rest.slice(0, POOL_CAP);
      console.log(`Returning ${feed.length} curated posts (${feed.filter(post => post._explore).length} exploratory), ${this.candidatePool.length} kept in the pool`);
      return feed;
    } catch (error) {
      console.error("Error fetching curated explore feed:", error);
      return [];
    }
  }

  normalizeRatingCode(ratingCode) {
    const ratingMap = {
      'g': 'general', 'general': 'general',
      's': 'sensitive', 'sensitive': 'sensitive',
      'q': 'questionable', 'questionable': 'questionable',
      'e': 'explicit', 'explicit': 'explicit'
    };
    return ratingMap[ratingCode] || ratingCode;
  }
}

const recommendationSystem = new RecommendationSystem();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    console.log("[HMR] Deposed RecommendationSystem Proxy");
    // Workers are automatically GC'd, or we could explicitly call terminate()
    if (recommendationSystem.worker) {
      recommendationSystem.worker.terminate();
    }
  });
}

export default recommendationSystem;
