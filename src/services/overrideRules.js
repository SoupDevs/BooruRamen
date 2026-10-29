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
 * overrideRules.js
 * The user's Never Include override rules beyond plain tags. They only ever
 * narrow what is shown: the feed narrows its query where it builds it, and
 * every fetched post is checked here as well.
 */

const CODES = { general: 'g', sensitive: 's', questionable: 'q', explicit: 'e' };
const ALIASES = { g: 'general', s: 'sensitive', q: 'questionable', e: 'explicit', safe: 'general' };

/** The rule options, in display order. */
export const NEVER_INCLUDE_OPTIONS = Object.freeze(Object.keys(CODES));

const normalize = value => {
  const name = String(value || '').trim().toLowerCase();
  return ALIASES[name] || name;
};

/**
 * A saved Never Include list, de-duplicated and limited to known options.
 * @param {unknown} list
 * @returns {string[]}
 */
export function sanitizeNeverInclude(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(normalize))].filter(name => name in CODES);
}

/**
 * The given options minus the ones the rules exclude. An empty result means
 * nothing may be fetched.
 * @param {string[]} options
 * @param {string[]} neverInclude
 * @returns {string[]}
 */
export function withoutNeverIncluded(options, neverInclude) {
  const never = new Set(sanitizeNeverInclude(neverInclude));
  return (options || []).filter(option => !never.has(normalize(option)));
}

/**
 * Drop posts the rules exclude. Posts the source didn't classify are kept,
 * as in the feed's own filters: every built-in adapter fills one in.
 * @param {object[]} posts
 * @param {string[]} neverInclude
 * @returns {object[]}
 */
export function applyNeverInclude(posts, neverInclude) {
  const never = new Set(sanitizeNeverInclude(neverInclude));
  if (never.size === 0) return posts;
  return (posts || []).filter(post => !post || !post.rating || !never.has(normalize(post.rating)));
}
