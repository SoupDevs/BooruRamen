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
      <router-link to="/profile" class="absolute left-0 text-pink-500 hover:text-pink-400 flex items-center gap-1">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        <span class="text-sm">Profile</span>
      </router-link>
      <h1 class="text-xl font-bold">Plugins</h1>
    </div>

    <div class="max-w-2xl mx-auto space-y-3 pb-24">
      <p class="text-sm text-gray-400 px-1">
        Plugins can change the feed's searches and ranking and add to the app's screens.
        Whatever a plugin does, the feed only shows General-rated posts and never shows a post with a blacklisted tag.
      </p>

      <div v-if="!plugins.length" class="p-4 bg-gray-800 rounded-lg text-sm text-gray-400" data-plugins-empty>
        No plugins are installed.
      </div>

      <div
        v-for="plugin in plugins"
        :key="plugin.id"
        class="p-4 bg-gray-800 rounded-lg space-y-3"
        :data-plugin="plugin.id"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium">{{ plugin.name }}</span>
              <span class="text-xs text-gray-500">v{{ plugin.version }}</span>
              <span class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">{{ originLabel(plugin) }}</span>
            </div>
            <div v-if="plugin.author" class="text-xs text-gray-500">by {{ plugin.author }}</div>
            <div v-if="plugin.description" class="text-sm text-gray-400 mt-1">{{ plugin.description }}</div>
          </div>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 items-center rounded-full shrink-0"
            :class="plugin.enabled ? 'bg-pink-600' : 'bg-gray-600'"
            :aria-pressed="plugin.enabled"
            :aria-label="`${plugin.enabled ? 'Turn off' : 'Turn on'} ${plugin.name}`"
            data-plugin-toggle
            @click="toggle(plugin)"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition"
              :class="plugin.enabled ? 'translate-x-6' : 'translate-x-1'"
            ></span>
          </button>
        </div>

        <div v-if="plugin.error" class="text-xs text-red-400 break-words" data-plugin-error>{{ plugin.error }}</div>

        <div v-if="plugin.active && plugin.uses.length" class="flex flex-wrap gap-1">
          <span v-for="use in plugin.uses" :key="use" class="text-[11px] px-2 py-0.5 rounded-full bg-gray-900 text-gray-300" :title="use">{{ useLabel(use) }}</span>
        </div>

        <div v-if="plugin.enabled && plugin.settings.length" class="space-y-2 pt-1 border-t border-gray-700">
          <div
            v-for="setting in plugin.settings"
            :key="setting.key"
            class="flex items-center justify-between gap-3 p-3 rounded-lg bg-gray-900"
            :data-plugin-setting="setting.key"
          >
            <div class="flex flex-col min-w-0">
              <label class="text-sm font-medium" :for="inputId(plugin, setting)">{{ setting.label }}</label>
              <span v-if="setting.description" class="text-xs text-gray-400">{{ setting.description }}</span>
            </div>

            <button
              v-if="setting.type === 'boolean'"
              :id="inputId(plugin, setting)"
              type="button"
              class="relative inline-flex h-6 w-11 items-center rounded-full shrink-0"
              :class="value(plugin, setting) ? 'bg-pink-600' : 'bg-gray-600'"
              :aria-pressed="!!value(plugin, setting)"
              @click="update(plugin, setting, !value(plugin, setting))"
            >
              <span class="inline-block h-4 w-4 transform rounded-full bg-white transition" :class="value(plugin, setting) ? 'translate-x-6' : 'translate-x-1'"></span>
            </button>

            <input
              v-else-if="setting.type === 'number'"
              :id="inputId(plugin, setting)"
              type="number"
              class="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-right"
              :min="setting.min"
              :max="setting.max"
              :step="setting.step || 'any'"
              :value="value(plugin, setting)"
              @change="update(plugin, setting, $event.target.value)"
            />

            <select
              v-else-if="setting.type === 'select'"
              :id="inputId(plugin, setting)"
              class="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
              :value="optionIndex(plugin, setting)"
              @change="update(plugin, setting, setting.options[$event.target.value].value)"
            >
              <option v-for="(option, index) in setting.options" :key="index" :value="index">{{ option.label }}</option>
            </select>

            <input
              v-else
              :id="inputId(plugin, setting)"
              type="text"
              class="w-40 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
              :placeholder="setting.type === 'tags' ? 'tag_one, tag_two' : ''"
              :value="setting.type === 'tags' ? value(plugin, setting).join(', ') : value(plugin, setting)"
              @change="update(plugin, setting, $event.target.value)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { pluginHost } from '../plugins';

export default {
  name: 'PluginsView',
  data() {
    return {
      plugins: pluginHost.state.plugins,
      // Current setting values per plugin; storage isn't reactive.
      values: {},
    };
  },
  created() {
    for (const plugin of this.plugins) this.values[plugin.id] = pluginHost.getSettings(plugin.id);
  },
  methods: {
    originLabel(plugin) {
      return plugin.origin === 'installed' ? 'Installed' : 'Built in';
    },
    useLabel(name) {
      return pluginHost.hookSpecs.get(name)?.label || name;
    },
    inputId(plugin, setting) {
      return `plugin-${plugin.id}-${setting.key}`;
    },
    value(plugin, setting) {
      return this.values[plugin.id]?.[setting.key] ?? setting.default;
    },
    optionIndex(plugin, setting) {
      return Math.max(0, setting.options.findIndex(option => option.value === this.value(plugin, setting)));
    },
    async toggle(plugin) {
      await pluginHost.setEnabled(plugin.id, !plugin.enabled);
      this.values[plugin.id] = pluginHost.getSettings(plugin.id);
    },
    update(plugin, setting, raw) {
      const stored = pluginHost.setSetting(plugin.id, setting.key, raw);
      this.values[plugin.id] = { ...this.values[plugin.id], [setting.key]: stored };
    },
  },
};
</script>
