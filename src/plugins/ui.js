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
 * ui.js
 * What plugins can add to the app's screens: components in named slots,
 * pages of their own, stylesheets and short notices. Gives plugins api.ui
 * and api.vue.
 *
 * Slots are rendered by <PluginSlot name="...">, which the app places where
 * plugins may draw. Each plugin component is wrapped so that one that fails
 * to render disappears and is charged an error instead of breaking the view.
 */
import * as Vue from 'vue';
import pluginHost from './PluginHost.js';

const { reactive, markRaw } = Vue;

/** Where plugin components can be placed, and the props each receives. */
export const UI_SLOTS = Object.freeze({
  'feed.post': 'Over each post in the feed. Props: post, current',
  'feed.actions': 'The feed\'s action button column, below the built-in buttons. Props: post',
  'feed.sidebar': 'The feed\'s settings sidebar, below Deep Dive. Props: post',
  'post.details': 'The end of the post details sidebar. Props: post',
  'profile.menu': 'The Profile page menu, below Plugins. No props',
  'app.overlay': 'Above every screen, for floating UI. Props: post (the current feed post or null)',
});

export const uiState = reactive({
  /** slot name -> [{ key, pluginId, component, order, failed }] */
  slots: Object.fromEntries(Object.keys(UI_SLOTS).map(name => [name, []])),
  /** [{ pluginId, id, title, description, path, name, component }] */
  pages: [],
  /** [{ key, pluginId, message }] */
  notices: [],
});

let router = null;
let entryCount = 0;
export const PAGE_ROUTE_PREFIX = '/plugins';
const PAGE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function addRoute(page) {
  router.addRoute({
    path: page.path,
    name: page.name,
    component: () => import('../views/PluginPageView.vue'),
    meta: { pluginPage: { pluginId: page.pluginId, id: page.id } },
  });
}

/**
 * Give the UI the app's router so plugin pages get routes. Pages added
 * before this are routed now.
 */
export function setUiRouter(appRouter) {
  router = appRouter;
  uiState.pages.forEach(addRoute);
}

/** Report a plugin component that failed and hide it. */
export function reportComponentError(entry, error) {
  entry.failed = true;
  pluginHost.reportError(entry.pluginId, `component in ${entry.slot}: ${error?.message || error}`);
}

pluginHost.extendApi('vue', () => Object.freeze({
  h: Vue.h,
  ref: Vue.ref,
  reactive: Vue.reactive,
  computed: Vue.computed,
  watch: Vue.watch,
  watchEffect: Vue.watchEffect,
  onMounted: Vue.onMounted,
  onBeforeUnmount: Vue.onBeforeUnmount,
  onUnmounted: Vue.onUnmounted,
  nextTick: Vue.nextTick,
  toRef: Vue.toRef,
  defineComponent: Vue.defineComponent,
}));

pluginHost.extendApi('ui', ({ record, track, use }) => Object.freeze({
  slots: UI_SLOTS,

  /**
   * Render a component in a slot.
   * @param {string} slot one of UI_SLOTS
   * @param {Object} component a Vue component
   * @param {{ order?: number }} [options] lower order renders first
   * @returns {Function} remove it
   */
  addToSlot(slot, component, { order = 0 } = {}) {
    if (!(slot in UI_SLOTS)) throw new Error(`Unknown UI slot "${slot}"`);
    if (!component || !['object', 'function'].includes(typeof component)) throw new Error('addToSlot needs a Vue component');
    const entry = reactive({ key: `${record.id}:${++entryCount}`, pluginId: record.id, slot, component: markRaw(component), order, failed: false });
    const list = uiState.slots[slot];
    list.push(entry);
    list.sort((a, b) => a.order - b.order);
    use(`ui:${slot}`);
    return track(() => {
      const index = list.indexOf(entry);
      if (index !== -1) list.splice(index, 1);
    });
  },

  /**
   * Add a page at /plugins/<plugin id>/<id>, linked from the Plugins page.
   * @param {{ id: string, title: string, description?: string, component: Object }} page
   * @returns {Function} remove it
   */
  addPage({ id, title, description = '', component }) {
    if (typeof id !== 'string' || !PAGE_ID_PATTERN.test(id)) throw new Error(`Invalid page id "${id}": use lowercase letters, digits and "-"`);
    if (!title) throw new Error(`Page "${id}" needs a title`);
    if (!component) throw new Error(`Page "${id}" needs a component`);
    const page = {
      pluginId: record.id,
      id,
      title,
      description,
      path: `${PAGE_ROUTE_PREFIX}/${record.id}/${id}`,
      name: `plugin:${record.id}:${id}`,
      component: markRaw(component),
    };
    if (uiState.pages.some(existing => existing.name === page.name)) throw new Error(`Page "${id}" already exists`);
    uiState.pages.push(page);
    if (router) addRoute(page);
    use('ui:page');
    return track(() => {
      const index = uiState.pages.findIndex(existing => existing.name === page.name);
      if (index !== -1) uiState.pages.splice(index, 1);
      if (!router) return;
      if (router.currentRoute.value.name === page.name) router.replace('/profile/plugins');
      if (router.hasRoute(page.name)) router.removeRoute(page.name);
    });
  },

  /**
   * Add a stylesheet to the document.
   * @param {string} css
   * @returns {Function} remove it
   */
  addStyle(css) {
    if (typeof document === 'undefined') return track(() => {});
    const style = document.createElement('style');
    style.dataset.plugin = record.id;
    style.textContent = String(css);
    document.head.appendChild(style);
    use('ui:style');
    return track(() => style.remove());
  },

  /**
   * Show a short notice at the bottom of the screen.
   * @param {string} message
   * @param {{ duration?: number }} [options] milliseconds, 1000-10000
   */
  notify(message, { duration = 3000 } = {}) {
    const notice = { key: `${record.id}:${++entryCount}`, pluginId: record.id, message: String(message) };
    uiState.notices.push(notice);
    const remove = () => {
      const index = uiState.notices.indexOf(notice);
      if (index !== -1) uiState.notices.splice(index, 1);
    };
    let timer = null;
    const dismiss = track(() => { clearTimeout(timer); remove(); });
    timer = setTimeout(dismiss, Math.min(10000, Math.max(1000, duration)));
  },

  /** Navigate to one of this plugin's pages. */
  openPage(id) {
    if (router) return router.push(`${PAGE_ROUTE_PREFIX}/${record.id}/${id}`);
  },
}));
