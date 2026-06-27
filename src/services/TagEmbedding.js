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

const EMBEDDING_DIM = 32;
const MIN_EMBEDDING_NORM = 0.01;

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
      const post = interaction.metadata?.post;
      if (!post || !post.tag_string) continue;

      const tags = post.tag_string
        .split(' ')
        .filter(t => t && !this._isNoiseTag(t));

      if (tags.length === 0) continue;

      this.totalPosts++;

      // Update frequency
      for (const tag of tags) {
        this.tagFrequency.set(tag, (this.tagFrequency.get(tag) || 0) + 1);
      }

      // Update co-occurrence (only for positive interactions)
      const isPositive =
        (interaction.type === 'like' && interaction.value > 0) ||
        (interaction.type === 'favorite' && interaction.value > 0) ||
        (interaction.type === 'timeSpent' && interaction.value > 5000);

      if (isPositive) {
        for (let i = 0; i < tags.length; i++) {
          for (let j = i + 1; j < tags.length; j++) {
            this._addCooccurrence(tags[i], tags[j]);
            this._addCooccurrence(tags[j], tags[i]);
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
    const post = interaction.metadata?.post;
    if (!post || !post.tag_string) return;

    const tags = post.tag_string
      .split(' ')
      .filter(t => t && !this._isNoiseTag(t));

    if (tags.length === 0) return;

    this.totalPosts++;

    const newTags = new Set();
    for (const tag of tags) {
      if (!this.tagFrequency.has(tag)) {
        newTags.add(tag);
      }
      this.tagFrequency.set(tag, (this.tagFrequency.get(tag) || 0) + 1);
    }

    const isPositive =
      (interaction.type === 'like' && interaction.value > 0) ||
      (interaction.type === 'favorite' && interaction.value > 0) ||
      (interaction.type === 'timeSpent' && interaction.value > 5000);

    if (isPositive) {
      for (let i = 0; i < tags.length; i++) {
        for (let j = i + 1; j < tags.length; j++) {
          this._addCooccurrence(tags[i], tags[j]);
          this._addCooccurrence(tags[j], tags[i]);
        }
      }
    }

    // Mark new tags as pending PMI rebuild
    for (const tag of newTags) {
      this.pendingTags.add(tag);
    }

    // Incrementally update embeddings for affected tags only
    const affectedTags = new Set(tags);
    for (const tag of tags) {
      const coocs = this.tagCooccurrence.get(tag);
      if (coocs) {
        for (const coocTag of coocs.keys()) {
          affectedTags.add(coocTag);
        }
      }
    }
    this._updateEmbeddingsForTags(affectedTags);

    // Trigger full rebuild once we have enough data
    if (this.totalPosts >= this.buildThreshold && this.embeddings.size === 0) {
      this._buildEmbeddings();
    }

    // Rebuild PMI embeddings when there are pending tags (new tags or restored from snapshot)
    if (this.pendingTags.size > 0 && this.tagFrequency.size >= this.buildThreshold) {
      this._buildEmbeddings();
    }
  }

  _addCooccurrence(tagA, tagB) {
    if (!this.tagCooccurrence.has(tagA)) {
      this.tagCooccurrence.set(tagA, new Map());
    }
    const coocs = this.tagCooccurrence.get(tagA);
    coocs.set(tagB, (coocs.get(tagB) || 0) + 1);
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

    // If very few tags, just use random embeddings
    if (n < 10) {
      const rng = mulberry32(42);
      for (const tag of tags) {
        const vec = new Float32Array(this.dim);
        for (let i = 0; i < this.dim; i++) {
          vec[i] = (rng() * 2 - 1) * 0.1;
        }
        this.embeddings.set(tag, vec);
      }
      this.isBuilt = true;
      return;
    }

    // Compute PMI-based embeddings using random projection
    // For each tag t, embedding = Σ_cooc PMI(t, cooc) * random_proj(cooc)
    const rng = mulberry32(12345);

    // Pre-generate random projection vectors for each tag
    const randomProjections = new Map();
    for (const tag of tags) {
      const seed = hashString(tag);
      const tagRng = mulberry32(seed);
      const proj = new Float32Array(this.dim);
      for (let i = 0; i < this.dim; i++) {
        // Sparse random projection: only 25% non-zero entries
        proj[i] = tagRng() < 0.25 ? (tagRng() * 2 - 1) : 0;
      }
      randomProjections.set(tag, proj);
    }

    // Compute total co-occurrence weight for normalization
    let totalCoocWeight = 0;
    for (const [, coocs] of this.tagCooccurrence) {
      for (const count of coocs.values()) {
        totalCoocWeight += count;
      }
    }
    if (totalCoocWeight === 0) totalCoocWeight = 1;

    // Build PMI embeddings
    for (const tag of tags) {
      const pTag = (this.tagFrequency.get(tag) || 1) / this.totalPosts;
      const coocs = this.tagCooccurrence.get(tag);
      if (!coocs || coocs.size === 0) {
        // No co-occurrence data: use random projection of self
        this.embeddings.set(tag, randomProjections.get(tag).slice());
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

        const proj = randomProjections.get(coocTag);
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
        const selfProj = randomProjections.get(tag);
        if (selfProj) {
          for (let i = 0; i < this.dim; i++) {
            vec[i] = selfProj[i] * 0.1;
          }
        }
      }

      this.embeddings.set(tag, vec);
    }

    this.isBuilt = true;
  }

  /**
   * Incrementally update embeddings for a subset of tags.
   */
  _updateEmbeddingsForTags(tagSet) {
    if (tagSet.size === 0) return;

    const rng = mulberry32(12345);
    const allTags = Array.from(this.tagFrequency.keys());

    // Re-generate random projections for affected tags
    for (const tag of tagSet) {
      if (!this.embeddings.has(tag)) {
        const seed = hashString(tag);
        const tagRng = mulberry32(seed);
        const vec = new Float32Array(this.dim);
        for (let i = 0; i < this.dim; i++) {
          vec[i] = tagRng() < 0.25 ? (tagRng() * 2 - 1) : 0;
        }
        this.embeddings.set(tag, vec);
      }
    }

    // Rebuild from co-occurrence for affected tags
    let totalCoocWeight = 0;
    for (const [, coocs] of this.tagCooccurrence) {
      for (const count of coocs.values()) {
        totalCoocWeight += count;
      }
    }
    if (totalCoocWeight === 0) totalCoocWeight = 1;

    for (const tag of tagSet) {
      const pTag = (this.tagFrequency.get(tag) || 1) / Math.max(1, this.totalPosts);
      const coocs = this.tagCooccurrence.get(tag);

      const vec = new Float32Array(this.dim);
      let norm = 0;

      if (coocs && coocs.size > 0) {
        for (const [coocTag, count] of coocs) {
          const pCooc = (this.tagFrequency.get(coocTag) || 1) / Math.max(1, this.totalPosts);
          const pJoint = count / totalCoocWeight;
          let pmi = Math.log((pJoint + 1e-10) / (pTag * pCooc + 1e-10));
          if (pmi < 0) pmi = 0;

          const coocVec = this.embeddings.get(coocTag);
          if (coocVec) {
            for (let i = 0; i < this.dim; i++) {
              vec[i] += pmi * coocVec[i];
            }
            norm += pmi;
          }
        }
      }

      if (norm > MIN_EMBEDDING_NORM) {
        for (let i = 0; i < this.dim; i++) {
          vec[i] /= norm;
        }
      }

      this.embeddings.set(tag, vec);
    }
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
    const seed = hashString(tag);
    const rng = mulberry32(seed);
    const vec = new Float32Array(this.dim);
    for (let i = 0; i < this.dim; i++) {
      vec[i] = rng() < 0.25 ? (rng() * 2 - 1) * 0.1 : 0;
    }
    return vec;
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
