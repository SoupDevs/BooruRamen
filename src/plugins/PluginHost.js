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
 * PluginHost.js
 * Loads plugins, turns them on and off, and runs their hooks.
 *
 * The app owns every extension point. A module that wants plugins to take
 * part in something declares a hook (defineHook) and runs it (run / emit);
 * a plugin subscribes with api.on(). Hooks that return a value are run in
 * turn, each one receiving the previous one's result, and every result is
 * checked by the hook's sanitize function before it is used. A plugin that
 * throws, times out or returns something the hook can't use is skipped for
 * that call; after repeated errors it is turned off.
 *
 * Everything a plugin registers is tracked, so turning it off removes all of
 * it without a reload.
 *
 * Plugins are available on the whole device, but each user profile turns
 * them on for itself and keeps its own plugin settings and storage. Every
 * plugin starts turned off.
 */
import { reactive, markRaw } from 'vue';
import { definePlugin, PLUGIN_API_VERSION } from './definePlugin.js';
import { CONTENT_POLICY } from './contentPolicy.js';

const STATE_KEY = 'booruRamen_plugins';
const SETTINGS_PREFIX = 'booruRamen_plugin_settings:';
const STORAGE_PREFIX = 'booruRamen_plugin_data:';

/** A hook taking longer than this is skipped so it can't stall the feed. */
export const HOOK_TIMEOUT_MS = 1500;
/** A plugin's setup() taking longer than this is treated as failed. */
export const SETUP_TIMEOUT_MS = 5000;
/** Errors in one session after which a plugin is turned off. */
export const MAX_PLUGIN_ERRORS = 5;

// localStorage, or an in-memory stand-in where there is none (tests, a
// browser with storage blocked).
const memoryStorage = new Map();
const storage = {
  get(key) {
    try { if (typeof localStorage !== 'undefined') return localStorage.getItem(key); } catch { /* blocked */ }
    return memoryStorage.has(key) ? memoryStorage.get(key) : null;
  },
  set(key, value) {
    try { if (typeof localStorage !== 'undefined') { localStorage.setItem(key, value); return; } } catch { /* blocked */ }
    memoryStorage.set(key, value);
  },
  remove(key) {
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key); } catch { /* blocked */ }
    memoryStorage.delete(key);
  },
  keys() {
    try {
      if (typeof localStorage !== 'undefined') return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    } catch { /* blocked */ }
    return [...memoryStorage.keys()];
  },
};

