import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// The installer keeps plugin code in localStorage.
const store = new Map();
globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
  key: index => [...store.keys()][index] ?? null,
  get length() { return store.size; },
};

const { pluginHost } = await import('../src/plugins/index.js');
const { evaluatePluginSource, installPlugin, uninstallPlugin, loadInstalledPlugins, listInstalled } = await import('../src/plugins/installer.js');
const { default: tagSpotlight } = await import('../src/plugins/bundled/tag-spotlight/index.js');

const source = (id, body = '') => `export default definePlugin({ id: '${id}', name: 'Plugin ${id}', setup(api) { ${body} } });`;

beforeAll(() => pluginHost.start());
beforeEach(async () => {
  for (const { id } of listInstalled()) await uninstallPlugin(id);
});

describe('evaluatePluginSource', () => {
  it('reads a plugin file', () => {
    const def = evaluatePluginSource(source('from-file'));
    expect(def).toMatchObject({ id: 'from-file', name: 'Plugin from-file' });
  });

  it('accepts a plain object export', () => {
    expect(evaluatePluginSource("export default { id: 'plain', name: 'Plain', setup() {} };").id).toBe('plain');
  });

  it('rejects imports, named exports and files without exactly one default export', () => {
    expect(() => evaluatePluginSource(`import x from 'y';\n${source('a')}`)).toThrow(/import/);
    expect(() => evaluatePluginSource(`export const a = 1;\n${source('a')}`)).toThrow(/Only `export default`/);
    expect(() => evaluatePluginSource('const a = 1;')).toThrow(/exactly one/);
    expect(() => evaluatePluginSource('')).toThrow(/empty/);
  });

  it('reports errors in the file and in the definition', () => {
    expect(() => evaluatePluginSource('export default definePlugin({ id: "x" ')).toThrow();
    expect(() => evaluatePluginSource("export default { id: 'Bad Id', name: 'x', setup() {} };")).toThrow(/Invalid plugin id/);
  });

  it('loads the documented example', () => {
    const def = evaluatePluginSource(readFileSync(new URL('../docs/examples/tag-count.plugin.js', import.meta.url), 'utf8'));
    expect(def.id).toBe('tag-count');
  });
});

describe('installing', () => {
  it('installs turned off, remembers being turned on across a restart, and uninstalls', async () => {
    const record = await installPlugin(source('kept', "api.on('feed:posts', posts => posts);"));
    expect(record).toMatchObject({ origin: 'installed', enabled: false, active: false });
    expect(listInstalled().map(entry => entry.id)).toEqual(['kept']);
    await pluginHost.setEnabled('kept', true);

    // A new start loads it from storage.
    await pluginHost.unregister('kept');
    await loadInstalledPlugins();
    expect(pluginHost.state.plugins.find(plugin => plugin.id === 'kept')?.active).toBe(true);

    await uninstallPlugin('kept');
    expect(listInstalled()).toEqual([]);
    expect(pluginHost.state.plugins.some(plugin => plugin.id === 'kept')).toBe(false);
  });

  it('updates a plugin installed with the same id', async () => {
    await installPlugin(source('updated'));
    await installPlugin(source('updated').replace('Plugin updated', 'Renamed'));
    expect(pluginHost.state.plugins.filter(plugin => plugin.id === 'updated').map(plugin => plugin.name)).toEqual(['Renamed']);
    expect(listInstalled()).toHaveLength(1);
  });

  it('won\'t replace a built-in plugin', async () => {
    await pluginHost.register(tagSpotlight);
    await expect(installPlugin(source('tag-spotlight'))).rejects.toThrow(/built-in/);
    await pluginHost.unregister('tag-spotlight');
  });

  it('lists an installed plugin that no longer loads, so it can be removed', async () => {
    store.set('booruRamen_installed_plugins', JSON.stringify([{ id: 'broken', name: 'Broken', code: 'export default nope(' }]));
    await loadInstalledPlugins();
    const record = pluginHost.state.plugins.find(plugin => plugin.id === 'broken');
    expect(record.active).toBe(false);
    expect(record.error).toMatch(/Failed to (load|start)/);
    await uninstallPlugin('broken');
  });

  it('removes what an uninstalled plugin stored', async () => {
    await installPlugin(source('storer', "api.storage.set('x', 1);"));
    await pluginHost.setEnabled('storer', true);
    expect([...store.keys()].some(key => key.includes('storer:x'))).toBe(true);
    await uninstallPlugin('storer');
    expect([...store.keys()].some(key => key.includes('storer'))).toBe(false);
  });
});

describe('Tag Spotlight example', () => {
  it('is bundled, off by default, and uses the feed and UI APIs', async () => {
    expect(pluginHost.state.plugins.find(plugin => plugin.id === 'tag-spotlight')).toBeUndefined();
    await pluginHost.register(tagSpotlight);
    const record = pluginHost.state.plugins.find(plugin => plugin.id === 'tag-spotlight');
    expect(record.enabled).toBe(false);

    await pluginHost.setEnabled('tag-spotlight', true);
    pluginHost.setSetting('tag-spotlight', 'tags', 'cat');
    const queries = await pluginHost.run('feed:queries', [], { deepDive: false });
    expect(queries).toEqual([expect.objectContaining({ tags: 'cat', type: 'spotlight' })]);
    expect(await pluginHost.run('feed:queries', [], { deepDive: true })).toEqual([]);

    const posts = [{ id: 1, tag_string: 'cat' }, { id: 2, tag_string: 'dog' }];
    expect(await pluginHost.run('feed:score', [1, 1], { deepDive: false, posts })).toEqual([2, 1]);
    expect([...record.uses]).toEqual(expect.arrayContaining(['feed:queries', 'feed:score', 'feed:postShown', 'post:interaction', 'ui:feed.post', 'ui:post.details', 'ui:page']));

    pluginHost.emit('feed:postShown', { post: posts[0] });
    await vi.waitFor(() => expect(JSON.parse(store.get(`booruRamen_plugin_data:${pluginHost.scope}:tag-spotlight:tally`))).toEqual({ cat: { shown: 1, liked: 0 } }));
    await pluginHost.unregister('tag-spotlight');
  });
});
