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
 * The feed's default content filters.
 *
 * By default the feed is General-rated only, and a post with a blacklisted
 * tag is never shown. The app applies these after every plugin hook has run.
 * The only way to change them is the 'feed:filters' hook, so they hold until
 * the user turns on a plugin that changes them.
 */

/** Ratings the feed shows by default. */
export const FEED_RATINGS = Object.freeze(['general']);

export const CONTENT_POLICY = Object.freeze({
  ratings: FEED_RATINGS,
  // The blacklist is applied to fetched posts on this device, after plugins,
  // whatever the booru query said.
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
