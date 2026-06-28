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
 * RecommendationSystem.js
 * Proxy class that forwards heavy recommendation logic to a Web Worker.
 */

import StorageService from './StorageService';
import BooruService from './BooruService';

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

class RecommendationSystem {
  constructor() {
    this.instanceId = instanceId;
    console.log(`[RecommendationSystem Proxy] Constructed instance #${this.instanceId}`);

    // Spawn Web Worker
    this.worker = new Worker(new URL('../workers/recommendation.worker.js', import.meta.url), { type: 'module' });
    this.messageId = 0;
    this.resolvers = new Map();

    // Local session state for strategy pagination cursors
    this.strategyCursors = {};

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
    return this.callWorker('initialize');
  }

  resetExploreSession() {
    this.strategyCursors = {};
    this.callWorker('resetExploreSession');
    console.log("Explore session reset");
  }

  async updateUserProfile() {
    return this.callWorker('updateUserProfile');
  }

  async resetRecommendations() {
    this.strategyCursors = {};
    return this.callWorker('resetRecommendations');
  }

  async trackInteraction(postId, interactionType, value, postData, updateImmediately = false) {
    return this.callWorker('trackInteraction', { postId, interactionType, value, postData, updateImmediately });
  }

  // Returns a promise now instead of a direct value
  async scorePost(post) {
    return this.callWorker('scorePost', post);
  }

  async getPostScoreDetails(post) {
    return this.callWorker('getPostScoreDetails', post);
  }

