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
 * feedHooks.js
 * The feed's plugin hooks: what it searches for, which fetched posts it
 * keeps, how it ranks them, the order of each batch, and what the user did.
 *
 * None of them can widen what the feed shows. Rating metatags are stripped
 * from plugin searches and the app's own rating is added back; every post,
 * including one a plugin adds, passes the app's content gate (rating and
 * blacklist) after these hooks run; and a batch can only be reordered or
 * shortened, never given posts it didn't contain.
 */
import pluginHost from './PluginHost.js';
import { stripRatingMetatags } from './contentPolicy.js';
import { postKey } from '../services/postKey.js';
import { MAX_PLUGIN_QUERIES, MAX_SCORE_WEIGHT } from './limits.js';

export { MAX_PLUGIN_QUERIES, MAX_SCORE_WEIGHT };

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clampWeight = weight => Math.min(MAX_SCORE_WEIGHT, Math.max(0, weight));

function sanitizeQueries(result) {
  if (!Array.isArray(result)) throw new Error('must return an array of queries');
  return result.slice(0, MAX_PLUGIN_QUERIES).map(item => {
    const query = typeof item === 'string' ? { tags: item } : item;
    if (!isPlainObject(query) || typeof query.tags !== 'string') throw new Error('each query needs a tags string');
    return {
      ...query,
      tags: stripRatingMetatags(query.tags),
      type: typeof query.type === 'string' && query.type ? query.type : 'plugin',
      intent: typeof query.intent === 'string' ? query.intent : 'Added by a plugin',
      ...(isPlainObject(query.reason) ? {} : { reason: undefined }),
    };
  });
}

function sanitizeRequest(result) {
  if (typeof result !== 'string') throw new Error('must return a tag string');
  return stripRatingMetatags(result);
}

function sanitizePosts(result) {
  if (!Array.isArray(result)) throw new Error('must return an array of posts');
  if (!result.every(post => isPlainObject(post) && post.id != null)) throw new Error('each post needs an id');
  return result;
}

function sanitizeWeights(result, previous) {
  if (!Array.isArray(result) || result.length !== previous.length) throw new Error('must return one weight per post');
  return result.map((weight, index) => (Number.isFinite(weight) ? clampWeight(weight) : previous[index]));
}

// A batch may be reordered or shortened; posts it didn't contain are dropped.
function sanitizeBatch(result, previous) {
  if (!Array.isArray(result)) throw new Error('must return an array of posts');
  const allowed = new Map(previous.map(post => [postKey(post), post]));
  const seen = new Set();
  const kept = [];
  for (const post of result) {
    const key = postKey(post);
    if (!allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    kept.push(allowed.get(key));
  }
  return kept;
}

pluginHost.defineHook('feed:queries', {
  kind: 'waterfall',
  label: 'Feed searches',
  description: 'The strategy queries for the next batch: add, remove or change them.',
  sanitize: sanitizeQueries,
});
pluginHost.defineHook('feed:request', {
  kind: 'waterfall',
  label: 'Search tags',
  description: 'The tag string of one booru request, after whitelist and blacklist tags were added.',
  sanitize: sanitizeRequest,
});
pluginHost.defineHook('feed:posts', {
  kind: 'waterfall',
  label: 'Fetched posts',
  description: 'The posts one request returned: filter, annotate or add to them.',
  sanitize: sanitizePosts,
});
pluginHost.defineHook('feed:score', {
  kind: 'waterfall',
  label: 'Ranking',
  description: 'One ranking multiplier per candidate post.',
  sanitize: sanitizeWeights,
});
pluginHost.defineHook('feed:batch', {
  kind: 'waterfall',
  label: 'Batch order',
  description: 'The posts about to be added to the feed: reorder or drop them.',
  sanitize: sanitizeBatch,
});
pluginHost.defineHook('post:interaction', {
  kind: 'event',
  label: 'Interactions',
  description: 'A like, dislike, favorite, watch time or other signal was recorded.',
});
pluginHost.defineHook('feed:postShown', {
  kind: 'event',
  label: 'Shown posts',
  description: 'A post became the current post in the feed.',
});

// The feed's pool of ranked candidates, emptied when a plugin asks so that
// its new settings shape the next batch.
const invalidateListeners = new Set();
export function onFeedInvalidated(listener) {
  invalidateListeners.add(listener);
  return () => invalidateListeners.delete(listener);
}

pluginHost.extendApi('feed', ({ api }) => Object.freeze({
  /** Drop queued candidates so the next batch is fetched and ranked afresh. */
  invalidate: () => invalidateListeners.forEach(listener => listener()),
  /**
   * Sugar for 'feed:score': fn(post, context) returns a multiplier (1 keeps
   * the score, 0 sinks the post, 2 doubles it).
   */
  scorePosts: (fn, options) => api.on('feed:score', async (weights, context) => {
    const next = [];
    for (let index = 0; index < weights.length; index++) {
      const factor = await fn(context.posts[index], context);
      next.push(Number.isFinite(factor) ? weights[index] * factor : weights[index]);
    }
    return next;
  }, options),
}));

/** The strategy queries after plugins. */
export async function runQueryHook(queries, context) {
  if (!pluginHost.hasHandlers('feed:queries')) return queries;
  return pluginHost.run('feed:queries', queries, Object.freeze({ ...context }));
}

/** One request's tag string after plugins, with rating metatags removed. */
export async function runRequestHook(tags, context) {
  if (!pluginHost.hasHandlers('feed:request')) return tags;
  return pluginHost.run('feed:request', tags, Object.freeze({ ...context }));
}

/** One request's posts after plugins. */
export async function runPostsHook(posts, context) {
  if (!pluginHost.hasHandlers('feed:posts')) return posts;
  return pluginHost.run('feed:posts', posts, Object.freeze({ ...context }));
}

/**
 * Ask plugins for ranking multipliers and store each on its post as
 * _pluginWeight, which the recommendation worker multiplies into the score.
 */
export async function applyScoreHook(posts, context) {
  for (const post of posts) delete post._pluginWeight;
  if (!posts.length || !pluginHost.hasHandlers('feed:score')) return posts;
  const weights = await pluginHost.run('feed:score', posts.map(() => 1), Object.freeze({ ...context, posts }));
  posts.forEach((post, index) => { if (weights[index] !== 1) post._pluginWeight = weights[index]; });
  return posts;
}

/** The assembled batch after plugins: a reordered subset of it. */
export async function runBatchHook(feed, context) {
  if (!feed.length || !pluginHost.hasHandlers('feed:batch')) return feed;
  return pluginHost.run('feed:batch', feed, Object.freeze({ ...context }));
}

export function emitInteraction(payload) {
  if (pluginHost.hasHandlers('post:interaction')) pluginHost.emit('post:interaction', Object.freeze(payload));
}

export function emitPostShown(payload) {
  if (pluginHost.hasHandlers('feed:postShown')) pluginHost.emit('feed:postShown', Object.freeze(payload));
}
