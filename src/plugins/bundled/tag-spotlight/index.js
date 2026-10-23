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
 * Tag Spotlight: the example plugin. It favours posts with tags you pick,
 * searches for them now and then, marks them in the feed, and keeps a small
 * tally of how they did. Each part shows one area of the plugin API; see
 * docs/PLUGINS.md.
 */
import { definePlugin } from '../../definePlugin.js';
import SpotlightStats from './SpotlightStats.vue';

const tagsOf = post => new Set(String(post?.tag_string || '').toLowerCase().split(/\s+/).filter(Boolean));

export default definePlugin({
  id: 'tag-spotlight',
  name: 'Tag Spotlight',
  version: '1.0.0',
  author: 'SoupDevs',
  description: 'Example plugin: ranks posts with your spotlight tags higher, searches for them, and marks them in the feed.',
  settings: [
    { key: 'tags', type: 'tags', label: 'Spotlight tags', description: 'Comma or space separated' },
    { key: 'strength', type: 'number', label: 'Ranking boost', description: 'Score multiplier for spotlight posts (1-4)', default: 2, min: 1, max: 4, step: 0.5 },
    { key: 'search', type: 'boolean', label: 'Search for them', description: 'Add one spotlight tag to each batch\'s searches', default: true },
    { key: 'badge', type: 'boolean', label: 'Show a badge', description: 'Mark spotlight posts in the feed', default: true },
    { key: 'inDeepDive', type: 'boolean', label: 'Also in Deep Dive', default: false },
  ],

  setup(api) {
    const { h, ref } = api.vue;
    const spotlight = () => new Set(api.settings.get('tags'));
    const matches = post => [...tagsOf(post)].filter(tag => spotlight().has(tag));
    const active = context => !context.deepDive || api.settings.get('inDeepDive');

    // Searches: one spotlight tag per batch, taking turns.
    let turn = 0;
    api.on('feed:queries', (queries, context) => {
      const tags = [...spotlight()];
      if (!tags.length || !api.settings.get('search') || !active(context)) return;
      const tag = tags[turn++ % tags.length];
      return [...queries, { tags: tag, type: 'spotlight', intent: `Spotlight tag "${tag}"` }];
    });

    // Ranking: a multiplier for posts with any spotlight tag.
    api.feed.scorePosts((post, context) => (active(context) && matches(post).length ? api.settings.get('strength') : 1));

    // A tally per tag of spotlight posts shown and liked, kept across launches.
    const bump = (post, field) => {
      const tally = api.storage.get('tally', {});
      for (const tag of matches(post)) {
        tally[tag] = { shown: 0, liked: 0, ...tally[tag] };
        tally[tag][field]++;
      }
      api.storage.set('tally', tally);
    };
    api.on('feed:postShown', ({ post }) => bump(post, 'shown'));
    api.on('post:interaction', ({ type, value, post }) => { if (type === 'like' && value > 0) bump(post, 'liked'); });

    // A badge over spotlight posts in the feed.
    api.ui.addToSlot('feed.post', {
      props: ['post', 'current'],
      setup(props) {
        return () => {
          const tags = matches(props.post);
          if (!tags.length || !api.settings.get('badge')) return null;
          return h('div', {
            class: 'absolute left-3 rounded-full bg-black/40 text-white/90 text-[11px] font-medium leading-5 px-2.5 backdrop-blur-sm ring-1 ring-pink-500/60',
            style: { top: 'calc(3.25rem + env(safe-area-inset-top, 0px))' },
            'data-tag-spotlight-badge': '',
          }, `★ ${tags.join(', ')}`);
        };
      },
    });

    // In post details: spotlight a tag of this post, or stop.
    api.ui.addToSlot('post.details', {
      props: ['post'],
      setup(props) {
        // Settings aren't reactive; bumping this re-renders after a toggle.
        const changes = ref(0);
        const toggle = tag => {
          changes.value++;
          const next = new Set(api.settings.get('tags'));
          if (next.has(tag)) next.delete(tag); else next.add(tag);
          api.settings.set('tags', [...next]);
          api.ui.notify(next.has(tag) ? `Spotlighting ${tag}` : `Stopped spotlighting ${tag}`);
        };
        return () => {
          void changes.value;
          const tags = [...tagsOf(props.post)].filter(tag => !tag.includes(':')).slice(0, 12);
          if (!tags.length) return null;
          return h('div', [
            h('h3', { class: 'text-sm font-medium text-gray-400 mb-1' }, 'Tag Spotlight'),
            h('div', { class: 'flex flex-wrap gap-1' }, tags.map(tag => h('button', {
              class: ['text-xs px-2 py-0.5 rounded', spotlight().has(tag) ? 'bg-pink-600 text-white' : 'bg-gray-700 text-gray-200'],
              onClick: () => toggle(tag),
            }, tag))),
          ]);
        };
      },
    });

    // A page with the tally, linked from the Plugins page.
    api.ui.addPage({
      id: 'stats',
      title: 'Tag Spotlight',
      description: 'How your spotlight tags are doing',
      component: { setup: () => () => h(SpotlightStats, { api }) },
    });

    // New settings shape the very next batch.
    api.settings.onChange(() => api.feed.invalidate());
  },
});
