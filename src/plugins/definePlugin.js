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
 * definePlugin.js
 * Checks a plugin definition and fills in its defaults. See docs/PLUGINS.md.
 */

/** Major version of the plugin API. A plugin built for a newer one is refused. */
export const PLUGIN_API_VERSION = 1;

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const SETTING_TYPES = new Set(['boolean', 'number', 'string', 'select', 'tags']);

function checkSetting(setting, pluginId) {
  const where = `Plugin "${pluginId}" setting "${setting?.key}"`;
  if (!setting || typeof setting.key !== 'string' || !setting.key) throw new Error(`Plugin "${pluginId}" has a setting without a key`);
  if (!SETTING_TYPES.has(setting.type)) throw new Error(`${where}: unknown type "${setting.type}"`);
  if (setting.type === 'select' && !(Array.isArray(setting.options) && setting.options.length)) {
    throw new Error(`${where}: a select needs options`);
  }
  const options = setting.type === 'select'
    ? setting.options.map(option => (typeof option === 'object' ? { value: option.value, label: option.label ?? String(option.value) } : { value: option, label: String(option) }))
    : undefined;
  const fallback = { boolean: false, number: setting.min ?? 0, string: '', select: options?.[0].value, tags: [] }[setting.type];
  return Object.freeze({
    ...setting,
    label: setting.label || setting.key,
    description: setting.description || '',
    default: setting.default ?? fallback,
    ...(options ? { options: Object.freeze(options) } : {}),
  });
}

/**
 * Validate a plugin definition.
 * @param {Object} definition
 * @param {string} definition.id lowercase, 2-64 of a-z 0-9 . _ -
 * @param {string} definition.name
 * @param {string} [definition.version]
 * @param {string} [definition.description]
 * @param {string} [definition.author]
 * @param {number} [definition.apiVersion] the plugin API it was written for
 * @param {Array} [definition.settings] settings shown on the Plugins page
 * @param {(api: Object) => (void|Function|Promise)} definition.setup
 * @returns {Readonly<Object>} the checked definition
 */
export function definePlugin(definition) {
  if (!definition || typeof definition !== 'object') throw new Error('A plugin must be an object');
  const { id, name, setup } = definition;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error(`Invalid plugin id "${id}": use 2-64 lowercase letters, digits, ".", "_" or "-"`);
  if (typeof name !== 'string' || !name.trim()) throw new Error(`Plugin "${id}" needs a name`);
  if (typeof setup !== 'function') throw new Error(`Plugin "${id}" needs a setup(api) function`);
  const apiVersion = definition.apiVersion ?? PLUGIN_API_VERSION;
  if (!Number.isInteger(apiVersion) || apiVersion < 1 || apiVersion > PLUGIN_API_VERSION) {
    throw new Error(`Plugin "${id}" needs plugin API v${apiVersion}; this app provides v${PLUGIN_API_VERSION}`);
  }
  const settings = (definition.settings || []).map(setting => checkSetting(setting, id));
  const keys = new Set();
  for (const setting of settings) {
    if (keys.has(setting.key)) throw new Error(`Plugin "${id}" declares setting "${setting.key}" twice`);
    keys.add(setting.key);
  }
  return Object.freeze({
    ...definition,
    name: name.trim(),
    version: definition.version || '0.0.0',
    description: definition.description || '',
    author: definition.author || '',
    apiVersion,
    settings: Object.freeze(settings),
  });
}
