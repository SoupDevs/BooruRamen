<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div ref="root" class="tag-map">
    <div class="flex flex-wrap items-center gap-3 mb-2 text-xs text-gray-400">
      <span v-for="(color, category) in palette" :key="category" class="flex items-center gap-1">
        <span class="inline-block w-2.5 h-2.5 rounded-full" :style="{ background: color }"></span>{{ categoryNames[category] }}
      </span>
      <span class="ml-auto">Size: how strongly you respond · Lines: liked together</span>
    </div>
    <svg
      :viewBox="`0 0 ${width} ${height}`"
      class="w-full h-auto select-none"
      role="img"
      :aria-label="`Map of ${nodes.length} tags you engage with and how they connect`"
      @mouseleave="hovered = null"
    >
      <g>
        <line
          v-for="(edge, i) in edges"
          :key="`e${i}`"
          :x1="nodes[edge.source].x * width" :y1="nodes[edge.source].y * height"
          :x2="nodes[edge.target].x * width" :y2="nodes[edge.target].y * height"
          :stroke-width="1 + edge.weight * 4"
          class="edge"
          :class="{ dim: focus !== null && !isEdgeLit(edge), lit: focus !== null && isEdgeLit(edge) }"
        />
      </g>
      <g
        v-for="(node, i) in nodes"
        :key="node.tag"
        class="node"
        :class="{ dim: focus !== null && !isNodeLit(i), selected: selectedTag === node.tag }"
        tabindex="0"
        role="button"
        :aria-label="label(node)"
        @mouseenter="hovered = i"
        @focus="hovered = i"
        @blur="hovered = null"
        @click="$emit('select', node.tag)"
        @keydown.enter.prevent="$emit('select', node.tag)"
      >
        <circle :cx="node.x * width" :cy="node.y * height" :r="radius(node)" :fill="palette[node.category] || palette.general" />
        <text
          :x="node.x * width"
          :y="node.y * height + radius(node) + 11"
          text-anchor="middle"
          class="label"
          :class="{ strong: i < 12 || focus === i || isNodeLit(i) && focus !== null }"
        >{{ short(label(node)) }}</text>
      </g>
    </svg>
  </div>
</template>

<script>
import { layoutGraph } from '../services/TasteAnalysis.js';
import { tagLabel } from '../services/TasteNarrative.js';

export default {
  name: 'TagMap',
  props: {
    graph: { type: Object, required: true },
    selectedTag: { type: String, default: null },
  },
  emits: ['select'],
  data() {
    return {
      width: 640,
      height: 420,
      hovered: null,
      // Danbooru's category colours; artist follows the theme accent.
      palette: {
        artist: 'rgb(var(--c-accent-400, 244 114 182))',
        copyright: '#c797ff',
        character: '#35c64a',
        general: '#4ea8de',
      },
      categoryNames: { artist: 'Artist', copyright: 'Series', character: 'Character', general: 'Theme' },
    };
  },
  computed: {
    nodes() { return layoutGraph(this.graph); },
    edges() { return this.graph.edges; },
    maxScore() { return Math.max(...this.graph.nodes.map(node => node.score), 1e-6); },
    focus() {
      if (this.hovered !== null) return this.hovered;
      const index = this.nodes.findIndex(node => node.tag === this.selectedTag);
      return index === -1 ? null : index;
    },
    neighbours() {
      const set = new Set();
      if (this.focus === null) return set;
      for (const edge of this.edges) {
        if (edge.source === this.focus) set.add(edge.target);
        if (edge.target === this.focus) set.add(edge.source);
      }
      return set;
    },
  },
  mounted() {
    // Draw at the real pixel size so labels stay readable on a phone; narrow
    // screens get a taller canvas instead of a shrunken wide one.
    this.resizeObserver = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (!width) return;
      this.width = width;
      this.height = Math.round(width < 520 ? width * 1.25 : width * 0.62);
    });
    this.resizeObserver.observe(this.$refs.root);
  },
  beforeUnmount() {
    this.resizeObserver?.disconnect();
  },
  methods: {
    radius(node) { return 5 + 13 * Math.sqrt(Math.max(0, node.score) / this.maxScore); },
    label(node) { return tagLabel(node); },
    short(text) { return text.length > 22 ? `${text.slice(0, 20)}…` : text; },
    isNodeLit(i) { return i === this.focus || this.neighbours.has(i); },
    isEdgeLit(edge) { return edge.source === this.focus || edge.target === this.focus; },
  },
};
</script>

<style scoped>
.edge { stroke: rgb(var(--c-gray-500, 107 114 128)); stroke-opacity: 0.35; transition: stroke-opacity 0.15s; }
.edge.lit { stroke-opacity: 0.9; }
.edge.dim { stroke-opacity: 0.08; }
.node { cursor: pointer; outline: none; transition: opacity 0.15s; }
.node.dim { opacity: 0.25; }
.node circle { stroke: rgb(var(--c-gray-900, 17 24 39)); stroke-width: 1.5; }
.node.selected circle, .node:focus-visible circle { stroke: rgb(var(--c-white, 255 255 255)); stroke-width: 2.5; }
.label { font-size: 10px; fill: rgb(var(--c-gray-400, 156 163 175)); pointer-events: none; }
.label.strong { fill: rgb(var(--c-gray-100, 243 244 246)); font-weight: 600; }
</style>