const readJson = (key, fallback) => {
  try {
    const raw = storage.get(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
};

function withTimeout(value, ms) {
  if (!value || typeof value.then !== 'function') return Promise.resolve(value);
  let timer;
  return Promise.race([
    value,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** Coerce a setting value to its declared type, or return the default. */
export function coerceSetting(setting, value) {
  switch (setting.type) {
    case 'boolean': return typeof value === 'boolean' ? value : setting.default;
    case 'number': {
      const number = Number(value);
      if (value === '' || value == null || !Number.isFinite(number)) return setting.default;
      const min = setting.min ?? -Infinity, max = setting.max ?? Infinity;
      return Math.min(max, Math.max(min, number));
    }
    case 'string': return typeof value === 'string' ? value : setting.default;
    case 'select': return setting.options.some(option => option.value === value) ? value : setting.default;
    case 'tags': {
      const list = Array.isArray(value) ? value : String(value ?? '').split(/[\s,]+/);
      return [...new Set(list.map(tag => String(tag).trim().toLowerCase()).filter(Boolean))];
    }
    default: return setting.default;
  }
}

export class PluginHost {
  constructor() {
    // The user profile whose on/off choices, settings and storage are used.
    this.scope = 'default';
    /** Reactive list the Plugins page renders. */
    this.state = reactive({ plugins: [] });
    this.records = new Map();
    this.hookSpecs = new Map();
    this.handlers = new Map();
    this.apiExtensions = new Map();
    this.started = false;
  }

  /** Use this profile's plugin choices. Call before start(). */
  setScope(profileId) {
    this.scope = String(profileId || 'default');
  }

  stateKey() { return `${STATE_KEY}:${this.scope}`; }
  settingsKey(id) { return `${SETTINGS_PREFIX}${this.scope}:${id}`; }
  dataPrefix(id) { return `${STORAGE_PREFIX}${this.scope}:${id}:`; }

  // ---- extension points (used by the app, not by plugins) ----

  /**
   * Declare a hook plugins may subscribe to.
   * @param {string} name e.g. 'feed:queries'
   * @param {Object} spec
   * @param {'waterfall'|'event'} spec.kind waterfall: each handler may return a
   *   replacement value; event: handlers are told, their result is ignored
   * @param {string} [spec.description]
   * @param {(result: any, previous: any, context: any) => any} [spec.sanitize]
   *   checks a handler's result and returns what the app will use. Throw to
   *   reject it (the previous value is kept and the plugin is charged an error).
   */
  defineHook(name, spec) {
    if (!['waterfall', 'event'].includes(spec?.kind)) throw new Error(`Hook "${name}" needs kind "waterfall" or "event"`);
    this.hookSpecs.set(name, Object.freeze({ name, description: '', ...spec }));
  }

  /**
   * Add a namespace to the api object every plugin receives.
   * @param {string} name e.g. 'ui' gives plugins api.ui
   * @param {(context: { api: Object, record: Object, track: (dispose: Function) => Function, use: (feature: string) => void, host: PluginHost }) => Object} factory
   *   api is the plugin's api so far; track() registers cleanup that runs
   *   when the plugin is turned off; use() lists a feature on the Plugins page.
   */
  extendApi(name, factory) {
    this.apiExtensions.set(name, factory);
  }

  /** True when an active plugin listens to the hook (lets callers skip work). */
  hasHandlers(name) {
    return (this.handlers.get(name) || []).length > 0;
  }

  /**
   * Run a waterfall hook.
   * @returns {Promise<any>} the value after every plugin had its turn
   */
  async run(name, value, context = {}) {
    const spec = this.hookSpecs.get(name);
    if (!spec || spec.kind !== 'waterfall') throw new Error(`"${name}" is not a waterfall hook`);
    for (const handler of [...(this.handlers.get(name) || [])]) {
      try {
        const result = await withTimeout(handler.fn(value, context), HOOK_TIMEOUT_MS);
        if (result === undefined) continue;
        value = spec.sanitize ? spec.sanitize(result, value, context) : result;
      } catch (error) {
        this.reportError(handler.pluginId, `${name}: ${error?.message || error}`);
      }
    }
    return value;
  }

  /** Tell every plugin listening to an event hook. Never throws or waits. */
  emit(name, payload) {
    const spec = this.hookSpecs.get(name);
    if (!spec || spec.kind !== 'event') throw new Error(`"${name}" is not an event hook`);
    for (const handler of [...(this.handlers.get(name) || [])]) {
      Promise.resolve()
        .then(() => withTimeout(handler.fn(payload), HOOK_TIMEOUT_MS))
        .catch(error => this.reportError(handler.pluginId, `${name}: ${error?.message || error}`));
    }
  }

  // ---- registration and lifecycle ----

  /**
   * Add a plugin. It is turned on now if this profile turned it on before
   * and the host has started; otherwise it stays off.
   * @param {Object} definition see definePlugin
   * @param {{ origin?: 'bundled'|'installed' }} [options]
   */
  async register(definition, { origin = 'bundled' } = {}) {
    const def = definePlugin(definition);
    if (this.records.has(def.id)) throw new Error(`A plugin with id "${def.id}" is already loaded`);
    const saved = readJson(this.stateKey(), {}).enabled || {};
    const record = reactive({
      id: def.id,
      name: def.name,
      version: def.version,
      description: def.description,
      author: def.author,
      origin,
      settings: def.settings,
      enabled: !!saved[def.id],
      active: false,
      error: '',
      errorCount: 0,
      // Hook names and features it registered while on, for the Plugins page.
      uses: [],
    });
    // The definition and cleanup lists stay out of Vue's reactivity.
    this.records.set(def.id, { record, def: markRaw(def), disposers: [] });
    this.state.plugins.push(record);
    if (this.started && record.enabled) await this.activate(def.id);
    return record;
  }

  /** Turn a plugin off and forget it. */
  async unregister(id) {
    if (!this.records.has(id)) return;
    await this.deactivate(id);
    this.records.delete(id);
    this.state.plugins.splice(this.state.plugins.findIndex(record => record.id === id), 1);
  }

  /** Turn on every plugin that should be on. Call once at app start. */
  async start() {
    this.started = true;
    for (const { record } of this.records.values()) {
      if (record.enabled) await this.activate(record.id);
    }
  }

  async setEnabled(id, enabled) {
    const entry = this.records.get(id);
    if (!entry) throw new Error(`No plugin "${id}"`);
    entry.record.enabled = !!enabled;
    const state = readJson(this.stateKey(), {});
    storage.set(this.stateKey(), JSON.stringify({ ...state, enabled: { ...(state.enabled || {}), [id]: !!enabled } }));
    if (enabled) {
      entry.record.errorCount = 0;
      await this.activate(id);
    } else await this.deactivate(id);
  }

  async activate(id) {
    const entry = this.records.get(id);
    if (!entry || entry.record.active) return;
    const { record, def } = entry;
    record.error = '';
    record.active = true;
    try {
      const dispose = await withTimeout(def.setup(this.createApi(entry)), SETUP_TIMEOUT_MS);
      if (typeof dispose === 'function') entry.disposers.push(dispose);
    } catch (error) {
      console.error(`[Plugins] ${id} failed to start:`, error);
      await this.deactivate(id);
      record.error = `Failed to start: ${error?.message || error}`;
    }
  }

  async deactivate(id) {
    const entry = this.records.get(id);
    if (!entry) return;
    const { record, disposers } = entry;
    for (const [name, list] of this.handlers) {
      this.handlers.set(name, list.filter(handler => handler.pluginId !== id));
    }
    // Last registered, first removed.
    while (disposers.length) {
      const dispose = disposers.pop();
      try { await dispose(); } catch (error) { console.error(`[Plugins] ${id} cleanup failed:`, error); }
    }
    record.active = false;
    record.uses = [];
  }

  reportError(id, message) {
    const entry = this.records.get(id);
    if (!entry) return;
    const { record } = entry;
    console.warn(`[Plugins] ${id}: ${message}`);
    record.errorCount++;
    record.error = message;
    if (record.active && record.errorCount >= MAX_PLUGIN_ERRORS) {
      this.setEnabled(id, false).then(() => {
        record.error = `Turned off after ${MAX_PLUGIN_ERRORS} errors. Last: ${message}`;
      });
    }
  }

  // ---- settings ----

  getSettings(id) {
    const entry = this.records.get(id);
    if (!entry) return {};
    const saved = readJson(this.settingsKey(id), {});
    return Object.fromEntries(entry.def.settings.map(setting => [setting.key, setting.key in saved ? coerceSetting(setting, saved[setting.key]) : setting.default]));
  }

  setSetting(id, key, value) {
    const entry = this.records.get(id);
    const setting = entry?.def.settings.find(item => item.key === key);
    if (!setting) throw new Error(`Plugin "${id}" has no setting "${key}"`);
    const coerced = coerceSetting(setting, value);
    storage.set(this.settingsKey(id), JSON.stringify({ ...readJson(this.settingsKey(id), {}), [key]: coerced }));
    for (const listener of [...(entry.settingListeners || [])]) {
      try { listener(key, coerced); } catch (error) { this.reportError(id, `settings.onChange: ${error?.message || error}`); }
    }
    return coerced;
  }

  // ---- the api object a plugin's setup() receives ----

  createApi(entry) {
    const { record, def, disposers } = entry;
    const id = def.id;
    const track = dispose => {
      disposers.push(dispose);
      return () => {
        const index = disposers.indexOf(dispose);
        if (index !== -1) disposers.splice(index, 1);
        return dispose();
      };
    };
    const use = feature => { if (!record.uses.includes(feature)) record.uses.push(feature); };
    const dataKey = key => `${this.dataPrefix(id)}${key}`;
    const api = {
      id,
      apiVersion: PLUGIN_API_VERSION,
      /** The feed's default content filters, read-only. */
      policy: CONTENT_POLICY,
      log: {
        info: (...args) => console.log(`[Plugin ${id}]`, ...args),
        warn: (...args) => console.warn(`[Plugin ${id}]`, ...args),
        error: (...args) => console.error(`[Plugin ${id}]`, ...args),
      },
      /**
       * Subscribe to a hook. Higher priority runs first.
       * @returns {Function} unsubscribe
       */
      on: (name, fn, { priority = 0 } = {}) => {
        if (!this.hookSpecs.has(name)) throw new Error(`Unknown hook "${name}"`);
        if (typeof fn !== 'function') throw new Error(`api.on("${name}") needs a function`);
        if (!record.active) throw new Error('The plugin is turned off');
        const handler = { pluginId: id, fn, priority };
        const list = [...(this.handlers.get(name) || []), handler]
          .sort((a, b) => b.priority - a.priority);
        this.handlers.set(name, list);
        use(name);
        return track(() => {
          this.handlers.set(name, (this.handlers.get(name) || []).filter(item => item !== handler));
        });
      },
      /** Run fn when the plugin is turned off. */
      onDispose: fn => track(fn),
      settings: {
        get: key => this.getSettings(id)[key],
        all: () => this.getSettings(id),
        set: (key, value) => this.setSetting(id, key, value),
        /** fn(key, value) after a setting changes. */
        onChange: fn => {
          entry.settingListeners = [...(entry.settingListeners || []), fn];
          return track(() => { entry.settingListeners = entry.settingListeners.filter(item => item !== fn); });
        },
      },
      /** Small JSON key-value store kept per plugin across launches. */
      storage: {
        get: (key, fallback = null) => readJson(dataKey(key), fallback),
        set: (key, value) => storage.set(dataKey(key), JSON.stringify(value)),
        remove: key => storage.remove(dataKey(key)),
        keys: () => storage.keys().filter(key => key?.startsWith(this.dataPrefix(id))).map(key => key.slice(this.dataPrefix(id).length)),
      },
    };
    for (const [name, factory] of this.apiExtensions) {
      api[name] = factory({ api, record, track, use, host: this });
    }
    return Object.freeze(api);
  }

  /** Remove everything a plugin stored, in every profile (on/off, settings, storage). */
  clearPluginData(id) {
    for (const key of storage.keys()) {
      if (!key) continue;
      if (key.startsWith(SETTINGS_PREFIX) && key.endsWith(`:${id}`)) storage.remove(key);
      else if (key.startsWith(STORAGE_PREFIX) && key.slice(STORAGE_PREFIX.length).split(':')[1] === id) storage.remove(key);
      else if (key.startsWith(`${STATE_KEY}:`)) {
        const state = readJson(key, {});
        if (state.enabled && id in state.enabled) {
          delete state.enabled[id];
          storage.set(key, JSON.stringify(state));
        }
      }
    }
  }
}

const pluginHost = new PluginHost();
export default pluginHost;
