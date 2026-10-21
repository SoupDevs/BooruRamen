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
 * RunwayCache.js
 * The main feed's unseen posts, kept across launches so the next start can
 * show something before the first booru request returns.
 *
 * What is saved: the posts queued ahead of the current one, and the
 * recommendation pool's leftover candidates. Each launch takes the entry
 * (it is deleted on read), and the feed filters it again against the
 * blacklist, reports and view history before showing anything.
 *
 * An entry is only used for the feed it was saved from (same sources,
 * whitelist and media filter) and only within RUNWAY_MAX_AGE_MS, so media
 * URLs and trends stay fresh. Deep Dive runways are never saved.
 */
import db from './db.js';

export const RUNWAY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const RUNWAY_SAVE_LIMIT = 15;
export const POOL_SAVE_LIMIT = 30;

const ENTRY_ID = 'singleton';
const plain = value => JSON.parse(JSON.stringify(value));

/**
 * @param {string} context - identifies the feed (see FeedView.runwayContext)
 * @param {Object[]} runway - posts queued ahead of the current one, in order
 * @param {Object[]} pool - leftover recommendation candidates
 */
export async function saveRunway(context, runway, pool) {
  try {
    const posts = runway.slice(0, RUNWAY_SAVE_LIMIT);
    const candidates = pool.slice(0, POOL_SAVE_LIMIT);
    if (!posts.length && !candidates.length) {
      await db.feedRunway.delete(ENTRY_ID);
      return;
    }
    await db.feedRunway.put({ id: ENTRY_ID, savedAt: Date.now(), context, runway: plain(posts), pool: plain(candidates) });
  } catch (error) {
    console.warn('[RunwayCache] Save failed:', error);
  }
}

/**
 * Remove and return the saved runway when it belongs to this feed and is
 * fresh enough, otherwise null.
 * @param {string} context
 * @param {number} [now]
 * @returns {Promise<{ runway: Object[], pool: Object[] } | null>}
 */
export async function takeRunway(context, now = Date.now()) {
  try {
    const entry = await db.feedRunway.get(ENTRY_ID);
    if (!entry) return null;
    await db.feedRunway.delete(ENTRY_ID);
    if (entry.context !== context || !(now - entry.savedAt < RUNWAY_MAX_AGE_MS)) return null;
    return { runway: entry.runway || [], pool: entry.pool || [] };
  } catch (error) {
    console.warn('[RunwayCache] Restore failed:', error);
    return null;
  }
}

export async function clearRunway() {
  try {
    await db.feedRunway.clear();
  } catch (error) {
    console.warn('[RunwayCache] Clear failed:', error);
  }
}

export default { saveRunway, takeRunway, clearRunway };
