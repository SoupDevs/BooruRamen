import { reactive } from 'vue';
import { TAGGER_MODEL } from './wdTagger.js';

export const aiTaggerState = reactive({ dialog: false, phase: 'prompt', progress: 0, loaded: 0, error: '', ready: false, cached: false, downloaded: false, removing: false });
const DECISION_KEY = 'booruRamenAiTaggerDecision';

class AiTaggerService {
  constructor() { this.pending = new Map(); this.nextId = 0; this.worker = null; this.preparing = null; }

  showPrompt() {
    if (!this.preparing) aiTaggerState.phase = aiTaggerState.ready ? 'ready' : 'prompt';
    aiTaggerState.dialog = true;
  }
  async initialize(settings) {
    await settings.initialize();
    try {
      aiTaggerState.cached = typeof caches !== 'undefined' && await caches.has(TAGGER_MODEL.cache);
      const files = aiTaggerState.cached ? await (await caches.open(TAGGER_MODEL.cache)).keys() : [];
      aiTaggerState.downloaded = ['model.onnx', 'selected_tags.csv'].every(file => files.some(request => request.url === TAGGER_MODEL.baseUrl + file));
    } catch { aiTaggerState.cached = false; aiTaggerState.downloaded = false; }
    const decision = localStorage.getItem(DECISION_KEY);
    if (!decision) this.showPrompt();
    else if (decision === 'accepted') this.prepare(settings, true);
    else if (settings.aiTaggingEnabled) this.prepare(settings, false);
  }
  decline(settings) {
    localStorage.setItem(DECISION_KEY, 'declined');
    settings.updateSettings({ aiTaggingEnabled: false });
    this.stop();
    aiTaggerState.phase = 'declined';
  }

  request(type, blob) {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/aiTagger.worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        if (data.phase) { Object.assign(aiTaggerState, { phase: data.phase, progress: data.progress, loaded: data.loaded }); return; }
        const pending = this.pending.get(data.id);
        if (!pending) return;
        this.pending.delete(data.id);
        if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result);
      };
      this.worker.onerror = () => this.stop(new Error('The local tagging worker could not start.'));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, type, blob }); });
  }

  async prepare(settings, show = true) {
    if (aiTaggerState.removing) return false;
    if (this.preparing) { if (show) aiTaggerState.dialog = true; return this.preparing; }
    localStorage.setItem(DECISION_KEY, 'accepted');
    Object.assign(aiTaggerState, { phase: 'downloading', error: '', progress: 0, loaded: 0, dialog: show, cached: true });
    this.preparing = (async () => {
      try {
        await this.request('prepare');
        Object.assign(aiTaggerState, { ready: true, downloaded: true, phase: 'ready', progress: 1 });
        localStorage.setItem(DECISION_KEY, 'ready');
        settings.updateSettings({ aiTaggingEnabled: true });
        return true;
      } catch (error) {
        Object.assign(aiTaggerState, { ready: false, phase: 'failed', error: error.message });
        settings.updateSettings({ aiTaggingEnabled: false });
        return false;
      } finally { this.preparing = null; }
    })();
    return this.preparing;
  }

  stop(error = new Error('Model download cancelled.')) {
    this.worker?.terminate(); this.worker = null;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear(); aiTaggerState.ready = false;
  }
  cancel() { localStorage.setItem(DECISION_KEY, 'declined'); this.stop(); }
  async uninstall(settings) {
    if (aiTaggerState.removing) return false;
    Object.assign(aiTaggerState, { removing: true, error: '', dialog: false });
    localStorage.setItem(DECISION_KEY, 'declined');
    settings.updateSettings({ aiTaggingEnabled: false });
    const preparing = this.preparing;
    this.stop(new Error('Model uninstalled.'));
    try {
      // Stop download/inference first, then let pending prepare settle so it
      // cannot re-enable tagging or overwrite the uninstall result.
      if (preparing) await preparing;
      if (typeof caches === 'undefined') throw new Error('Model storage is unavailable on this device.');
      await caches.delete(TAGGER_MODEL.cache);
      Object.assign(aiTaggerState, { cached: false, downloaded: false, ready: false, phase: 'prompt', progress: 0, loaded: 0, error: '' });
      return true;
    } catch (error) {
      Object.assign(aiTaggerState, { phase: 'failed', error: `Could not uninstall model: ${error.message}` });
      return false;
    } finally { aiTaggerState.removing = false; }
  }
  tag(blob) { return this.request('tag', blob); }
}

export { TAGGER_MODEL };
export default new AiTaggerService();
