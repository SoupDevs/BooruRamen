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
 * WhyChip.js
 * The short "why this post" note shown on discovery picks: posts from the
 * adjacent and trending arms, the global wildcard arm, and exploration
 * slots. A labelled detour gets more patience than an unexplained one.
 * Posts the feed picked because they match known interests get no chip.
 */
import { tagLabel } from './TasteNarrative.js';

export const WHY_CHIP_MS = 3500;
export const SOMETHING_DIFFERENT = 'Something different';

function categoryOf(post, tag) {
  for (const category of ['copyright', 'character', 'artist']) {
    if ((post[`tag_string_${category}`] || '').split(/\s+/).includes(tag)) return category;
  }
  return 'general';
}

/** A tag the chip may name: not a metatag, meta tag, blacklisted or avoided. */
function nameable(post, tag, hidden) {
  if (!tag || tag.includes(':') || hidden.has(tag)) return false;
  return !(post.tag_string_meta || '').split(/\s+/).includes(tag);
}

/**
 * @param {Object} post - a feed post (_strategy, _explore, _reason)
 * @param {Object} [options]
 * @param {string[]} [options.blacklist]
 * @param {string[]} [options.avoided] - tags the user asked the engine to ignore
 * @returns {string|null}
 */
export function whyChipText(post, { blacklist = [], avoided = [] } = {}) {
  if (!post) return null;
  const hidden = new Set([...blacklist, ...avoided].map(tag => String(tag).toLowerCase()));
  const label = tag => tagLabel({ tag, category: categoryOf(post, tag) });
  const reason = post._reason || {};
  if (post._strategy === 'adjacent') {
    if (nameable(post, reason.via, hidden)) return `New for you: close to ${label(reason.via)}`;
    if (nameable(post, reason.tag, hidden)) return `New for you: ${label(reason.tag)}`;
    return SOMETHING_DIFFERENT;
  }
  if (post._strategy === 'trending') {
    if (nameable(post, reason.tag, hidden)) return reason.personal ? `Trending near ${label(reason.tag)}` : `Hot right now in ${label(reason.tag)}`;
    return SOMETHING_DIFFERENT;
  }
  if (post._strategy === 'wildcard' || post._explore) return SOMETHING_DIFFERENT;
  return null;
}
