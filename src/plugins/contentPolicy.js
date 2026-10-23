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
 * contentPolicy.js
 * The content rules plugins can read but never change.
 *
 * The feed is General-rated only, and a post with a blacklisted tag is never
 * shown. Both are enforced by the app after every plugin hook has run, so a
 * plugin can narrow what is shown but not widen it. Changing either rule is
 * a change to this file, not something a plugin can ask for.
 */

/** Ratings the feed may show. */
export const FEED_RATINGS = Object.freeze(['general']);

export const CONTENT_POLICY = Object.freeze({
  ratings: FEED_RATINGS,
  // The blacklist is always applied to fetched posts on this device, after
  // plugins, whatever the booru query said.
  blacklistAlwaysFiltered: true,
});

// is: values that select a rating (Danbooru's is:sfw, is:explicit, ...).
// Other is: searches (is:parent) are left alone.
const RATING_IS_VALUES = new Set(['sfw', 'nsfw', 'g', 's', 'q', 'e', 'general', 'safe', 'sensitive', 'questionable', 'explicit']);

/**
 * Remove rating-selecting metatags (rating:, -rating:, ~rating:, is:nsfw)
 * from a space-separated tag string a plugin produced. The app adds its own
 * rating metatag to every query; one from a plugin would contradict it.
 * @param {string} tags
 * @returns {string}
 */
export function stripRatingMetatags(tags) {
  return String(tags || '')
    .split(/\s+/)
    .filter(tag => {
      if (!tag) return false;
      const [name, value = ''] = tag.replace(/^[-~]/, '').toLowerCase().split(':');
      if (!tag.includes(':')) return true;
      if (name === 'rating') return false;
      return !(name === 'is' && RATING_IS_VALUES.has(value));
    })
    .join(' ');
}
