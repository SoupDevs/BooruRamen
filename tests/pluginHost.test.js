import { describe, expect, it, vi } from 'vitest';
import { PluginHost, MAX_PLUGIN_ERRORS, HOOK_TIMEOUT_MS, coerceSetting } from '../src/plugins/PluginHost.js';
import { definePlugin, PLUGIN_API_VERSION } from '../src/plugins/definePlugin.js';
import { CONTENT_POLICY, stripRatingMetatags } from '../src/plugins/contentPolicy.js';

let counter = 0;
const uniqueId = () => `test-plugin-${++counter}`;

async function startedHost() {
  const host = new PluginHost();
  host.defineHook('test:value', { kind: 'waterfall', sanitize: result => { if (typeof result !== 'number') throw new Error('not a number'); return result; } });
  host.defineHook('test:event', { kind: 'event' });
  await host.start();
  return host;
}

describe('definePlugin', () => {
  it('fills in defaults', () => {
    const def = definePlugin({ id: 'my-plugin', name: ' Mine ', setup() {} });
    expect(def).toMatchObject({ name: 'Mine', version: '0.0.0', apiVersion: PLUGIN_API_VERSION, enabledByDefault: false, settings: [] });
    expect(Object.isFrozen(def)).toBe(true);
  });

  it('rejects bad ids, missing setup and newer API versions', () => {
    expect(() => definePlugin({ id: 'Bad Id', name: 'x', setup() {} })).toThrow(/Invalid plugin id/);
    expect(() => definePlugin({ id: 'ok', name: 'x' })).toThrow(/setup/);
    expect(() => definePlugin({ id: 'ok', name: 'x', apiVersion: PLUGIN_API_VERSION + 1, setup() {} })).toThrow(/plugin API/);
  });

  it('checks settings', () => {
    expect(() => definePlugin({ id: 'ok', name: 'x', setup() {}, settings: [{ key: 'a', type: 'colour' }] })).toThrow(/unknown type/);
    expect(() => definePlugin({ id: 'ok', name: 'x', setup() {}, settings: [{ key: 'a', type: 'select' }] })).toThrow(/options/);
    const def = definePlugin({ id: 'ok', name: 'x', setup() {}, settings: [{ key: 'mode', type: 'select', options: ['a', { value: 'b', label: 'Bee' }] }] });
    expect(def.settings[0].default).toBe('a');
    expect(def.settings[0].options[1]).toEqual({ value: 'b', label: 'Bee' });
  });
});

describe('PluginHost lifecycle', () => {
  it('runs setup when turned on and removes its hooks when turned off', async () => {
    const host = await startedHost();
    const id = uniqueId();
    const cleanup = vi.fn();
    await host.register({ id, name: 'Doubler', enabledByDefault: true, setup(api) { api.on('test:value', value => value * 2); return cleanup; } });
    expect(await host.run('test:value', 3)).toBe(6);
    expect(host.state.plugins.find(plugin => plugin.id === id).uses).toEqual(['test:value']);

    await host.setEnabled(id, false);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(host.hasHandlers('test:value')).toBe(false);
    expect(await host.run('test:value', 3)).toBe(3);
  });

  it('remembers turning a plugin off across hosts', async () => {
    const id = uniqueId();
    const definition = { id, name: 'Remembered', enabledByDefault: true, setup() {} };
    const first = await startedHost();
    await first.register(definition);
    await first.setEnabled(id, false);
    const second = await startedHost();
    const record = await second.register(definition);
    expect(record.enabled).toBe(false);
    expect(record.active).toBe(false);
  });

  it('leaves bundled plugins off unless they say otherwise; installed ones start on', async () => {
    const host = await startedHost();
    expect((await host.register({ id: uniqueId(), name: 'Off', setup() {} })).active).toBe(false);
    expect((await host.register({ id: uniqueId(), name: 'Installed', setup() {} }, { origin: 'installed' })).active).toBe(true);
  });

  it('records a setup failure without breaking the host', async () => {
    const host = await startedHost();
    const record = await host.register({ id: uniqueId(), name: 'Broken', enabledByDefault: true, setup(api) { api.on('test:value', () => 1); throw new Error('boom'); } });
    expect(record.active).toBe(false);
    expect(record.error).toMatch(/boom/);
    expect(host.hasHandlers('test:value')).toBe(false);
  });

  it('refuses a duplicate id', async () => {
    const host = await startedHost();
    const id = uniqueId();
    await host.register({ id, name: 'One', setup() {} });
    await expect(host.register({ id, name: 'Two', setup() {} })).rejects.toThrow(/already loaded/);
  });

  it('rejects unknown hooks', async () => {
    const host = await startedHost();
    const record = await host.register({ id: uniqueId(), name: 'Typo', enabledByDefault: true, setup(api) { api.on('test:valeu', () => 1); } });
    expect(record.error).toMatch(/Unknown hook/);
  });
});

