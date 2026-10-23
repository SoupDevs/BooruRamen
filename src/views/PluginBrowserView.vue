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
      <h1 class="text-xl font-bold">Browse plugins</h1>
      <button
        type="button"
        class="absolute right-0 text-gray-400 hover:text-white disabled:opacity-50"
        :disabled="loading"
        aria-label="Refresh"
        data-plugin-browser-refresh
        @click="load(true)"
      >
        <RefreshCw class="w-5 h-5" :class="{ 'animate-spin': loading }" />
      </button>
    </div>

    <div class="max-w-2xl mx-auto space-y-3 pb-24">
      <p class="text-sm text-gray-400 px-1">
        Plugins shared on GitHub in repositories tagged <span class="font-mono text-gray-300">{{ topic }}</span>, from their <span class="font-mono text-gray-300">{{ folder }}/</span> folder.
      </p>
      <p class="text-xs text-yellow-300 px-1">
        These plugins come from other people and aren't reviewed. A plugin runs with the same access as BooruRamen itself, so read its source and only install plugins you trust.
      </p>

      <div v-if="error" class="p-4 bg-gray-800 rounded-lg text-sm text-red-400 break-words" data-plugin-browser-error>{{ error }}</div>
      <div v-else-if="loading && !plugins.length" class="p-4 bg-gray-800 rounded-lg text-sm text-gray-400">Looking on GitHub…</div>
      <div v-else-if="!plugins.length" class="p-4 bg-gray-800 rounded-lg text-sm text-gray-400" data-plugin-browser-empty>
        No plugins were found.
      </div>

      <div
        v-for="plugin in plugins"
        :key="plugin.key"
        class="bg-gray-800 rounded-lg overflow-hidden"
        :data-catalog-plugin="plugin.key"
      >
        <div class="flex items-start justify-between gap-3 p-4">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium break-all">{{ plugin.info.name || plugin.file }}</span>
              <span v-if="plugin.info.version" class="text-xs text-gray-500">v{{ plugin.info.version }}</span>
            </div>
            <div v-if="plugin.info.author" class="text-xs text-gray-500">by {{ plugin.info.author }}</div>
            <div v-if="plugin.info.description" class="text-sm text-gray-400 mt-1">{{ plugin.info.description }}</div>
            <div class="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs">
              <button type="button" class="flex items-center gap-1 text-pink-400 hover:text-pink-300" data-catalog-file-link @click="open(plugin.url)">
                <FileCode class="w-3.5 h-3.5" /> {{ plugin.path }}
              </button>
              <button type="button" class="flex items-center gap-1 text-pink-400 hover:text-pink-300" data-catalog-repo-link @click="open(plugin.repo.url)">
                <ExternalLink class="w-3.5 h-3.5" /> {{ plugin.repo.fullName }}
              </button>
              <span v-if="plugin.repo.stars" class="flex items-center gap-1 text-gray-500"><Star class="w-3.5 h-3.5" /> {{ plugin.repo.stars }}</span>
            </div>
            <div v-if="plugin.error" class="text-xs text-red-400 break-words mt-1" data-catalog-error>{{ plugin.error }}</div>
            <div v-else-if="plugin.notice" class="text-xs text-green-400 mt-1" data-catalog-notice>
              {{ plugin.notice }} <router-link to="/profile/plugins" class="underline">Open Plugins</router-link>
            </div>
          </div>
          <button
            type="button"
            class="text-sm px-3 py-1.5 rounded-lg shrink-0 transition-colors disabled:cursor-default"
            :class="installClass(plugin)"
            :disabled="!canInstall(plugin)"
            data-catalog-install
            @click="install(plugin)"
          >{{ installLabel(plugin) }}</button>
        </div>

        <button
          v-if="plugin.source"
          type="button"
          class="w-full flex items-center justify-between px-4 py-2 border-t border-gray-700 text-sm text-gray-300 hover:text-white hover:bg-gray-700/40"
          :aria-expanded="!!shown[plugin.key]"
          data-catalog-source-toggle
          @click="shown[plugin.key] = !shown[plugin.key]"
        >
          <span class="flex items-center gap-2"><Code class="w-4 h-4" /> Source</span>
          <ChevronDown class="w-4 h-4 transition-transform" :class="{ 'rotate-180': shown[plugin.key] }" />
        </button>
        <pre
          v-if="shown[plugin.key]"
          class="mx-4 mb-4 p-3 max-h-96 overflow-auto rounded-lg bg-gray-900 text-xs text-gray-300 font-mono whitespace-pre"
          data-catalog-source
        >{{ plugin.source }}</pre>
      </div>
    </div>
  </div>
