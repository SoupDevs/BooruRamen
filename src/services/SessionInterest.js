import { postKey } from './postKey.js';

export const SESSION_IDLE_MS = 15 * 60 * 1000;
export const SESSION_HALF_LIFE_MS = 5 * 60 * 1000;
export const MAX_SESSION_WEIGHT = 0.25;
export const PROFILE_HALF_LIFE_HOURS = 30 * 24;

export function interactionSignal(type, value) {
  if (['like', 'favorite', 'dislike'].includes(type) && !value) return 0;
  if (type === 'like') return 1;
  if (type === 'favorite') return 2;
  if (type === 'dislike') return -1;
  if (type === 'view') return 0.05;
  if (type === 'timeSpent') return value < 2000 ? -0.2 : Math.min(1, value / 30000);
  return 0;
}

function tagsOf(post, avoided) {
  return [...new Set([post.tag_string || '', ...['artist', 'copyright', 'character', 'general'].map(category => post[`tag_string_${category}`] || '')]
    .join(' ').split(/\s+/).filter(tag => tag && !avoided.has(tag)))];
}

// Ephemeral session state is deliberately excluded from profile snapshots.
export class SessionInterest {
  constructor(clock = Date.now) { this.clock = clock; this.reset(); }
  reset() {
    this.tags = new Map(); this.ratings = new Map(); this.media = new Map();
    this.positiveVisual = null; this.negativeVisual = null;
    this.mass = 0; this.lastInteraction = null; this.lastDecay = this.clock();
    this.durableBudget = new Map(); this.seen = new Set(); this.revision = (this.revision || 0) + 1;
  }
  advance() {
    const now = this.clock();
    if (this.lastInteraction !== null && now - this.lastInteraction >= SESSION_IDLE_MS) { this.reset(); return; }
    if (now - this.lastDecay < 1000) return; // One decay pass per second, not per candidate.
    const decay = Math.pow(0.5, Math.max(0, now - this.lastDecay) / SESSION_HALF_LIFE_MS);
    for (const map of [this.tags, this.ratings, this.media]) for (const [key, value] of map) map.set(key, value * decay);
    for (const visual of [this.positiveVisual, this.negativeVisual]) if (visual) {
      visual.mass *= decay; visual.sum = visual.sum.map(value => value * decay);
    }
    this.mass *= decay; this.lastDecay = now;
  }
  record(post, type, value, avoided = []) {
    this.advance();
    const signal = interactionSignal(type, value);
    if (!post || !signal) return 0;
    const key = `${postKey(post)}:${type}`;
    if (this.seen.has(key)) return 0; // Revisits/toggle churn cannot amplify a trend.
    this.seen.add(key);
    const tags = tagsOf(post, new Set(avoided));
    const bump = (map, name) => { if (name) map.set(name, Math.max(-6, Math.min(6, (map.get(name) || 0) + signal))); };
    tags.forEach(tag => bump(this.tags, tag)); bump(this.ratings, post.rating);
    bump(this.media, ['mp4', 'webm'].includes(post.file_ext) ? 'video' : 'image');
    const visual = post.imageAnalysis?.composition;
    if (Array.isArray(visual) && visual.length === 32 && visual.every(Number.isFinite)) {
      const name = signal > 0 ? 'positiveVisual' : 'negativeVisual';
      const centroid = this[name] ||= { mass: 0, sum: new Array(32).fill(0) };
      centroid.mass += Math.abs(signal);
      centroid.sum = centroid.sum.map((sum, i) => sum + visual[i] * Math.abs(signal));
    }
    this.mass = Math.min(20, this.mass + Math.abs(signal));
    this.lastInteraction = this.clock(); this.revision++;
    // At most two units of lasting evidence per topic/session. A new session
    // gets a new budget, so consistent interests across sessions accumulate.
    const topics = tags.length ? tags.map(tag => `tag:${tag}`) : [`media:${post.file_ext || 'image'}`];
    const spent = Math.max(...topics.map(tag => this.durableBudget.get(tag) || 0));
    const base = ['like', 'favorite', 'dislike'].includes(type) ? 0.35 : 0.15;
    const durableWeight = Math.max(0, Math.min(base / Math.sqrt(1 + spent), (2 - spent) / Math.abs(signal)));
    for (const topic of topics) this.durableBudget.set(topic, (this.durableBudget.get(topic) || 0) + Math.abs(signal) * durableWeight);
    return durableWeight;
  }
  get weight() { this.advance(); return MAX_SESSION_WEIGHT * this.mass / (this.mass + 4); }
  affinities() { this.advance(); return Object.fromEntries([...this.tags].map(([tag, value]) => [tag, Math.tanh(value / 2)])); }
  score(post, avoided = []) {
    this.advance();
    const tags = tagsOf(post, new Set(avoided));
    const matches = tags.map(tag => this.tags.get(tag) || 0).filter(Boolean);
    let signal = matches.length ? matches.reduce((sum, value) => sum + Math.tanh(value / 2), 0) / matches.length : 0;
    signal = signal * 0.8 + Math.tanh((this.ratings.get(post.rating) || 0) / 3) * 0.1
      + Math.tanh((this.media.get(['mp4', 'webm'].includes(post.file_ext) ? 'video' : 'image') || 0) / 3) * 0.1;
    const visual = post.imageAnalysis?.composition;
    if (Array.isArray(visual) && visual.length === 32 && visual.every(Number.isFinite)) {
      const similarity = centroid => {
        if (!centroid || centroid.mass < 0.1) return 0;
        const distance = visual.reduce((sum, value, i) => sum + (value - centroid.sum[i] / centroid.mass) ** 2, 0) / 32;
        return Math.exp(-8 * distance) * Math.min(1, centroid.mass / 2);
      };
      signal = signal * 0.8 + (similarity(this.positiveVisual) - similarity(this.negativeVisual)) * 0.2;
    }
    return Math.max(0, Math.min(1, 0.5 + signal * 0.5));
  }
  blend(profileScore, post, avoided = []) {
    const weight = this.weight;
    return profileScore * (1 - weight) + this.score(post, avoided) * weight;
  }
}
