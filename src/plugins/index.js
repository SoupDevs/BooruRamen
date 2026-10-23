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
 * Plugin system entry point. See docs/PLUGINS.md.
 *
 * Bundled plugins are found automatically: any src/plugins/bundled/<name>/index.js
 * whose default export is a plugin definition is loaded at start. Plugins
 * the user installed from a file (installer.js) are loaded after them.
 */
import pluginHost from './PluginHost.js';
// Declares the feed's hooks before any plugin subscribes.
import './feedHooks.js';
// Gives plugins api.ui and api.vue.
import './ui.js';
import { loadInstalledPlugins } from './installer.js';
import { getActiveProfile } from '../services/ProfileService.js';

export { default as pluginHost } from './PluginHost.js';
export { definePlugin, PLUGIN_API_VERSION } from './definePlugin.js';
export { CONTENT_POLICY, FEED_RATINGS } from './contentPolicy.js';
export { setUiRouter, UI_SLOTS } from './ui.js';
export { installPlugin, uninstallPlugin, evaluatePluginSource } from './installer.js';

const bundled = import.meta.glob('./bundled/*/index.js', { eager: true });

/**
 * Register the bundled and installed plugins and turn on the ones the
 * active profile turned on.
 * A plugin that fails to load is logged and skipped; the app still starts.
 */
export async function startPlugins() {
  pluginHost.setScope(getActiveProfile().id);
  for (const [path, module] of Object.entries(bundled)) {
    try {
      await pluginHost.register(module.default, { origin: 'bundled' });
    } catch (error) {
      console.error(`[Plugins] Could not load ${path}:`, error);
    }
  }
  await loadInstalledPlugins();
  await pluginHost.start();
}
