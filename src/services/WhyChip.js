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
 * adjacent, trending and wildcard arms, and exploration slots. A labelled
 * detour gets more patience than an unexplained one, so the note names
 * something the user knows: the liked tag that explains the pick
 * ("Because you liked Genshin Impact"), or failing that what the post is
 * ("New for you: Blue Archive"). Posts nothing can explain get no chip, and
 * posts the feed picked because they match known interests get none either.
 */
import { tagLabel } from './TasteNarrative.js';

export const WHY_CHIP_MS = 3500;

const IDENTITY_CATEGORIES = ['copyright', 'character', 'artist'];

function categoryOf(post, tag, known) {
  if (known) return known;
  return IDENTITY_CATEGORIES.find(category => (post[`tag_string_${category}`] || '').split(/\s+/).includes(tag)) || 'general';
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
  const discovery = post._explore || ['adjacent', 'trending', 'wildcard'].includes(post._strategy);
  if (!discovery) return null;
  const hidden = new Set([...blacklist, ...avoided].map(tag => String(tag).toLowerCase()));
  const label = (tag, category) => tagLabel({ tag, category: categoryOf(post, tag, category) });
  const reason = post._reason || {};
  // The liked tag on the post that best explains it (set at feed assembly).
  const liked = nameable(post, reason.liked?.tag, hidden) ? label(reason.liked.tag, reason.liked.category) : null;
  // A series, character or artist the post is about, for posts nothing liked explains.
  const subject = IDENTITY_CATEGORIES
    .flatMap(category => (post[`tag_string_${category}`] || '').split(/\s+/))
    .find(tag => nameable(post, tag, hidden));

  if (post._strategy === 'trending') {
    if (liked) return `Trending, because you liked ${liked}`;
    if (nameable(post, reason.tag, hidden)) return `Trending in ${label(reason.tag)}`;
    return 'Trending now';
  }
  // Adjacent picks neighbour one of the user's interests: name it.
  if (post._strategy === 'adjacent' && nameable(post, reason.via, hidden)) return `Because you liked ${label(reason.via, reason.viaCategory)}`;
  if (liked) return `Because you liked ${liked}`;
  if (post._strategy === 'adjacent' && nameable(post, reason.tag, hidden)) return `New for you: ${label(reason.tag)}`;
  if (subject) return `New for you: ${label(subject)}`;
  return null;
}
