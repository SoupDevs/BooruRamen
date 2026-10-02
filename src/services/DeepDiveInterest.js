import { postKey } from './postKey.js';
import { SessionInterest } from './SessionInterest.js';

export const DEEP_DIVE_WEIGHT = 0.9;
export const DEEP_DIVE_PROFILE_SCALE = 0.1;

function tagWeights(post, avoided) {
  const weights = new Map();
  for (const tag of (post.tag_string || '').split(/\s+/)) if (tag && !avoided.has(tag)) weights.set(tag, 1);
  for (const [category, weight] of [['artist', 2], ['copyright', 2.5], ['character', 3], ['general', 1]]) {
    for (const tag of (post[`tag_string_${category}`] || '').split(/\s+/)) if (tag && !avoided.has(tag)) weights.set(tag, weight);
  }
  for (const tag of (post.tag_string_meta || '').split(/\s+/)) weights.delete(tag);
  return weights;
}

export class DeepDiveInterest {
  constructor() { this.anchor = null; this.evidence = new SessionInterest(); }
  get active() { return !!this.anchor; }
  start(post) {
    if (!post?.id) throw new Error('Choose a post to start a Deep Dive.');
    this.anchor = JSON.parse(JSON.stringify(post)); // The target stays fixed while scrolling.
    this.evidence.reset();
  }
  end() { this.anchor = null; this.evidence.reset(); }
  refresh(post) {
    if (this.active && postKey(post) === postKey(this.anchor)) this.anchor = JSON.parse(JSON.stringify(post));
  }
  profileWeight(post, type, value, avoided) {
    return this.evidence.record(post, type, value, avoided) * DEEP_DIVE_PROFILE_SCALE;
  }
  queries(avoided = [], embeddings) {
    if (!this.anchor) return [];
    const tags = [...tagWeights(this.anchor, new Set(avoided))]
      .map(([tag, weight]) => ({ tag, weight: weight / Math.sqrt(1 + (embeddings?.tagFrequency?.get(tag) || 0)) }))
      .sort((a, b) => b.weight - a.weight).slice(0, 4);
    if (!tags.length) return [{ tags: 'order:rank', type: 'deepDive', intent: 'Visual similarity to the selected post' }];
    const queries = tags.slice(0, 3).map(({ tag }) => ({ tags: tag, type: 'deepDive', intent: 'Similar to the selected post' }));
    if (tags.length > 1) queries.unshift({ tags: `${tags[0].tag} ${tags[1].tag}`, type: 'deepDive', intent: 'Shared core tags with the selected post' });
    return queries;
  }
  similarity(post, avoided = [], embeddings) {
    if (!this.anchor) return 0;
    const excluded = new Set(avoided), anchorTags = tagWeights(this.anchor, excluded), candidateTags = tagWeights(post, excluded);
    let shared = 0, anchorMass = 0, union = 0;
    for (const tag of new Set([...anchorTags.keys(), ...candidateTags.keys()])) {
      const idf = 1 / Math.sqrt(1 + (embeddings?.tagFrequency?.get(tag) || 0));
      const a = (anchorTags.get(tag) || 0) * idf, b = (candidateTags.get(tag) || 0) * idf;
      shared += Math.min(a, b); anchorMass += a; union += Math.max(a, b);
    }
    const tagScore = anchorMass ? 0.7 * shared / anchorMass + 0.3 * shared / Math.max(1e-8, union) : 0;
    let total = tagScore * 0.75, mass = anchorMass ? 0.75 : 0;
    const aEmb = embeddings?.getPostEmbedding([...anchorTags.keys()]), bEmb = embeddings?.getPostEmbedding([...candidateTags.keys()]);
    if (aEmb && bEmb) {
      let dot = 0, aNorm = 0, bNorm = 0;
      for (let i = 0; i < aEmb.length; i++) { dot += aEmb[i] * bEmb[i]; aNorm += aEmb[i] ** 2; bNorm += bEmb[i] ** 2; }
      if (aNorm && bNorm) { total += Math.max(0, dot / Math.sqrt(aNorm * bNorm)) * 0.25; mass += 0.25; }
    }
    const a = this.anchor.imageAnalysis?.composition, b = post.imageAnalysis?.composition;
    if ([a, b].every(values => Array.isArray(values) && values.length === 32 && values.every(Number.isFinite))) {
      const distance = a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length;
      total += Math.exp(-8 * distance) * 0.5; mass += 0.5;
    }
    return mass ? Math.max(0, Math.min(1, total / mass)) : 0;
  }
  blend(profileSessionScore, post, avoided, embeddings) {
    return this.active ? profileSessionScore * (1 - DEEP_DIVE_WEIGHT) + this.similarity(post, avoided, embeddings) * DEEP_DIVE_WEIGHT : profileSessionScore;
  }
}
