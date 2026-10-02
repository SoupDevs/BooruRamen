import { describe, it, expect, vi, beforeEach } from 'vitest';
import service, { aiTaggerState as state, TAGGER_MODEL } from '../src/services/AiTaggerService.js';

let worker, store, storage;
beforeEach(() => {
  service.stop(); service.preparing = null;
  Object.assign(state, { dialog: false, ready: false, phase: 'prompt', progress: 0, loaded: 0, error: '', cached: false, downloaded: false, removing: false });
  vi.stubGlobal('caches', { has: vi.fn().mockResolvedValue(false), delete: vi.fn().mockResolvedValue(true), open: vi.fn().mockResolvedValue({ keys: async () => ['model.onnx', 'selected_tags.csv'].map(file => ({ url: TAGGER_MODEL.baseUrl + file })) }) });
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) });
  vi.stubGlobal('Worker', class {
    constructor() { worker = this; this.messages = []; }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    reply(data) { this.onmessage({ data }); }
  });
  store = { initialize: vi.fn().mockResolvedValue(), aiTaggingEnabled: false, updateSettings: vi.fn() };
});

describe('first-run model consent and download', () => {
  it('prompts on first launch and remembers decline across launches', async () => {
    await service.initialize(store); expect(state.dialog).toBe(true);
    service.decline(store); expect(state.phase).toBe('declined');
    state.dialog = false; await service.initialize(store); expect(state.dialog).toBe(false);
    expect(store.updateSettings).toHaveBeenCalledExactlyOnceWith({ aiTaggingEnabled: false }); expect(worker?.messages || []).toEqual([]);
  });
  it('turns tagging off when declining and keeps it off on the next launch', async () => {
    store.aiTaggingEnabled = true;
    store.updateSettings.mockImplementation(update => Object.assign(store, update));
    service.showPrompt(); service.decline(store);
    expect(store.aiTaggingEnabled).toBe(false); expect(state.ready).toBe(false);
    state.dialog = false;
    await service.initialize(store);
    expect(state.dialog).toBe(false); expect(worker?.messages || []).toEqual([]);
  });
  it('tracks progress, allows browsing, and enables the feature only when the model is ready', async () => {
    const download = service.prepare(store); const id = worker.messages[0].id;
    expect(store.updateSettings).not.toHaveBeenCalled();
    worker.reply({ id, phase: 'downloading', progress: 0.5, loaded: 200000000 });
    expect(state.progress).toBe(0.5); state.dialog = false;
    service.showPrompt(); expect(state.phase).toBe('downloading');
    worker.reply({ id, result: true }); expect(await download).toBe(true);
    expect(store.updateSettings).toHaveBeenCalledWith({ aiTaggingEnabled: true }); expect(state.ready).toBe(true);
  });
  it('cancel and failure leave the feature disabled and allow retry', async () => {
    const cancelled = service.prepare(store); service.stop();
    expect(await cancelled).toBe(false); expect(state.phase).toBe('failed');
    expect(store.updateSettings).toHaveBeenLastCalledWith({ aiTaggingEnabled: false });
    const retry = service.prepare(store), id = worker.messages[0].id;
    worker.reply({ id, error: 'Storage is full' }); expect(await retry).toBe(false);
    expect(state.error).toBe('Storage is full'); expect(state.ready).toBe(false);
  });
  it('keeps the downloaded model available after stopping tagging', async () => {
    const preparing = service.prepare(store), id = worker.messages[0].id;
    worker.reply({ id, result: true }); await preparing;
    service.stop();
    expect(state.ready).toBe(false); expect(state.downloaded).toBe(true);
  });
  it('does not treat a partial cache as a downloaded model', async () => {
    storage.set('booruRamenAiTaggerDecision', 'declined');
    caches.has.mockResolvedValue(true);
    caches.open.mockResolvedValue({ keys: async () => [{ url: TAGGER_MODEL.baseUrl + 'selected_tags.csv' }] });
    await service.initialize(store);
    expect(state.cached).toBe(true); expect(state.downloaded).toBe(false);
  });
  it('uninstalls a cached model even when tagging is disabled, without prompting again on launch', async () => {
    storage.set('booruRamenAiTaggerDecision', 'ready');
    caches.has.mockResolvedValue(true);
    await service.initialize(store);
    expect(state.cached).toBe(true);
    expect(state.downloaded).toBe(true); expect(state.ready).toBe(false);
    expect(await service.uninstall(store)).toBe(true);
    expect(caches.delete).toHaveBeenCalledExactlyOnceWith(TAGGER_MODEL.cache);
    expect(store.updateSettings).toHaveBeenLastCalledWith({ aiTaggingEnabled: false });
    expect(state.ready).toBe(false); expect(state.cached).toBe(false); expect(state.downloaded).toBe(false);
    caches.has.mockResolvedValue(false);
    await service.initialize(store);
    expect(state.dialog).toBe(false);
    service.showPrompt(); expect(state.dialog).toBe(true);
  });
  it('stops an in-flight download before removing its cache and allows reinstallation', async () => {
    const downloading = service.prepare(store), downloadWorker = worker;
    const uninstalling = service.uninstall(store);
    expect(downloadWorker.terminated).toBe(true);
    expect(await downloading).toBe(false); expect(await uninstalling).toBe(true);
    expect(state.phase).toBe('prompt'); expect(state.error).toBe('');
    expect(store.updateSettings).not.toHaveBeenCalledWith({ aiTaggingEnabled: true });
    const reinstalling = service.prepare(store), id = worker.messages[0].id;
    worker.reply({ id, result: true });
    expect(await reinstalling).toBe(true); expect(state.ready).toBe(true);
  });
  it('reports cache deletion failures and permits retry while keeping tagging disabled', async () => {
    state.cached = true;
    caches.delete.mockRejectedValueOnce(new Error('Storage is unavailable'));
    expect(await service.uninstall(store)).toBe(false);
    expect(state.error).toContain('Could not uninstall model'); expect(state.cached).toBe(true);
    expect(state.ready).toBe(false); expect(state.removing).toBe(false);
    expect(await service.uninstall(store)).toBe(true); expect(state.cached).toBe(false);
  });
});
