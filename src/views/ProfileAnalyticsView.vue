<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div class="p-4 text-white pb-20 h-full overflow-y-auto">
    <div class="max-w-6xl mx-auto space-y-5">
      <header>
        <h1 class="text-3xl font-bold">Your Taste</h1>
        <p class="text-sm text-gray-400 mt-1">What you like, how you engage, and why the feed thinks so. Built from your activity on this device.</p>
      </header>

      <div v-if="loading" class="flex justify-center py-12">
        <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-pink-500"></div>
      </div>

      <template v-else>
        <!-- The story -->
        <section class="bg-gray-800 rounded-lg p-5">
          <div v-for="section in story.sections" :key="section.title" class="mb-4 last:mb-0">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-pink-400 mb-1">{{ section.title }}</h2>
            <p class="text-gray-100 leading-relaxed">{{ section.sentences.join(' ') }}</p>
          </div>
          <p class="text-xs text-gray-500 mt-4">Written from your interactions with fixed rules, not an AI model. Deep Dives are left out, and your avoided tags are ignored.</p>
        </section>

        <template v-if="story.ready">
          <!-- Tag map + why -->
          <section class="grid gap-4 lg:grid-cols-3">
            <div class="bg-gray-800 rounded-lg p-4 lg:col-span-2">
              <h2 class="text-lg font-bold mb-1">Your tag map</h2>
              <p class="text-xs text-gray-400 mb-3">The tags you respond to most, linked when you enjoy them together. Tap one to see why it's here.</p>
              <TagMap v-if="analysis.graph.nodes.length" :graph="analysis.graph" :selected-tag="selectedTag" @select="selectedTag = $event" />
              <p v-else class="text-sm text-gray-500">Not enough engaged posts to draw a map yet.</p>
            </div>

            <div class="bg-gray-800 rounded-lg p-4">
              <template v-if="selected">
                <p class="text-xs uppercase tracking-wider text-gray-400">{{ categoryNames[selected.category] }}</p>
                <h2 class="text-xl font-bold break-words">{{ label(selected) }}</h2>
                <p class="text-sm text-gray-300 mt-2">{{ whySentence(selected) }}</p>

                <div class="mt-4 space-y-1">
                  <div class="flex justify-between text-xs text-gray-400"><span>Engaged with this</span><span>{{ pct(selected.rate) }}</span></div>
                  <div class="h-2 bg-gray-900 rounded-full overflow-hidden"><div class="h-full bg-pink-500" :style="{ width: pct(selected.rate) }"></div></div>
                  <div class="flex justify-between text-xs text-gray-400 pt-1"><span>Your average</span><span>{{ pct(analysis.baseRate) }}</span></div>
                  <div class="h-2 bg-gray-900 rounded-full overflow-hidden"><div class="h-full bg-gray-500" :style="{ width: pct(analysis.baseRate) }"></div></div>
                </div>

                <p class="text-xs text-gray-400 mt-4">{{ evidence(selected) }}</p>

                <div v-if="related.length" class="mt-4">
                  <p class="text-xs uppercase tracking-wider text-gray-400 mb-1">Often enjoyed with</p>
                  <div class="flex flex-wrap gap-1">
                    <button v-for="tag in related" :key="tag.tag" class="text-xs px-2 py-1 rounded-full bg-gray-700 hover:bg-gray-600" @click="selectedTag = tag.tag">{{ label(tag) }}</button>
                  </div>
                </div>
              </template>
              <p v-else class="text-sm text-gray-500">Pick a tag on the map.</p>
            </div>
          </section>

          <!-- Interests by kind -->
          <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div v-for="category in categories" :key="category" class="bg-gray-800 rounded-lg p-4">
              <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">{{ categoryTitles[category] }}</h2>
              <p v-if="!analysis.topByCategory[category].length" class="text-sm text-gray-500">Nothing stands out yet.</p>
              <button
                v-for="entry in analysis.topByCategory[category]"
                :key="entry.tag"
                class="w-full text-left mb-2 group"
                :title="evidence(entry)"
                @click="selectedTag = entry.tag"
              >
                <div class="flex justify-between gap-2 text-sm">
                  <span class="truncate group-hover:text-pink-300" :class="{ 'text-pink-300': selectedTag === entry.tag }">{{ label(entry) }}</span>
                  <span class="text-xs text-gray-400 shrink-0">{{ entry.positives }} of {{ entry.impressions }}</span>
                </div>
                <div class="h-1.5 bg-gray-900 rounded-full overflow-hidden mt-1">
                  <div class="h-full rounded-full" :style="{ width: barWidth(entry, category), background: categoryColor(category) }"></div>
                </div>
              </button>
            </div>
          </section>

          <!-- How you engage -->
          <section class="bg-gray-800 rounded-lg p-4">
            <h2 class="text-lg font-bold mb-3">How you engage</h2>
            <div class="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <div v-for="tile in tiles" :key="tile.label" class="bg-gray-900/60 rounded-lg p-3">
                <p class="text-xs text-gray-400">{{ tile.label }}</p>
                <p class="font-mono text-xl mt-1">{{ tile.value }}</p>
                <p v-if="tile.note" class="text-xs text-gray-500 mt-1">{{ tile.note }}</p>
              </div>
            </div>

            <div class="grid gap-6 md:grid-cols-2 mt-5">
              <div>
                <p class="text-xs uppercase tracking-wider text-gray-400 mb-2">What you do besides scrolling</p>
                <div v-for="action in actionBars" :key="action.type" class="flex items-center gap-2 text-sm mb-1">
                  <span class="w-28 shrink-0 text-gray-300">{{ action.label }}</span>
                  <div class="flex-1 h-2 bg-gray-900 rounded-full overflow-hidden"><div class="h-full bg-pink-500/80" :style="{ width: action.width }"></div></div>
                  <span class="w-10 text-right font-mono text-xs text-gray-400">{{ action.count }}</span>
                </div>
                <p v-if="!actionBars.length" class="text-sm text-gray-500">Only scrolling so far.</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wider text-gray-400 mb-2">When you browse</p>
                <div class="flex items-end gap-px h-24" role="img" :aria-label="`Posts viewed per hour of day, busiest around ${peakHourLabel}`">
                  <div v-for="(count, hour) in analysis.engagement.hours" :key="hour" class="flex-1 bg-pink-500/70 rounded-t-sm" :style="{ height: hourHeight(count) }" :title="`${hourLabel(hour)}: ${count} posts`"></div>
                </div>
                <div class="flex justify-between text-[10px] text-gray-500 mt-1"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div>
              </div>
            </div>
          </section>

          <!-- Changing -->
          <section v-if="changeGroups.length" class="bg-gray-800 rounded-lg p-4">
            <h2 class="text-lg font-bold mb-3">What's changing</h2>
            <div class="grid gap-4 md:grid-cols-3">
              <div v-for="group in changeGroups" :key="group.title">
                <p class="text-xs uppercase tracking-wider text-gray-400 mb-2">{{ group.title }}</p>
                <div class="flex flex-wrap gap-1">
                  <button v-for="entry in group.entries" :key="entry.tag" class="text-xs px-2 py-1 rounded-full" :class="group.chip" :title="evidence(entry)" @click="selectedTag = entry.tag">{{ label(entry) }}</button>
                </div>
              </div>
            </div>
          </section>
        </template>

        <!-- Feed Quality: how the recommendations are landing (last 30 days) -->
        <section v-if="feedMetrics && feedMetrics.impressions" class="bg-gray-800 rounded-lg p-4">
          <h2 class="text-lg font-bold mb-1">How the feed is doing</h2>
          <p class="text-xs text-gray-400 mb-3">Last 30 days. Ranking accuracy is the chance a post you engaged with had been ranked above one you skipped.</p>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><p class="text-gray-400 text-xs">Posts shown</p><p class="font-mono text-lg">{{ feedMetrics.impressions }}</p></div>
            <div><p class="text-gray-400 text-xs">Engaged</p><p class="font-mono text-lg">{{ pct(feedMetrics.positiveRate) }}</p></div>
            <div><p class="text-gray-400 text-xs">Ranking accuracy</p><p class="font-mono text-lg">{{ num(feedMetrics.auc, 2) }}</p></div>
            <div><p class="text-gray-400 text-xs">Likes per 100 posts</p><p class="font-mono text-lg">{{ num(feedMetrics.likesPer100) }}</p></div>
          </div>
          <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <p class="text-gray-400 text-xs mb-1">Discovery picks vs your usual</p>
              <p class="font-mono">discovery {{ pct(feedMetrics.exploration.explore.positiveRate) }} ({{ feedMetrics.exploration.explore.impressions }})
                · usual {{ pct(feedMetrics.exploration.exploit.positiveRate) }} ({{ feedMetrics.exploration.exploit.impressions }})</p>
            </div>
            <div>
              <p class="text-gray-400 text-xs mb-1">Engaged by how the post was found</p>
              <p v-for="(group, name) in feedMetrics.byStrategy" :key="name" class="flex justify-between gap-2">
                <span class="text-gray-300">{{ strategyNames[name] || name }}</span>
                <span class="font-mono text-gray-400">{{ pct(group.positiveRate) }} of {{ group.impressions }}</span>
              </p>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<script>
