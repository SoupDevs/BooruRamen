import { reactive } from 'vue';
import { getActiveProfileDbName } from './ProfileService.js';
import { normalizeTag, sourceKey, rankTags } from './tagMatching.js';
export { scoreTag } from './tagMatching.js';
export const tagCatalogStatus = reactive({ sources: [] });

export class TagSuggestionService {
  constructor() {
    this.tags = new Map(); this.sources = []; this.adapters = []; this.primePromise = null;
    this.remoteCache = new Map(); this.lastRemoteQuery = ''; this.generation = 0;
    this.worker = null; this.nextId = 0; this.pending = new Map(); this.jobs = new Map(); this.listeners = new Set();
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify() { this.listeners.forEach(listener => listener()); }
  ingestTags(input, source) {
    const key = sourceKey(source);
    if (!input || !key) return 0; // Unscoped tags cannot prove source membership.
    if (!this.tags.has(key)) this.tags.set(key, new Set());
    const tags = this.tags.get(key), before = tags.size;
    for (const raw of Array.isArray(input) ? input : String(input).split(/\s+/)) {
      const tag = normalizeTag(raw); if (tag) tags.add(tag);
    }
    return tags.size - before;
  }
  get size() { return new Set(this.sources.flatMap(source => [...(this.tags.get(source) || [])])).size; }
  request(type, payload) {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/tagCatalog.worker.js', import.meta.url), { type: 'module', name: getActiveProfileDbName() });
      this.worker.onmessage = ({ data }) => {
        const pending = this.pending.get(data.id); if (!pending) return;
        this.pending.delete(data.id);
        if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result);
      };
      this.worker.onerror = () => {
        for (const pending of this.pending.values()) pending.reject(new Error('Tag catalog worker failed.'));
        this.pending.clear(); this.worker.terminate(); this.worker = null;
      };
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, type, payload }); });
  }
  setSources(sources, adapters) {
    this.sources = [...new Set(sources.map(source => sourceKey(source.url)))];
    this.adapters = adapters;
    this.generation++; this.remoteCache.clear(); this.lastRemoteQuery = '';
    // Restart with the current adapter credentials, resuming persisted cursors.
    for (const job of this.jobs.values()) job.abort();
    this.jobs.clear();
    tagCatalogStatus.sources = this.sources.map(source => ({ source, count: 0, phase: 'loading', error: '' }));
    this.notify();
    for (const adapter of adapters) this.startCatalog(adapter);
  }
  async prime() {
    if (this.primePromise) return this.primePromise;
    this.primePromise = (async () => {
      const { default: BooruService } = await import('./BooruService.js');
      await BooruService.initialize();
      if (!this.sources.length) this.setSources(BooruService.activeSources, BooruService.adapters);
      const { default: StorageService } = await import('./StorageService.js');
      const history = await StorageService.getViewedPosts();
      for (const entry of Object.values(history)) {
        if (entry.data) this.ingestTags(entry.data.tag_string || entry.data.tags, entry.data.source);
      }
      this.notify();
    })().catch(error => { this.primePromise = null; console.warn('[TagSuggestion] Index unavailable:', error.message); });
    return this.primePromise;
  }
  async startCatalog(adapter) {
    const source = sourceKey(adapter.baseUrl);
    if (this.jobs.has(source)) return;
    const controller = new AbortController(); this.jobs.set(source, controller);
    const update = patch => {
      if (this.jobs.get(source) !== controller) return;
      const status = tagCatalogStatus.sources.find(item => item.source === source);
      if (status) Object.assign(status, patch);
    };
    try {
      const loaded = await this.request('load', { source });
      let state = loaded.state || {};
      update({ count: loaded.count }); this.notify();
      if (state.complete && Date.now() - state.updatedAt < 7 * 86400000) { update({ phase: 'ready' }); return; }
      if (state.complete) state = {};
      while (!controller.signal.aborted && this.sources.includes(source)) {
        // Posts take priority; slowly retrieve every catalog page in the background.
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (controller.signal.aborted) return;
        const { default: BooruService } = await import('./BooruService.js');
        if (BooruService.activePostRequests || (typeof document !== 'undefined' && document.hidden)) continue;
        const timeout = setTimeout(() => controller.abort(), 20000);
        let page;
        try { page = await adapter.getTagPage(state.cursor, controller.signal); }
        finally { clearTimeout(timeout); }
        if (controller.signal.aborted) return;
        if (page.tags.length && page.signature === state.signature) throw new Error('This source repeats tag pages; its catalog could not be completed.');
        state = { cursor: page.nextCursor, signature: page.signature, complete: page.done, updatedAt: Date.now() };
        const saved = await this.request('page', { source, tags: page.tags, state });
        this.remoteCache.clear(); update({ count: saved.count, phase: page.done ? 'ready' : 'loading' }); this.notify();
        if (page.done) return;
      }
    } catch (error) { update({ phase: 'failed', error: error.message }); this.notify(); }
    finally { if (this.jobs.get(source) === controller) this.jobs.delete(source); }
  }
  retryCatalogs() { for (const adapter of this.adapters) this.startCatalog(adapter); }
  suggest(query, { limit = 8, exclude = [] } = {}) {
    const all = this.sources.flatMap(source => [...(this.tags.get(source) || [])]);
    return rankTags(all, query, limit, exclude);
  }
  async remoteSuggest(query, limit = 10) {
    const q = normalizeTag(query); if (!q) return [];
    const generation = this.generation, sources = [...this.sources];
    const cacheKey = `${generation}:${q}:${limit}`;
    if (this.remoteCache.has(cacheKey)) return this.remoteCache.get(cacheKey);
    const catalog = this.request('search', { sources, query: q, limit }).catch(() => []);
    const remote = this.adapters.map(async adapter => {
      let timer;
      try {
        const tags = await Promise.race([adapter.searchTags(q, limit), new Promise(resolve => { timer = setTimeout(() => resolve([]), 2500); })]);
        if (generation === this.generation) this.ingestTags(tags, adapter.baseUrl);
        return tags;
      } catch { return []; } finally { clearTimeout(timer); }
    });
    const results = await Promise.all([catalog, ...remote]);
    if (generation !== this.generation) return [];
    const merged = rankTags(results.flat(), q, limit);
    if (this.remoteCache.size >= 60) this.remoteCache.clear();
    this.remoteCache.set(cacheKey, merged); return merged;
  }
  markRemoteQuery(query) { this.lastRemoteQuery = normalizeTag(query); }
  isRemoteQueryCurrent(query) { return this.lastRemoteQuery === normalizeTag(query); }
}
export const tagSuggestionService = new TagSuggestionService();
export default tagSuggestionService;