describe('PluginHost hooks', () => {
  it('runs higher priority first and passes each result on', async () => {
    const host = await startedHost();
    await host.register({ id: uniqueId(), name: 'Add', enabledByDefault: true, setup(api) { api.on('test:value', value => value + 1); } });
    await host.register({ id: uniqueId(), name: 'Times', enabledByDefault: true, setup(api) { api.on('test:value', value => value * 10, { priority: 5 }); } });
    expect(await host.run('test:value', 1)).toBe(11);
  });

  it('keeps the previous value when a result fails sanitizing or a handler throws', async () => {
    const host = await startedHost();
    const bad = await host.register({ id: uniqueId(), name: 'Bad', enabledByDefault: true, setup(api) { api.on('test:value', () => 'nope'); } });
    await host.register({ id: uniqueId(), name: 'Thrower', enabledByDefault: true, setup(api) { api.on('test:value', () => { throw new Error('oops'); }); } });
    expect(await host.run('test:value', 4)).toBe(4);
    expect(bad.errorCount).toBe(1);
    expect(bad.error).toMatch(/not a number/);
  });

  it('skips a handler that takes too long', async () => {
    vi.useFakeTimers();
    try {
      const host = await startedHost();
      await host.register({ id: uniqueId(), name: 'Slow', enabledByDefault: true, setup(api) { api.on('test:value', () => new Promise(() => {})); } });
      const result = host.run('test:value', 7);
      await vi.advanceTimersByTimeAsync(HOOK_TIMEOUT_MS + 1);
      expect(await result).toBe(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns a plugin off after repeated errors', async () => {
    const host = await startedHost();
    const record = await host.register({ id: uniqueId(), name: 'Flaky', enabledByDefault: true, setup(api) { api.on('test:value', () => { throw new Error('flaky'); }); } });
    for (let i = 0; i < MAX_PLUGIN_ERRORS; i++) await host.run('test:value', 1);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(record.enabled).toBe(false);
    expect(record.active).toBe(false);
    expect(record.error).toMatch(/Turned off/);
  });

  it('delivers events without letting a handler error escape', async () => {
    const host = await startedHost();
    const seen = [];
    await host.register({ id: uniqueId(), name: 'Listener', enabledByDefault: true, setup(api) { api.on('test:event', payload => seen.push(payload)); } });
    await host.register({ id: uniqueId(), name: 'Crasher', enabledByDefault: true, setup(api) { api.on('test:event', () => { throw new Error('x'); }); } });
    host.emit('test:event', { a: 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(seen).toEqual([{ a: 1 }]);
  });
});

describe('PluginHost settings, storage and extensions', () => {
  it('coerces settings to their declared type', async () => {
    const host = await startedHost();
    const id = uniqueId();
    const changes = [];
    await host.register({
      id, name: 'Settings', enabledByDefault: true,
      settings: [
        { key: 'boost', type: 'number', default: 1, min: 0, max: 3 },
        { key: 'tags', type: 'tags' },
        { key: 'on', type: 'boolean', default: true },
      ],
      setup(api) { api.settings.onChange((key, value) => changes.push([key, value])); },
    });
    expect(host.getSettings(id)).toEqual({ boost: 1, tags: [], on: true });
    expect(host.setSetting(id, 'boost', '9')).toBe(3);
    expect(host.setSetting(id, 'tags', 'Cat, dog dog')).toEqual(['cat', 'dog']);
    expect(host.setSetting(id, 'on', 'yes')).toBe(true);
    expect(changes).toContainEqual(['boost', 3]);
    expect(() => host.setSetting(id, 'missing', 1)).toThrow(/no setting/);
    expect(coerceSetting({ type: 'number', default: 2 }, 'abc')).toBe(2);
  });

  it('keeps each plugin\'s storage apart', async () => {
    const host = await startedHost();
    let a, b;
    await host.register({ id: uniqueId(), name: 'A', enabledByDefault: true, setup(api) { a = api; } });
    await host.register({ id: uniqueId(), name: 'B', enabledByDefault: true, setup(api) { b = api; } });
    a.storage.set('count', 2);
    expect(a.storage.get('count')).toBe(2);
    expect(b.storage.get('count', 0)).toBe(0);
    expect(a.storage.keys()).toEqual(['count']);
  });

  it('cleans up what an api extension tracked', async () => {
    const host = new PluginHost();
    const removed = vi.fn();
    host.extendApi('things', ({ track }) => ({ add: () => track(removed) }));
    await host.start();
    const id = uniqueId();
    await host.register({ id, name: 'Things', enabledByDefault: true, setup(api) { api.things.add(); } });
    await host.setEnabled(id, false);
    expect(removed).toHaveBeenCalledOnce();
  });

  it('exposes the content policy read-only', async () => {
    const host = await startedHost();
    let api;
    await host.register({ id: uniqueId(), name: 'Reader', enabledByDefault: true, setup(received) { api = received; } });
    expect(api.policy).toBe(CONTENT_POLICY);
    expect(() => { 'use strict'; api.policy.ratings.push('explicit'); }).toThrow();
    expect(CONTENT_POLICY.ratings).toEqual(['general']);
  });
});

describe('stripRatingMetatags', () => {
  it('removes rating selectors and keeps everything else', () => {
    expect(stripRatingMetatags('cat rating:e -rating:g ~rating:q is:nsfw is:parent order:rank')).toBe('cat is:parent order:rank');
    expect(stripRatingMetatags('Rating:Explicit dog')).toBe('dog');
    expect(stripRatingMetatags('')).toBe('');
  });
});
