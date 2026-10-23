<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div class="p-4 text-white h-full overflow-y-auto">
    <div class="relative flex items-center justify-center mb-6">
      <router-link to="/profile/plugins" class="absolute left-0 text-pink-500 hover:text-pink-400 flex items-center gap-1">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        <span class="text-sm">Plugins</span>
      </router-link>
      <h1 class="text-xl font-bold truncate px-20">{{ page ? page.title : 'Plugin page' }}</h1>
    </div>
    <div class="max-w-2xl mx-auto pb-24">
      <PluginBoundary v-if="page && entry && !entry.failed" :entry="entry">
        <component :is="page.component" />
      </PluginBoundary>
      <p v-else-if="!page" class="text-sm text-gray-400 text-center">This plugin page is no longer available.</p>
      <p v-else class="text-sm text-red-400 text-center">This page failed to load. The error is shown on the Plugins page.</p>
    </div>
  </div>
</template>

<script>
import { reactive } from 'vue';
import { uiState } from '../plugins/ui.js';
import PluginBoundary from '../components/plugins/PluginBoundary.vue';

/** Frame for a page a plugin added with api.ui.addPage(). */
export default {
  name: 'PluginPageView',
  components: { PluginBoundary },
  data() {
    return { entry: null };
  },
  computed: {
    page() {
      const target = this.$route.meta.pluginPage;
      return target ? uiState.pages.find(page => page.pluginId === target.pluginId && page.id === target.id) : null;
    },
  },
  watch: {
    page: {
      immediate: true,
      handler(page) {
        this.entry = page ? reactive({ pluginId: page.pluginId, slot: `page ${page.id}`, failed: false }) : null;
      },
    },
  },
};
</script>