</template>

<script>
import { ChevronDown, Code, ExternalLink, FileCode, RefreshCw, Star } from 'lucide-vue-next';
import { pluginHost, installPlugin } from '../plugins';
import { getInstalledSource } from '../plugins/installer.js';
import {
  CATALOG_FOLDER, CATALOG_TOPIC, fetchPluginSource, listRepoPlugins, readPluginInfo, searchPluginRepos,
} from '../plugins/catalog.js';
import { openExternalUrl } from '../services/ShareService.js';

// Kept while the app is open so returning to the page doesn't spend more of
// GitHub's rate limit; Refresh fetches again.
let cached = null;

export default {
  name: 'PluginBrowserView',
  components: { ChevronDown, Code, ExternalLink, FileCode, RefreshCw, Star },
  data() {
    return {
      topic: CATALOG_TOPIC,
      folder: CATALOG_FOLDER,
      plugins: cached || [],
      loading: false,
      error: '',
      // Keys of the plugins whose source is shown.
      shown: {},
      // Keys being installed right now.
      installing: {},
      records: pluginHost.state.plugins,
    };
  },
  created() {
    if (!cached) this.load(false);
  },
  methods: {
    async load(force) {
      if (this.loading || (cached && !force)) return;
      this.loading = true;
      this.error = '';
      try {
        const repos = await searchPluginRepos();
        const found = [];
        for (const repo of repos) {
          let files = [];
          try {
            files = await listRepoPlugins(repo);
          } catch (error) {
            // A rate limit stops the whole search; one bad repository doesn't.
            if (/rate limit/.test(error.message)) throw error;
            continue;
          }
          for (const file of files) {
            found.push({ ...file, key: `${repo.fullName}/${file.path}`, repo, source: '', info: readPluginInfo(''), error: '', notice: '' });
          }
        }
        this.plugins = found;
        cached = this.plugins;
        // Raw file downloads don't count against the API's rate limit.
        await Promise.all(this.plugins.map(async plugin => {
          try {
            plugin.source = await fetchPluginSource(plugin);
            plugin.info = readPluginInfo(plugin.source);
          } catch (error) {
            plugin.error = `Couldn't read the file: ${error.message}`;
          }
        }));
      } catch (error) {
        this.error = `Couldn't search GitHub: ${error.message}`;
      } finally {
        this.loading = false;
      }
    },
    record(plugin) {
      return plugin.info.id ? this.records.find(record => record.id === plugin.info.id) : null;
    },
    status(plugin) {
      if (this.installing[plugin.key]) return 'installing';
      if (!plugin.source) return 'unavailable';
      const record = this.record(plugin);
      if (!record) return 'new';
      if (record.origin !== 'installed') return 'builtin';
      return getInstalledSource(record.id) === plugin.source ? 'installed' : 'update';
    },
    canInstall(plugin) {
      return ['new', 'update'].includes(this.status(plugin));
    },
    installLabel(plugin) {
      return {
        installing: 'Installing…', unavailable: 'Install', new: 'Install', update: 'Update', installed: 'Installed', builtin: 'Built in',
      }[this.status(plugin)];
    },
    installClass(plugin) {
      return this.canInstall(plugin) ? 'bg-pink-600 hover:bg-pink-700 text-white' : 'bg-gray-700 text-gray-400';
    },
    async install(plugin) {
      if (!this.canInstall(plugin)) return;
      this.installing = { ...this.installing, [plugin.key]: true };
      plugin.error = '';
      try {
        await installPlugin(plugin.source);
        plugin.notice = 'Installed. It starts off; turn it on in Plugins.';
      } catch (error) {
        plugin.error = `Not installed: ${error.message}`;
      } finally {
        const rest = { ...this.installing };
        delete rest[plugin.key];
        this.installing = rest;
      }
    },
    open(url) {
      openExternalUrl(url);
    },
  },
};
</script>
