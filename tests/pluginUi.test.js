import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { pluginHost } from '../src/plugins/index.js';
import { uiState, setUiRouter, UI_SLOTS } from '../src/plugins/ui.js';
import PluginSlot from '../src/components/plugins/PluginSlot.vue';

// The bits of vue-router the UI module uses.
const routes = new Map();
const router = {
  currentRoute: { value: { name: null } },
  addRoute: route => routes.set(route.name, route),
  hasRoute: name => routes.has(name),
  removeRoute: name => routes.delete(name),
  replace: vi.fn(),
  push: vi.fn(),
};

let ids = 0;
const installed = [];
async function install(setup) {
  const id = `ui-test-${++ids}`;
  await pluginHost.register({ id, name: id, setup }, { origin: 'installed' });
  await pluginHost.setEnabled(id, true);
  installed.push(id);
  return id;
}

const renderSlot = (name, slotProps) => renderToString(createSSRApp({ render: () => h(PluginSlot, { name, slotProps }) }));

beforeAll(async () => {
  setUiRouter(router);
  await pluginHost.start();
});
afterEach(async () => {
  while (installed.length) await pluginHost.unregister(installed.pop());
});

describe('slots', () => {
  it('renders plugin components in order with the slot props, and removes them when turned off', async () => {
    const id = await install(api => {
      api.ui.addToSlot('post.details', { props: ['post'], render() { return h('p', `second ${this.post.id}`); } }, { order: 2 });
      api.ui.addToSlot('post.details', { props: ['post'], render() { return h('p', `first ${this.post.id}`); } }, { order: 1 });
    });
    const html = await renderSlot('post.details', { post: { id: 7 } });
    expect(html.indexOf('first 7')).toBeLessThan(html.indexOf('second 7'));
    await pluginHost.setEnabled(id, false);
    expect(await renderSlot('post.details', { post: { id: 7 } })).not.toContain('first');
  });

  it('renders nothing for an empty slot', async () => {
    expect(await renderSlot('feed.actions', {})).not.toContain('data-plugin-slot');
  });

  it('hides a component that throws and charges its plugin', async () => {
    const id = await install(api => {
      api.ui.addToSlot('feed.sidebar', { render() { throw new Error('render failed'); } });
      api.ui.addToSlot('feed.sidebar', { render: () => h('span', 'still here') });
    });
    const html = await renderSlot('feed.sidebar', {});
    expect(html).toContain('still here');
    const record = pluginHost.state.plugins.find(plugin => plugin.id === id);
    expect(record.error).toMatch(/render failed/);
    expect(uiState.slots['feed.sidebar'].filter(entry => entry.failed)).toHaveLength(1);
  });

  it('refuses unknown slots', async () => {
    const id = await install(api => { api.ui.addToSlot('nowhere', { render: () => null }); });
    expect(pluginHost.state.plugins.find(plugin => plugin.id === id).error).toMatch(/Unknown UI slot/);
  });

  it('documents every slot', () => {
    expect(Object.keys(UI_SLOTS)).toEqual(['feed.post', 'feed.actions', 'feed.sidebar', 'post.details', 'profile.menu', 'app.overlay']);
  });
});

describe('pages', () => {
  it('routes a page under the plugin id and removes the route when turned off', async () => {
    const id = await install(api => { api.ui.addPage({ id: 'stats', title: 'Stats', component: { render: () => h('div') } }); });
    const name = `plugin:${id}:stats`;
    expect(routes.get(name).path).toBe(`/plugins/${id}/stats`);
    expect(uiState.pages.map(page => page.name)).toContain(name);

    router.currentRoute.value.name = name;
    await pluginHost.setEnabled(id, false);
    expect(routes.has(name)).toBe(false);
    expect(router.replace).toHaveBeenCalledWith('/profile/plugins');
    expect(uiState.pages.map(page => page.name)).not.toContain(name);
    router.currentRoute.value.name = null;
  });

  it('checks page ids', async () => {
    const id = await install(api => { api.ui.addPage({ id: '../x', title: 'Bad', component: {} }); });
    expect(pluginHost.state.plugins.find(plugin => plugin.id === id).error).toMatch(/Invalid page id/);
  });
});

describe('notices and vue helpers', () => {
  it('shows a notice and clears it when the plugin is turned off', async () => {
    let api;
    const id = await install(received => { api = received; });
    api.ui.notify('Hello');
    expect(uiState.notices.map(notice => notice.message)).toEqual(['Hello']);
    await pluginHost.setEnabled(id, false);
    expect(uiState.notices).toEqual([]);
  });

  it('expires a notice on its own', async () => {
    vi.useFakeTimers();
    try {
      let api;
      await install(received => { api = received; });
      api.ui.notify('Bye', { duration: 1000 });
      vi.advanceTimersByTime(1001);
      expect(uiState.notices).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives plugins Vue without bundling it', async () => {
    let api;
    await install(received => { api = received; });
    expect(api.vue.h).toBe(h);
    expect(typeof api.vue.ref).toBe('function');
  });
});
