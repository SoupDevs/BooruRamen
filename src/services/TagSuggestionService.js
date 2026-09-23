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
 * TagSuggestionService.js
 * Instant autocomplete for the whitelist/blacklist tag fields.
 *
 * Two layers, cheapest first:
 *  - a local index of every tag this install has already seen (feed posts,
 *    view history, the tag category cache). Matching is character-order-wise
 *    so "me" finds "meme", "tail" finds "shark_tail", and "shtail" - where
 *    "sh" comes before "tail" - still finds "shark_tail".
 *  - a best-effort remote lookup against the enabled sources for tags the
 *    local index has never seen. Danbooru exposes an autocomplete endpoint and
 *    Moebooru matches prefix/substring tags; the Gelbooru-family dapis only
 *    answer exact-name lookups, so those sources stay on the local layer.
 *
 * Nothing here touches IndexedDB at import time (the heavy modules load
 * lazily inside prime()), so suggest() can never wait on a database.
 */

// Remote answers are cached per query string; the cache is dropped wholesale
// once it grows past this, which keeps a long typing session bounded.
const MAX_REMOTE_CACHE = 60;

const normalize = (value) => (value == null ? '' : String(value)).toLowerCase().trim();

/** True when every character of `needle` appears in `hay` in order. */
function isSubsequence(needle, hay) {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i += 1;
  }
  return i === needle.length;
}

/**
 * Match cost of `query` against `tag`, lower is better, or null for no match.
 * 0 exact, 1 prefix, 2 word-part prefix ("shark_tail" for "tail"),
 * 3 substring, 4 character-order-wise (subsequence).
 */
export function scoreTag(tag, query) {
  const t = normalize(tag);
  const q = normalize(query);
  if (!t || !q) return null;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  // Underscore/space/dash separated parts: booru tags read as word sequences.
  if (t.split(/[_\s\-/]+/).some((part) => part.length > 0 && part.startsWith(q))) return 2;
  if (t.includes(q)) return 3;
  if (isSubsequence(q, t)) return 4;
  return null;
}

class TagSuggestionService {
  constructor() {
    this.tags = new Set();
    this.primePromise = null;
    this.remoteCache = new Map();
    this.lastRemoteQuery = '';
  }

  /**
   * Add tags from a space-separated tag string or an array of tags.
   * @returns {number} how many tags were new to the index
   */
  ingestTags(source) {
    if (!source) return 0;
    const list = Array.isArray(source) ? source : String(source).split(/\s+/);
    let added = 0;
    for (const raw of list) {
      const tag = normalize(raw);
      if (!tag) continue;
      if (!this.tags.has(tag)) {
        this.tags.add(tag);
        added += 1;
      }
    }
    return added;
  }

  /** Number of tags currently in the local index. */
  get size() {
    return this.tags.size;
  }

  /**
   * Load the persistent sources of known tags (category cache + view history)
   * once per session. Safe to call on every dropdown open; only the first call
   * does work, and failures degrade to an empty-but-working local index.
   */
  async prime() {
    if (this.primePromise) return this.primePromise;
    this.primePromise = (async () => {
      try {
        const { gelbooruTagCache } = await import('./GelbooruTagCache.js');
        await gelbooruTagCache.init();
        for (const tag of gelbooruTagCache.memoryCache.keys()) {
          this.ingestTags([tag]);
        }
      } catch (e) {
        console.warn('[TagSuggestion] tag category cache unavailable:', e);
      }

      try {
        const { default: StorageService } = await import('./StorageService.js');
        const history = await StorageService.getViewedPosts();
        for (const entry of Object.values(history || {})) {
          const post = entry && entry.data;
          if (!post) continue;
          this.ingestTags(post.tag_string || post.tags || '');
        }
      } catch (e) {
        console.warn('[TagSuggestion] view history unavailable:', e);
      }
    })();
    return this.primePromise;
  }

  /**
   * Synchronous suggestions from the local index.
   * @param {string} query - what the user has typed so far
   * @param {object} [options]
   * @param {number} [options.limit] - max suggestions (default 8)
   * @param {string[]} [options.exclude] - tags already in the list being edited
   * @returns {string[]} ranked tag names
   */
  suggest(query, { limit = 8, exclude = [] } = {}) {
    const q = normalize(query);
    if (!q) return [];
    const skip = new Set((exclude || []).map(normalize));

    const scored = [];
    for (const tag of this.tags) {
      if (skip.has(tag)) continue;
      const cost = scoreTag(tag, q);
      if (cost !== null) scored.push([cost, tag]);
    }

    scored.sort((a, b) => (
      a[0] - b[0] ||
      a[1].length - b[1].length ||
      (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)
    ));
    return scored.slice(0, limit).map((entry) => entry[1]);
  }

  /**
   * Best-effort remote tags from every enabled source. Resolves to [] on any
   * failure so a slow or blocked source never delays the local suggestions.
   * @param {string} query
   * @param {number} [limit]
   * @returns {Promise<string[]>}
   */
  async remoteSuggest(query, limit = 10) {
    const q = normalize(query);
    if (!q) return [];
    if (this.remoteCache.has(q)) return this.remoteCache.get(q);

    let results = [];
    try {
      const { default: BooruService } = await import('./BooruService.js');
      results = await BooruService.searchTags(q, limit);
    } catch (e) {
      console.warn('[TagSuggestion] remote tag lookup failed:', e);
      results = [];
    }

    results = [...new Set(results.map(normalize).filter(Boolean))];
    if (this.remoteCache.size >= MAX_REMOTE_CACHE) this.remoteCache.clear();
    this.remoteCache.set(q, results);
    return results;
  }

  /**
   * The query the most recent remoteSuggest() call was made for. Lets a UI
   * drop an answer that arrived after the user kept typing.
   */
  markRemoteQuery(query) {
    this.lastRemoteQuery = normalize(query);
  }

  isRemoteQueryCurrent(query) {
    return this.lastRemoteQuery === normalize(query);
  }
}

// Singleton instance
export const tagSuggestionService = new TagSuggestionService();
export default tagSuggestionService;