  async rankPosts(posts) {
    return this.callWorker('rankPosts', posts);
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
      const tagString = ' ' + (post.tag_string || '') + ' ';

      if (blacklist.some(tag => tagString.includes(' ' + tag + ' '))) return false;

      if (whitelist.length > 0) {
        if (!whitelist.every(tag => tagString.includes(' ' + tag + ' '))) {
          return false;
        }
      }
      return true;
    });
  }

  async getCuratedExploreFeed(fetchFunction, options = {}) {
    const {
      postsPerFetch = 20,
      maxTotal = 10,
      selectedRatings = ['general'],
      whitelist = [],
      blacklist = [],
      existingPostIds = new Set()
    } = options;

    await this.updateUserProfile();

    const queries = await this.generateMultiStrategyQueries(selectedRatings, whitelist);
    console.log("Explore queries:", queries);

    const buildHybridQuery = (baseQuery) => {
      let apiTags = baseQuery.tags ? baseQuery.tags.split(' ') : [];

      if (apiTags.includes('order:random')) {
        apiTags = apiTags.filter(tag => !tag.startsWith('order:'));
        apiTags.push('order:random');
      }

      const freeTags = [];

      if (selectedRatings && selectedRatings.length > 0) {
        const ratingMap = { 'general': 'g', 'sensitive': 's', 'questionable': 'q', 'explicit': 'e' };
        const shortRatings = selectedRatings.map(r => ratingMap[r] || r);
        freeTags.push(`rating:${shortRatings.join(',')}`);
      }

      freeTags.push('-filetype:zip,swf');

      if (options.wantsVideos && !options.wantsImages) {
        freeTags.push('filetype:mp4,webm');
      } else if (!options.wantsVideos && options.wantsImages) {
        freeTags.push('-filetype:mp4,webm,gif');
      }

      const baseTagCount = apiTags.filter(t => !t.startsWith('status:')).length;
      const whitelistCount = whitelist.length;
      const blacklistCount = blacklist.length;

      const totalExpensiveTags = baseTagCount + whitelistCount + blacklistCount;

      let clientSideFilterNeeded = false;
      let finalApiTags = [...apiTags];

      const tagLimit = BooruService.getTagLimit();

      if (totalExpensiveTags > tagLimit) {
        clientSideFilterNeeded = true;
        console.log(`Query "${baseQuery.tags}" + filters exceeds API limit (${totalExpensiveTags} > ${tagLimit}). Using Client-Side Filtering.`);
      } else {
        if (whitelist.length > 0) finalApiTags.push(...whitelist);
        if (blacklist.length > 0) finalApiTags.push(...blacklist.map(t => `-${t}`));
      }

      finalApiTags.push(...freeTags);

      return {
        apiQuery: { tags: finalApiTags.join(' ') },
        clientSideFilterNeeded,
        originalBaseTags: baseQuery.tags
      };
    };

    try {
      const fetchPromises = queries.map(query => {
        const { apiQuery, clientSideFilterNeeded } = buildHybridQuery(query);

        const limit = clientSideFilterNeeded ? 100 : postsPerFetch;

        const currentPage = this.strategyCursors[query.tags] || 1;
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
              if (clientSideFilterNeeded) {
                const appliedFilters = [];
                if (whitelist.length > 0) appliedFilters.push(...whitelist.map(t => `+${t}`));
                if (blacklist.length > 0) appliedFilters.push(...blacklist.map(t => `-${t}`));
                if (appliedFilters.length > 0) clientFilterString = appliedFilters.join(' ');
              }

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

              return post;
            });
          })
          .catch(error => {
            console.error(`Query failed for tags: ${query.tags}`, error);
            return [];
          });
      });

      const fetchResults = await Promise.all(fetchPromises);

      let allPosts = [];
      fetchResults.forEach((posts, index) => {
        const queryTags = queries[index].tags;
        const queryType = (queries[index].type || 'UNKNOWN').toUpperCase();

        if (posts && posts.length) {
          console.log(`Query [${queryType}] "${queryTags}" returned ${posts.length} posts`);
          allPosts = [...allPosts, ...posts];
        } else {
          console.warn(`Query [${queryType}] "${queryTags}" returned NO posts`);
        }
      });

      if (allPosts.length < 10) {
        console.log(`Only found ${allPosts.length} posts, trying fallback query`);
        try {
          const fallbackQuery = { tags: 'order:rank', page: 1 };
          const { apiQuery, clientSideFilterNeeded } = buildHybridQuery(fallbackQuery);
          const limit = clientSideFilterNeeded ? 100 : postsPerFetch;

          console.log(`Running fallback query: "${apiQuery.tags}" (ClientFilter: ${clientSideFilterNeeded})`);
          const fallbackPosts = await fetchFunction(apiQuery, limit);

          let processedFallbackPosts = fallbackPosts;
          if (clientSideFilterNeeded) {
            const beforeCount = processedFallbackPosts.length;
            processedFallbackPosts = this.applyClientSideFilters(processedFallbackPosts, { whitelist, blacklist });
            console.log(`Fallback Client-filter: ${beforeCount} -> ${processedFallbackPosts.length} posts`);
          }

          if (processedFallbackPosts && processedFallbackPosts.length) {
            console.log(`Fallback query found ${processedFallbackPosts.length} posts`);
            allPosts = [...allPosts, ...processedFallbackPosts];
          }
        } catch (fallbackError) {
          console.error("Fallback query failed:", fallbackError);
        }
      }

      if (allPosts.length === 0) {
        console.warn("All queries returned no posts. This should not happen with our conservative approach.");
        try {
          const lastResortBaseQuery = { tags: '' };
          const { apiQuery, clientSideFilterNeeded } = buildHybridQuery(lastResortBaseQuery);
          const limit = clientSideFilterNeeded ? 100 : postsPerFetch;

          console.log(`Trying last resort query: "${apiQuery.tags}" (ClientFilter: ${clientSideFilterNeeded})`);
          const lastResortPosts = await fetchFunction(apiQuery, limit);
          let processedLastResortPosts = lastResortPosts;

          if (clientSideFilterNeeded) {
            processedLastResortPosts = this.applyClientSideFilters(processedLastResortPosts, { whitelist, blacklist });
          }

          if (processedLastResortPosts && processedLastResortPosts.length) {
            console.log(`Last resort query found ${processedLastResortPosts.length} posts`);
            allPosts = processedLastResortPosts;
          } else {
            console.error("Last resort query returned no posts. API may be down or filters are too strict.");
          }
        } catch (lastResortError) {
          console.error("Last resort query failed:", lastResortError);
        }
      }

      const uniqueMap = new Map();
      allPosts.forEach(post => {
        const key = post.source ? `${post.source}|${post.id}` : String(post.id);
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, post);
        } else {
          const existing = uniqueMap.get(key);
          if (existing._strategy !== 'duo' && post._strategy === 'duo') {
            uniqueMap.set(key, post);
          }
        }
      });

      let uniquePosts = Array.from(uniqueMap.values());
      console.log(`Found ${uniquePosts.length} unique posts after deduplication`);

      if (existingPostIds.size > 0) {
        uniquePosts = uniquePosts.filter(post => {
          const key = post.source ? `${post.source}|${post.id}` : String(post.id);
          return !existingPostIds.has(key);
        });
      }

      const DISCOVERY_INTERVAL = 4;

      // Offload all mathematical scoring to the worker!
      const scoredPosts = await this.callWorker('scorePosts', uniquePosts);

      scoredPosts.sort((a, b) => b.score - a.score);

      const totalPosts = scoredPosts.length;
      const rankedCutoff = Math.floor(totalPosts * 0.6);

      const rankedBucket = scoredPosts.slice(0, rankedCutoff).map(sp => sp.post);
      const discoveryBucket = scoredPosts.slice(rankedCutoff).map(sp => sp.post);

      console.log(`Feed buckets: ${rankedBucket.length} ranked (top 60%), ${discoveryBucket.length} discovery (bottom 40%)`);
      if (scoredPosts.length > 0) {
        console.log(`Score range: ${scoredPosts[scoredPosts.length - 1].score.toFixed(2)} - ${scoredPosts[0].score.toFixed(2)}`);
      }

      const finalFeed = [];
      let rankedIndex = 0;
      let discoveryIndex = 0;

      for (let position = 0; finalFeed.length < Math.min(maxTotal, uniquePosts.length); position++) {
        if ((position + 1) % DISCOVERY_INTERVAL === 0 && discoveryIndex < discoveryBucket.length) {
          finalFeed.push(discoveryBucket[discoveryIndex++]);
        }
        else if (rankedIndex < rankedBucket.length) {
          finalFeed.push(rankedBucket[rankedIndex++]);
        }
        else if (discoveryIndex < discoveryBucket.length) {
          finalFeed.push(discoveryBucket[discoveryIndex++]);
        }
        else break;
      }

      const limitedFeed = finalFeed.slice(0, maxTotal);

      console.log(`Returning ${limitedFeed.length} curated posts (from ${finalFeed.length} ranked candidates)`);

      return limitedFeed;
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
