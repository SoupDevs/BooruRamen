/**
 * TagEmbedding.js
 * Builds tag co-occurrence embeddings from user interaction history.
 *
 * Approach: Pointwise Mutual Information (PMI) on tag co-occurrence within
 * the user's positive interactions. Tags that frequently appear together in
 * liked/favorited posts get similar embedding vectors.
 *
 * No external dependencies — pure JS math. Embeddings are stored in IndexedDB
 * for persistence across sessions.
 */

import StorageService from '../services/StorageService';
import { isPositiveEngagement } from './signals.js';

const EMBEDDING_DIM = 32;
const MIN_EMBEDDING_NORM = 0.01;
// New interactions only re-embed their own tags. Every other tag drifts a
// little as global frequencies change, so the whole table is rebuilt every
// FULL_REBUILD_INTERVAL interactions instead of on every new tag.
const FULL_REBUILD_INTERVAL = 100;

/**
 * Simple seeded PRNG (mulberry32) for reproducible embeddings.
 */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash a string to a 32-bit integer (FNV-1a).
 */
function hashString(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

class TagEmbedding {
  constructor() {
    this.dim = EMBEDDING_DIM;
    this.embeddings = new Map();      // tag -> Float32Array
    this.pendingTags = new Set();    // tags seen but not yet PMI-embedded
    this.tagCooccurrence = new Map();  // tag -> Map(tag -> count)
    this.tagFrequency = new Map();      // tag -> count
    this.totalPosts = 0;
    this.isBuilt = false;
    this.pendingInteractions = [];    // interactions queued before build
    this.buildThreshold = 5;          // minimum interactions to start building
    this.totalCoocWeight = 0;         // sum of every co-occurrence count
    this.projections = new Map();     // tag -> unscaled random projection
    this.sinceRebuild = 0;            // interactions since the last full build
  }

  /**
   * Initialize from stored co-occurrence data in IndexedDB.
   */
  async init() {
    const snapshot = await StorageService.getProfileSnapshot();
    if (snapshot && snapshot.tagEmbeddings) {
      this.loadFromSnapshot(snapshot.tagEmbeddings);
    }
    this.isBuilt = true;
  }

  /**
   * Load embeddings from a stored snapshot.
   */
  loadFromSnapshot(data) {
    if (!data) return;
    this.embeddings = new Map();
    for (const [tag, arr] of Object.entries(data.embeddings || {})) {
      this.embeddings.set(tag, new Float32Array(arr));
    }
    this.tagFrequency = new Map(Object.entries(data.tagFrequency || {}));
    this.tagCooccurrence = new Map();
    for (const [tag, coocs] of Object.entries(data.tagCooccurrence || {})) {
      this.tagCooccurrence.set(tag, new Map(Object.entries(coocs)));
    }
    this.totalPosts = data.totalPosts || 0;
    this.totalCoocWeight = 0;
    for (const coocs of this.tagCooccurrence.values()) {
      for (const count of coocs.values()) this.totalCoocWeight += count;
    }
    // If snapshot has more frequency entries than embeddings, mark the diff as pending
    if (this.tagFrequency.size > this.embeddings.size) {
      for (const tag of this.tagFrequency.keys()) {
        if (!this.embeddings.has(tag)) {
          this.pendingTags.add(tag);
        }
      }
    }
  }

  /**
   * Reset all learned co-occurrence data so embeddings rebuild from
   * scratch. Keeps isBuilt true: the instance stays usable and simply
   * re-learns from interactions that arrive after the reset.
   */
  reset() {
    this.embeddings = new Map();
    this.pendingTags = new Set();
    this.tagCooccurrence = new Map();
    this.tagFrequency = new Map();
    this.totalPosts = 0;
    this.pendingInteractions = [];
    this.totalCoocWeight = 0;
    this.sinceRebuild = 0;
  }

  /**
   * Serialize for storage.
   */
  toSnapshot() {
    const embeddings = {};
    for (const [tag, arr] of this.embeddings) {
      embeddings[tag] = Array.from(arr);
    }
    const tagCooccurrence = {};
    for (const [tag, coocs] of this.tagCooccurrence) {
      tagCooccurrence[tag] = Object.fromEntries(coocs);
    }
    const tagFrequency = Object.fromEntries(this.tagFrequency);
    return {
      embeddings,
      tagCooccurrence,
      tagFrequency,
      pendingTags: Array.from(this.pendingTags),
      totalPosts: this.totalPosts,
    };
  }

  /**
   * Process a batch of interactions to update co-occurrence statistics.
   * @param {Array} interactions - Array of { metadata: { post: {...} } }
   */
  processInteractions(interactions) {
    if (!interactions || interactions.length === 0) return;

    for (const interaction of interactions) {
      const weight = interaction.metadata?.profileWeight ?? 1;
      if (!Number.isFinite(weight) || weight <= 0) continue;
      const post = interaction.metadata?.post;
      if (!post || !post.tag_string) continue;

      const tags = post.tag_string
        .split(' ')
        .filter(t => t && !this._isNoiseTag(t));

      if (tags.length === 0) continue;

      this.totalPosts += weight;

      // Update frequency
      for (const tag of tags) {
        this.tagFrequency.set(tag, (this.tagFrequency.get(tag) || 0) + weight);
      }

      // Update co-occurrence (only for positive interactions)
      const isPositive =
        isPositiveEngagement(interaction.type, interaction.value, interaction.metadata?.engagement);

      if (isPositive) {
        for (let i = 0; i < tags.length; i++) {
          for (let j = i + 1; j < tags.length; j++) {
            this._addCooccurrence(tags[i], tags[j], weight);
            this._addCooccurrence(tags[j], tags[i], weight);
          }
        }
      }
    }

    // Rebuild embeddings from co-occurrence data
    this._buildEmbeddings();
  }

  /**
   * Incrementally update with a single interaction (for real-time updates).
   */
  addInteraction(interaction) {
    const weight = interaction.metadata?.profileWeight ?? 1;
    if (!Number.isFinite(weight) || weight <= 0) return;
    const post = interaction.metadata?.post;
    if (!post || !post.tag_string) return;

    const tags = post.tag_string
      .split(' ')
      .filter(t => t && !this._isNoiseTag(t));

    if (tags.length === 0) return;

    this.totalPosts += weight;

    for (const tag of tags) {
      this.tagFrequency.set(tag, (this.tagFrequency.get(tag) || 0) + weight);
    }

    const isPositive =
      isPositiveEngagement(interaction.type, interaction.value, interaction.metadata?.engagement);

    if (isPositive) {
      for (let i = 0; i < tags.length; i++) {
        for (let j = i + 1; j < tags.length; j++) {
          this._addCooccurrence(tags[i], tags[j], weight);
          this._addCooccurrence(tags[j], tags[i], weight);
        }
      }
    }

    // Only this post's tags gained co-occurrence counts, so only their rows
    // need re-embedding now (new tags included). Re-embedding every tag
    // they co-occur with is a full rebuild once a common tag is involved.
    this._updateEmbeddingsForTags(new Set(tags));
    this.sinceRebuild++;

    // Full rebuild: first build, tags restored from a snapshot without
    // embeddings, or periodic refresh of the tags not touched above.
    const firstBuild = this.totalPosts >= this.buildThreshold && this.embeddings.size === 0;
    const restoredPending = this.pendingTags.size > 0 && this.tagFrequency.size >= this.buildThreshold;
    if (firstBuild || restoredPending || this.sinceRebuild >= FULL_REBUILD_INTERVAL) {
      this._buildEmbeddings();
    }
  }

  _addCooccurrence(tagA, tagB, weight = 1) {
    if (!this.tagCooccurrence.has(tagA)) {
      this.tagCooccurrence.set(tagA, new Map());
    }
    const coocs = this.tagCooccurrence.get(tagA);
    coocs.set(tagB, (coocs.get(tagB) || 0) + weight);
    this.totalCoocWeight += weight;
  }

  /**
   * Build embeddings using PMI + random projection.
   *
   * For each tag, we compute a vector based on its co-occurrence patterns.
   * This is a lightweight alternative to full Word2Vec — we use random
   * projection of the PMI matrix row as the embedding.
   */
  _buildEmbeddings() {
    if (this.tagFrequency.size === 0) return;

    const tags = Array.from(this.tagFrequency.keys());
    const n = tags.length;
    if (n === 0) return;

    // Clear pending set before rebuild so we don't re-trigger on every interaction
    this.pendingTags.clear();
    this.sinceRebuild = 0;

    // If very few tags, just use small deterministic random embeddings
    if (n < 10) {
      for (const tag of tags) {
        this.embeddings.set(tag, this._randomProjection(tag, 0.1));
      }
      this.isBuilt = true;
      return;
    }

    // Compute PMI-based embeddings using random projection
    // For each tag t, embedding = Σ_cooc PMI(t, cooc) * random_proj(cooc)

    const totalCoocWeight = this.totalCoocWeight || 1;

    // Build PMI embeddings
    for (const tag of tags) {
      const pTag = (this.tagFrequency.get(tag) || 1) / this.totalPosts;
      const coocs = this.tagCooccurrence.get(tag);
      if (!coocs || coocs.size === 0) {
        // No co-occurrence data: small self projection so random vectors
        // don't dominate averages over learned PMI embeddings
        this.embeddings.set(tag, this._randomProjection(tag, 0.1));
        continue;
      }

      const vec = new Float32Array(this.dim);
      let norm = 0;

      for (const [coocTag, count] of coocs) {
        const pCooc = (this.tagFrequency.get(coocTag) || 1) / this.totalPosts;
        const pJoint = count / totalCoocWeight;

        // PMI = log(P(t,cooc) / (P(t) * P(cooc)))
        let pmi = Math.log((pJoint + 1e-10) / (pTag * pCooc + 1e-10));
        if (pmi < 0) pmi = 0;  // Use positive PMI only

        const proj = this.tagFrequency.has(coocTag) ? this._projection(coocTag) : null;
        if (proj) {
          for (let i = 0; i < this.dim; i++) {
            vec[i] += pmi * proj[i];
          }
          norm += pmi;
        }
      }

      // Normalize
      if (norm > MIN_EMBEDDING_NORM) {
        for (let i = 0; i < this.dim; i++) {
          vec[i] /= norm;
        }
      } else {
        // Fallback to self random projection
        const selfProj = this._projection(tag);
        for (let i = 0; i < this.dim; i++) {
          vec[i] = selfProj[i] * 0.1;
        }
      }

      this.embeddings.set(tag, vec);
    }

    this.isBuilt = true;
  }

  /**
   * Incrementally update embeddings for a subset of tags.
   * Uses the same PMI + random-projection scheme as _buildEmbeddings so
   * incremental updates and full rebuilds produce the same geometry.
   */
  _updateEmbeddingsForTags(tagSet) {
    if (tagSet.size === 0) return;

    const totalCoocWeight = this.totalCoocWeight || 1;

    for (const tag of tagSet) {
      if (!this.tagFrequency.has(tag)) continue;

      const pTag = (this.tagFrequency.get(tag) || 1) / Math.max(1, this.totalPosts);
      const coocs = this.tagCooccurrence.get(tag);

      if (!coocs || coocs.size === 0) {
        if (!this.embeddings.has(tag)) {
          this.embeddings.set(tag, this._randomProjection(tag, 0.1));
        }
        continue;
      }

      const vec = new Float32Array(this.dim);
      let norm = 0;

      for (const [coocTag, count] of coocs) {
        const pCooc = (this.tagFrequency.get(coocTag) || 1) / Math.max(1, this.totalPosts);
        const pJoint = count / totalCoocWeight;
        let pmi = Math.log((pJoint + 1e-10) / (pTag * pCooc + 1e-10));
        if (pmi < 0) pmi = 0;

        if (pmi > 0) {
          const proj = this._projection(coocTag);
          for (let i = 0; i < this.dim; i++) {
            vec[i] += pmi * proj[i];
          }
          norm += pmi;
        }
      }

      if (norm > MIN_EMBEDDING_NORM) {
        for (let i = 0; i < this.dim; i++) {
          vec[i] /= norm;
        }
        this.embeddings.set(tag, vec);
      } else if (!this.embeddings.has(tag)) {
        this.embeddings.set(tag, this._randomProjection(tag, 0.1));
      }
    }
  }

  /** Unscaled projection for a tag, cached: it never changes. */
  _projection(tag) {
    let proj = this.projections.get(tag);
    if (!proj) {
      proj = this._randomProjection(tag);
      this.projections.set(tag, proj);
    }
    return proj;
  }

  /**
   * Deterministic sparse random projection for a tag (25% non-zero entries).
   * Seeded by the tag name so the same tag always maps to the same vector.
   */
  _randomProjection(tag, scale = 1) {
    const seed = hashString(tag);
    const rng = mulberry32(seed);
    const vec = new Float32Array(this.dim);
    for (let i = 0; i < this.dim; i++) {
      vec[i] = rng() < 0.25 ? (rng() * 2 - 1) * scale : 0;
    }
    return vec;
  }

  /**
   * Get the embedding vector for a tag.
   * @param {string} tag
   * @returns {Float32Array|null}
   */
  getEmbedding(tag) {
    return this.embeddings.get(tag) || null;
  }

  /**
   * Compute the average embedding for a set of tags, weighted by importance.
   * @param {string[]} tags
   * @param {Map} weights - Optional tag -> weight mapping
   * @returns {Float32Array|null}
   */
  getAverageEmbedding(tags, weights = null) {
    if (!tags || tags.length === 0) return null;

    const result = new Float32Array(this.dim);
    let totalWeight = 0;

    for (const tag of tags) {
      let emb = this.embeddings.get(tag);
      if (!emb) {
        // Generate deterministic fallback embedding for unknown tags
        emb = this._getFallbackEmbedding(tag);
      }

      const w = weights ? (weights.get(tag) || weights[tag] || 1) : 1;
      for (let i = 0; i < this.dim; i++) {
        result[i] += emb[i] * w;
      }
      totalWeight += w;
    }

    if (totalWeight > 0) {
      for (let i = 0; i < this.dim; i++) {
        result[i] /= totalWeight;
      }
      return result;
    }
    return null;
  }

  /**
   * Generate a deterministic fallback embedding for a tag not yet in the PMI model.
   * Uses a seeded RNG so the same tag always gets the same vector.
   * The vector is sparse (25% non-zero) with small magnitude to avoid
   * overwhelming learned PMI embeddings.
   * @param {string} tag
   * @returns {Float32Array}
   */
  _getFallbackEmbedding(tag) {
    return this._randomProjection(tag, 0.1);
  }

  /**
   * Compute a post's content embedding from its tags.
   *
   * Differences from getAverageEmbedding:
   * - Noise tags (highres, solo, ...) are excluded.
   * - Tags are weighted by inverse document frequency so ubiquitous tags
   *   don't drown out specific content tags.
   * - When at least one tag has a learned embedding, unknown tags are
   *   excluded entirely — their random fallback vectors are orthogonal
   *   noise that dilutes the average toward zero similarity.
   * @param {string[]} tags
   * @returns {Float32Array|null}
   */
  getPostEmbedding(tags) {
    if (!tags || tags.length === 0) return null;

    const contentTags = tags.filter(t => t && !this._isNoiseTag(t));
    const pool = contentTags.length > 0 ? contentTags : tags.filter(t => t);
    if (pool.length === 0) return null;

    const known = pool.filter(t => this.embeddings.has(t));
    const useTags = known.length > 0 ? known : pool;

    const result = new Float32Array(this.dim);
    let totalWeight = 0;

    for (const tag of useTags) {
      const emb = this.embeddings.get(tag) || this._getFallbackEmbedding(tag);
      const freq = this.tagFrequency.get(tag) || 0;
      const idf = Math.log(1 + (this.totalPosts + 1) / (1 + freq));
      for (let i = 0; i < this.dim; i++) {
        result[i] += emb[i] * idf;
      }
      totalWeight += idf;
    }

    if (totalWeight <= 0) return null;
    for (let i = 0; i < this.dim; i++) {
      result[i] /= totalWeight;
    }
    return result;
  }

  /**
   * Compute cosine similarity between two tag sets using their average embeddings.
   * @param {string[]} tagsA
   * @param {string[]} tagsB
   * @returns {number} - Similarity in [-1, 1]
   */
  computeSimilarity(tagsA, tagsB) {
    const embA = this.getAverageEmbedding(tagsA);
    const embB = this.getAverageEmbedding(tagsB);
    if (!embA || !embB) return 0;

    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < this.dim; i++) {
      dot += embA[i] * embB[i];
      normA += embA[i] * embA[i];
      normB += embB[i] * embB[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom < 1e-8) return 0;
    return dot / denom;
  }

  /**
   * Find the most similar tags to a given query tag.
   * @param {string} queryTag
   * @param {number} topK
   * @param {Set} excludeSet
   * @returns {Array<{tag: string, similarity: number}>}
   */
  findSimilarTags(queryTag, topK = 10, excludeSet = new Set()) {
    const queryEmb = this.embeddings.get(queryTag);
    if (!queryEmb) return [];

    const similarities = [];
    const queryNorm = Math.sqrt(queryEmb.reduce((s, v) => s + v * v, 0));
    if (queryNorm < 1e-8) return [];

    for (const [tag, emb] of this.embeddings) {
      if (tag === queryTag || excludeSet.has(tag)) continue;

      let dot = 0, targetNorm = 0;
      for (let i = 0; i < this.dim; i++) {
        dot += queryEmb[i] * emb[i];
        targetNorm += emb[i] * emb[i];
      }
      const denom = queryNorm * Math.sqrt(targetNorm);
      if (denom < 1e-8) continue;

      similarities.push({ tag, similarity: dot / denom });
    }

    similarities.sort((a, b) => b.similarity - a.similarity);
    return similarities.slice(0, topK);
  }

  /**
   * Get statistics about the embedding model.
   */
  getStats() {
    return {
      totalTags: this.embeddings.size,
      pendingTags: this.pendingTags.size,
      totalTagsSeen: this.tagFrequency.size,
      totalPostsProcessed: this.totalPosts,
      cooccurrencePairs: Array.from(this.tagCooccurrence.values())
        .reduce((sum, m) => sum + m.size, 0),
      dimension: this.dim,
    };
  }

  _isNoiseTag(tag) {
    // Common noise tags that don't contribute to content understanding
    const noiseTags = new Set([
      '1girl', '1boy', '2girls', '2boys', 'solo', 'comic', 'monochrome',
      'greyscale', 'translated', 'text', 'commentary', 'highres', 'absurdres',
      'looking_at_user', 'looking_at_viewer', 'simple_background',
    ]);
    return noiseTags.has(tag);
  }
}

export { TagEmbedding };
export const tagEmbedding = new TagEmbedding();
export default tagEmbedding;
