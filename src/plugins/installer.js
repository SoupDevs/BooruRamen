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
 * installer.js
 * Plugins installed from a single .js file instead of being bundled.
 *
 * The file is a module with one `export default` of a plugin definition and
 * no imports; definePlugin is in scope. Its code is kept in localStorage and
 * evaluated at every start. An installed plugin runs with the same access as
 * the app itself, which is why the Plugins page asks before running a file
 * at all: evaluating it runs its top-level code.
 */
import pluginHost from './PluginHost.js';
import { definePlugin } from './definePlugin.js';

const INSTALLED_KEY = 'booruRamen_installed_plugins';
/** Largest plugin file accepted, in characters. */
export const MAX_PLUGIN_SOURCE = 512 * 1024;

function readInstalled() {
  try {
    const list = JSON.parse(localStorage.getItem(INSTALLED_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function writeInstalled(list) {
  localStorage.setItem(INSTALLED_KEY, JSON.stringify(list));
}

/**
 * Turn a plugin file's source into its definition (not yet registered).
 * @param {string} source
 * @returns {Readonly<Object>} the checked definition
 */
export function evaluatePluginSource(source) {
  const code = String(source || '');
  if (!code.trim()) throw new Error('The file is empty');
  if (code.length > MAX_PLUGIN_SOURCE) throw new Error(`The file is larger than ${MAX_PLUGIN_SOURCE / 1024} KB`);
  if (/^\s*import[\s{*'"]/m.test(code)) throw new Error('Installed plugins can\'t use import statements; definePlugin is already in scope');
  if (/^\s*export\s+(?!default\b)/m.test(code)) throw new Error('Only `export default` is supported');
  const defaults = code.match(/^\s*export\s+default\b/gm) || [];
  if (defaults.length !== 1) throw new Error('The file needs exactly one `export default` of a plugin definition');
  const body = code.replace(/^(\s*)export\s+default\b/m, '$1__plugin.default =');
  const exported = {};
  // eslint-disable-next-line no-new-func -- installed plugins are evaluated on purpose
  new Function('__plugin', 'definePlugin', `"use strict";\n${body}\n`)(exported, definePlugin);
  if (!exported.default) throw new Error('`export default` did not produce a plugin definition');
  return definePlugin(exported.default);
}

/** Installed plugins' ids, names and install times. */
export function listInstalled() {
  return readInstalled().map(({ id, name, installedAt }) => ({ id, name, installedAt }));
}

/**
 * Install a plugin from its source, or update it if one with its id is
 * installed. It is turned on.
 * @returns {Promise<Object>} the plugin's record
 */
export async function installPlugin(source) {
  const def = evaluatePluginSource(source);
  const installed = readInstalled();
  const existing = pluginHost.state.plugins.find(record => record.id === def.id);
  if (existing && existing.origin !== 'installed') throw new Error(`"${def.id}" is a built-in plugin`);
  if (existing) await pluginHost.unregister(def.id);
  writeInstalled([...installed.filter(entry => entry.id !== def.id), { id: def.id, name: def.name, code: String(source), installedAt: Date.now() }]);
  const record = await pluginHost.register(def, { origin: 'installed' });
  if (!record.enabled) await pluginHost.setEnabled(def.id, true);
  return record;
}

/** Turn an installed plugin off, remove it and everything it stored. */
export async function uninstallPlugin(id) {
  await pluginHost.unregister(id);
  writeInstalled(readInstalled().filter(entry => entry.id !== id));
  pluginHost.clearPluginData(id);
}

/**
 * Register every installed plugin. One that no longer loads is listed with
 * its error so it can be removed from the Plugins page.
 */
export async function loadInstalledPlugins() {
  for (const entry of readInstalled()) {
    try {
      await pluginHost.register(evaluatePluginSource(entry.code), { origin: 'installed' });
    } catch (error) {
      console.error(`[Plugins] Installed plugin ${entry.id} failed to load:`, error);
      const message = error?.message || String(error);
      try {
        await pluginHost.register({ id: entry.id, name: entry.name || entry.id, setup() { throw new Error(message); } }, { origin: 'installed' });
      } catch { /* a bundled plugin took the id */ }
    }
  }
}
