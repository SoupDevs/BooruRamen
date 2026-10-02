import { db } from './db.js';
import { analysisKey, contentKeys } from './contentIdentity.js';
import { getDisplayableMediaUrl, releaseDisplayableMediaUrl } from './mediaUrl.js';
import { httpFetch } from './httpClient.js';
import { postKey } from './postKey.js';
import { IMAGE_ANALYSIS_VERSION } from './imageFeatures.js';
import { useSettingsStore } from '../stores/settings.js';
import aiTagger, { aiTaggerState } from './AiTaggerService.js';
import { TAGGER_MODEL } from './wdTagger.js';
import { hydrateImageAnalysis } from './ImageAnalysisCache.js';

class ImageAnalysisService {
  constructor() {
    this.queue = new Map(); this.aiQueue = new Map(); this.running = false; this.aiRunning = false;
    this.listeners = new Set(); this.worker = null; this.nextId = 0; this.pending = new Map();
    this.failedUntil = new Map();
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  enqueue(posts, originalLoaded = false) {
    for (const post of posts) {
      if (!['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'].includes(String(post.file_ext || '').toLowerCase())) continue;
      const key = analysisKey(post);
      if ((this.failedUntil.get(key) || 0) > Date.now()) continue;
      const needsSha = originalLoaded && !contentKeys(post).some(key => key.startsWith('md5:') || key.startsWith('sha256:'));
      const needsAi = useSettingsStore().aiTaggingEnabled && aiTaggerState.ready && post.imageAnalysis?.aiModel !== TAGGER_MODEL.revision;
      if (post.imageAnalysis?.version === IMAGE_ANALYSIS_VERSION && !needsSha && !needsAi) continue;
      this.queue.set(key, { post, originalLoaded: needsSha || this.queue.get(key)?.originalLoaded });
      // A quick scroller cannot accumulate a growing backlog of unseen images.
      if (this.queue.size > 16) this.queue.delete(this.queue.keys().next().value);
    }
    this.drain();
  }

  request(blob, original) {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/imageAnalysis.worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        const pending = this.pending.get(data.id);
        if (!pending) return;
        this.pending.delete(data.id); clearTimeout(pending.timer);
        if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result);
      };
      this.worker.onerror = () => {
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Image analysis worker failed.')); }
        this.pending.clear(); this.worker.terminate(); this.worker = null;
      };
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Image analysis timed out.')); }, 30000);
      this.pending.set(id, { resolve, reject, timer }); this.worker.postMessage({ id, blob, original });
    });
  }

  async save(post, analysis) {
    // Vue proxies cannot be written to IndexedDB or posted to workers.
    const plain = JSON.parse(JSON.stringify(analysis));
    post.imageAnalysis = plain;
    const keys = [...new Set([analysisKey(post), `post:${postKey(post)}`])];
    await db.imageAnalysis.bulkPut(keys.map(key => ({ key, analysis: plain, updatedAt: Date.now() })));
    // History written before the background task finished must gain its hash,
    // too, otherwise cross-source repeats reappear on the next app launch.
    await db.viewHistory.update(postKey(post), { 'data.imageAnalysis': plain });
    for (const listener of this.listeners) listener(post);
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.size) {
        await new Promise(resolve => setTimeout(resolve, 150));
        if (typeof document !== 'undefined' && document.hidden) break;
        const { default: BooruService } = await import('./BooruService.js');
        if (BooruService.activePostRequests) continue;
        const [key, item] = this.queue.entries().next().value;
        this.queue.delete(key);
        const { post, originalLoaded } = item;
        let resolved;
        try {
          await hydrateImageAnalysis([post]);
          const original = originalLoaded && !contentKeys(post).some(key => key.startsWith('md5:') || key.startsWith('sha256:'));
          const needsAi = useSettingsStore().aiTaggingEnabled && aiTaggerState.ready && post.imageAnalysis?.aiModel !== TAGGER_MODEL.revision;
          if (post.imageAnalysis?.version === IMAGE_ANALYSIS_VERSION && !original && !needsAi) continue;
          // Small media for composition/tagging; fetch originals only after the
          // viewer has already loaded them and the source supplied no hash.
          const url = original ? post.file_url : (post.sample_file_url || post.sample_url || post.preview_file_url || post.preview_url);
          if (!url) continue;
          resolved = await getDisplayableMediaUrl(url);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          let blob;
          try {
            const fetcher = /^https?:/.test(resolved) && !resolved.includes('asset.localhost') ? httpFetch : fetch;
            const response = await fetcher(resolved, { signal: controller.signal, priority: 'low' });
            if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
            const maxSize = original ? 32 * 1024 * 1024 : 5 * 1024 * 1024;
            if (Number(response.headers.get('content-length')) > maxSize) { controller.abort(); continue; }
            blob = await response.blob();
            if (blob.size > maxSize) continue;
          } finally { clearTimeout(timer); }
          if (!post.imageAnalysis || original) {
            const result = await this.request(blob, original);
            await this.save(post, { ...post.imageAnalysis, ...result });
          }
          if (needsAi) {
            this.aiQueue.set(key, { post, blob });
            if (this.aiQueue.size > 4) this.aiQueue.delete(this.aiQueue.keys().next().value);
            this.drainAi();
          }
        } catch (error) {
          this.failedUntil.set(key, Date.now() + 60000);
          if (this.failedUntil.size > 256) this.failedUntil.delete(this.failedUntil.keys().next().value);
          console.warn('[ImageAnalysis] Skipping unavailable image:', error.message);
        } finally { if (resolved) releaseDisplayableMediaUrl(resolved); }
      }
    } finally { this.running = false; }
  }

  async drainAi() {
    if (this.aiRunning) return;
    this.aiRunning = true;
    try {
      while (this.aiQueue.size && useSettingsStore().aiTaggingEnabled && aiTaggerState.ready) {
        const [key, { post, blob }] = this.aiQueue.entries().next().value;
        this.aiQueue.delete(key);
        try {
          const aiTags = await aiTagger.tag(blob);
          if (useSettingsStore().aiTaggingEnabled) await this.save(post, { ...post.imageAnalysis, aiTags, aiModel: TAGGER_MODEL.revision });
        } catch (error) { console.warn('[ImageAnalysis] AI enrichment unavailable:', error.message); }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } finally { this.aiQueue.clear(); this.aiRunning = false; }
  }
}

export default new ImageAnalysisService();