import StorageService from '../services/StorageService';
import { COMMON_TAGS } from '../services/RecommendationSystem';
import { computeFeedMetrics } from '../services/FeedMetrics.js';
import { analyzeTaste, CATEGORIES } from '../services/TasteAnalysis.js';
import { describeTaste, tagLabel, tagEvidence } from '../services/TasteNarrative.js';
import TagMap from '../components/TagMap.vue';

const ACTION_LABELS = {
  like: 'Liked', favorite: 'Favourited', download: 'Saved', share: 'Shared', revisit: 'Looked again',
  deepDive: 'Deep Dived', tagTap: 'Tapped a tag', comments: 'Read comments', details: 'Opened details',
  unmute: 'Unmuted', dislike: 'Disliked', report: 'Reported',
};

export default {
  name: 'ProfileAnalyticsView',
  components: { TagMap },
  data() {
    return {
      loading: true,
      analysis: null,
      story: { ready: false, sections: [] },
      feedMetrics: null,
      selectedTag: null,
      categories: CATEGORIES,
      categoryNames: { artist: 'Artist', copyright: 'Series', character: 'Character', general: 'Theme' },
      categoryTitles: { artist: 'Artists', copyright: 'Series', character: 'Characters', general: 'Themes' },
      strategyNames: {
        anchor: 'Your top interests', pivot: 'Top interests, older or newer', reach: 'Secondary and old favourites',
        adjacent: 'Next to your interests', trending: 'Trending near your taste', wildcard: 'Popular overall',
        fallback: 'Broad fallback', deepDive: 'Deep Dive', unknown: 'Search and other pages',
      },
    };
  },
  computed: {
    selected() { return this.selectedTag ? this.analysis?.tags.get(this.selectedTag) || null : null; },
    related() {
      const graph = this.analysis?.graph;
      if (!graph || !this.selectedTag) return [];
      const index = graph.nodes.findIndex(node => node.tag === this.selectedTag);
      if (index === -1) return [];
      return graph.edges
        .filter(edge => edge.source === index || edge.target === index)
        .sort((a, b) => b.weight - a.weight)
        .map(edge => graph.nodes[edge.source === index ? edge.target : edge.source]);
    },
    tiles() {
      const e = this.analysis.engagement;
      return [
        { label: 'Posts seen', value: e.impressions, note: `${Math.round(e.activeMinutes)} active minutes` },
        { label: 'Held your attention', value: this.pct(e.positiveRate) },
        { label: 'Skipped quickly', value: this.pct(e.skipRate) },
        { label: 'Enjoyed without a like', value: this.pct(e.silentShare), note: 'learned from watch time' },
        e.videos.completionRate !== null
          ? { label: 'Clips watched to the end', value: this.pct(e.videos.completionRate), note: e.videos.rewatchRate ? `${this.pct(e.videos.rewatchRate)} rewatched` : '' }
          : { label: 'Typical look at an image', value: e.images.medianSeconds !== null ? `${e.images.medianSeconds.toFixed(1)}s` : '–' },
      ];
    },
    actionBars() {
      const actions = this.analysis.engagement.actions;
      const max = Math.max(1, ...Object.values(actions));
      return Object.entries(actions)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ type, count, label: ACTION_LABELS[type] || type, width: `${(count / max) * 100}%` }));
    },
    peakHourLabel() {
      const hours = this.analysis.engagement.hours;
      return this.hourLabel(hours.indexOf(Math.max(...hours)));
    },
    changeGroups() {
      const a = this.analysis;
      return [
        { title: 'New this week', entries: a.newInterests, chip: 'bg-green-900/60 text-green-200 hover:bg-green-800' },
        { title: 'Warming up to', entries: a.rising, chip: 'bg-pink-900/60 text-pink-200 hover:bg-pink-800' },
        { title: 'Gone quiet', entries: a.fading, chip: 'bg-gray-700 text-gray-300 hover:bg-gray-600' },
      ].filter(group => group.entries.length);
    },
  },
  async mounted() {
    await this.calculateAnalytics();
  },
  methods: {
    async calculateAnalytics() {
      this.loading = true;
      try {
        const [interactions, preferences] = await Promise.all([StorageService.getInteractions(), StorageService.getPreferences()]);
        const avoided = Array.isArray(preferences?.avoidedTags) ? preferences.avoidedTags : COMMON_TAGS;
        this.analysis = analyzeTaste(interactions, { avoided });
        this.story = describeTaste(this.analysis);
        this.feedMetrics = computeFeedMetrics(interactions, { since: Date.now() - 30 * 24 * 60 * 60 * 1000 });
        this.selectedTag = this.analysis.liked[0]?.tag || null;
      } finally {
        this.loading = false;
      }
    },
    label(entry) { return tagLabel(entry); },
    evidence(entry) { return tagEvidence(entry); },
    whySentence(entry) {
      const lift = entry.lift;
      const strength = lift >= 2 ? 'far more often than' : lift >= 1.3 ? 'more often than' : lift >= 0.9 ? 'about as often as' : 'less often than';
      return `You engaged with ${this.pct(entry.rate)} of the ${entry.impressions} ${this.label(entry)} posts you saw, ${strength} your average of ${this.pct(this.analysis.baseRate)}.`;
    },
    barWidth(entry, category) {
      const top = this.analysis.topByCategory[category][0]?.score || 1;
      return `${Math.max(6, (entry.score / top) * 100)}%`;
    },
    categoryColor(category) {
      return { artist: 'rgb(var(--c-accent-400))', copyright: '#c797ff', character: '#35c64a', general: '#4ea8de' }[category];
    },
    hourHeight(count) {
      const max = Math.max(1, ...this.analysis.engagement.hours);
      return `${Math.max(count ? 4 : 1, (count / max) * 100)}%`;
    },
    hourLabel(hour) { return `${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}`; },
    pct(value) { return value === null || value === undefined ? '–' : `${Math.round(value * 100)}%`; },
    num(value, digits = 1) { return value === null || value === undefined ? '–' : Number(value).toFixed(digits); },
  },
};
</script>
