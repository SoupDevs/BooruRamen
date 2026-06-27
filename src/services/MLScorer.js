/**
 * MLScorer.js
 * Lightweight Multi-Layer Perceptron for post engagement prediction.
 *
 * Architecture:
 *   Input (40 features) → Dense(32, ReLU) → Dense(16, ReLU) → Dense(1, Sigmoid)
 *
 * Features per post:
 *   - User top-tag embedding average (32d) — what the user likes
 *   - Post tag embedding average (32d) — what the post contains
 *   - Cosine similarity between user and post embeddings (1d)
 *   - Rating preference score (1d)
 *   - Media type preference (1d)
 *   - Tag overlap ratio (1d)
 *   - Post metadata features (3d): score, media type, file extension
 *
 * Total: 32 + 32 + 1 + 1 + 1 + 1 + 3 = 71 → we use a reduced 40-dim input
 * by projecting embeddings to 16d each via a learned projection matrix.
 *
 * Training: Online SGD with momentum. Model weights stored in IndexedDB.
 * Cold-start: When < TRAIN_THRESHOLD interactions, falls back to heuristic scoring.
 */

import StorageService from '../services/StorageService';
import tagEmbedding from './TagEmbedding';

const INPUT_DIM = 40;
const HIDDEN1 = 32;
const HIDDEN2 = 16;
const OUTPUT_DIM = 1;
const TRAIN_THRESHOLD = 20;      // minimum interactions before ML kicks in
const LEARNING_RATE = 0.01;
const MOMENTUM = 0.9;
const L2_LAMBDA = 0.0001;
const BATCH_SIZE = 16;
const MIN_LOSS = 0.05;           // early stopping threshold

// Interaction type to label mapping (engagement score in [0, 1])
const INTERACTION_LABELS = {
  like: 0.8,
  favorite: 1.0,
  dislike: 0.0,
  view: 0.3,          // base for a quick view
  timeSpent: 0.5,     // will be adjusted by duration
};

class MLScorer {
  constructor() {
    this.weights1 = null;  // [INPUT_DIM][HIDDEN1]
    this.bias1 = null;     // [HIDDEN1]
    this.weights2 = null;  // [HIDDEN1][HIDDEN2]
    this.bias2 = null;     // [HIDDEN2]
    this.weights3 = null;  // [HIDDEN2][OUTPUT_DIM]
    this.bias3 = null;     // [OUTPUT_DIM]

    // Momentum buffers
    this.vW1 = null;
    this.vB1 = null;
    this.vW2 = null;
    this.vB2 = null;
    this.vW3 = null;
    this.vB3 = null;

    // Projection matrices for embeddings (learned during training)
    this.projUser = null;  // [tagDim][16]
    this.projPost = null;  // [tagDim][16]

    // Feature normalization params
    this.featureMeans = null;
    this.featureStds = null;

    // Training state
    this.interactionCount = 0;
    this.isTrained = false;
    this.trainingHistory = [];  // loss history for monitoring
    this.pendingBatch = [];     // accumulate samples for mini-batch

    this._initializeWeights();
  }

  /**
   * Initialize weights with Xavier initialization.
   */
  _initializeWeights() {
    const xavier = (fanIn, fanOut) => {
      const limit = Math.sqrt(6 / (fanIn + fanOut));
      return () => (Math.random() * 2 - 1) * limit;
    };

    const initW = (rows, cols) => {
      const w = [];
      const f = xavier(rows, cols);
      for (let i = 0; i < rows; i++) {
        w[i] = new Float32Array(cols);
        for (let j = 0; j < cols; j++) {
          w[i][j] = f();
        }
      }
      return w;
    };

    const initB = (size) => new Float32Array(size);

    this.weights1 = initW(INPUT_DIM, HIDDEN1);
    this.bias1 = initB(HIDDEN1);
    this.weights2 = initW(HIDDEN1, HIDDEN2);
    this.bias2 = initB(HIDDEN2);
    this.weights3 = initW(HIDDEN2, OUTPUT_DIM);
    this.bias3 = initB(OUTPUT_DIM);

    // Initialize momentum buffers
    this.vW1 = this._zeroLikeW(this.weights1);
    this.vB1 = new Float32Array(HIDDEN1);
    this.vW2 = this._zeroLikeW(this.weights2);
    this.vB2 = new Float32Array(HIDDEN2);
    this.vW3 = this._zeroLikeW(this.weights3);
    this.vB3 = new Float32Array(OUTPUT_DIM);

    // Initialize projection matrices (identity-like for stability)
    const tagDim = tagEmbedding.dim;
    this.projUser = [];
    this.projPost = [];
    for (let i = 0; i < tagDim; i++) {
      this.projUser[i] = new Float32Array(16);
      this.projPost[i] = new Float32Array(16);
      for (let j = 0; j < 16; j++) {
        this.projUser[i][j] = (Math.random() * 2 - 1) * 0.05;
        this.projPost[i][j] = (Math.random() * 2 - 1) * 0.05;
      }
    }

    // Default normalization
    this.featureMeans = new Float32Array(INPUT_DIM);
    this.featureStds = new Float32Array(INPUT_DIM).fill(1);
  }

  _zeroLikeW(w) {
    return w.map(row => new Float32Array(row.length));
  }

  /**
   * Load model from stored snapshot.
   */
  async init() {
    const snapshot = await StorageService.getProfileSnapshot();
    if (snapshot && snapshot.mlModel) {
      this.loadFromSnapshot(snapshot.mlModel);
    }
    this.isTrained = this.interactionCount >= TRAIN_THRESHOLD;
  }

  /**
   * Load model weights from snapshot data.
   */
  loadFromSnapshot(data) {
    if (!data) return;
    this.weights1 = this._deserializeMatrix(data.weights1);
    this.bias1 = this._deserializeVector(data.bias1);
    this.weights2 = this._deserializeMatrix(data.weights2);
    this.bias2 = this._deserializeVector(data.bias2);
    this.weights3 = this._deserializeMatrix(data.weights3);
    this.bias3 = this._deserializeVector(data.bias3);
    this.projUser = this._deserializeMatrix(data.projUser);
    this.projPost = this._deserializeMatrix(data.projPost);
    this.featureMeans = this._deserializeVector(data.featureMeans);
    this.featureStds = this._deserializeVector(data.featureStds);
    this.interactionCount = data.interactionCount || 0;
    this.trainingHistory = data.trainingHistory || [];
  }

  _deserializeMatrix(data) {
    if (!data) return null;
    return data.map(row => new Float32Array(row));
  }

  _deserializeVector(data) {
    if (!data) return null;
    return new Float32Array(data);
  }

  /**
   * Serialize model for storage.
   */
  toSnapshot() {
    return {
      weights1: this._serializeMatrix(this.weights1),
      bias1: this._serializeVector(this.bias1),
      weights2: this._serializeMatrix(this.weights2),
      bias2: this._serializeVector(this.bias2),
      weights3: this._serializeMatrix(this.weights3),
      bias3: this._serializeVector(this.bias3),
      projUser: this._serializeMatrix(this.projUser),
      projPost: this._serializeMatrix(this.projPost),
      featureMeans: this._serializeVector(this.featureMeans),
      featureStds: this._serializeVector(this.featureStds),
      interactionCount: this.interactionCount,
      trainingHistory: this.trainingHistory.slice(-50),  // keep last 50
    };
  }

  _serializeMatrix(m) {
    if (!m) return null;
    return m.map(row => Array.from(row));
  }

  _serializeVector(v) {
    if (!v) return null;
    return Array.from(v);
  }

  /**
   * Extract feature vector from a post given the user's tag preferences.
   * @param {Object} post - Post object with tag_string
   * @param {Map} userTagScores - User's tag affinity scores
   * @param {Object} userProfile - { ratingPreferences, mediaTypePreferences }
   * @returns {Float32Array} - 40-dim feature vector
   */
  extractFeatures(post, userTagScores, userProfile) {
    const features = new Float32Array(INPUT_DIM);
    const tagDim = tagEmbedding.dim;

    // Normalize userTagScores to an entries array (handles both Map and plain objects)
    let userEntries = [];
    if (userTagScores) {
      if (userTagScores instanceof Map) {
        userEntries = Array.from(userTagScores.entries());
      } else if (typeof userTagScores === 'object') {
        userEntries = Object.entries(userTagScores);
      }
    }

    // Get user interest embedding (projected to 16d)
    const userTags = userEntries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag]) => tag);

    // Convert to Map for getAverageEmbedding if needed
    const userTagWeights = userTagScores instanceof Map
      ? userTagScores
      : new Map(userEntries);
    const userEmb = tagEmbedding.getAverageEmbedding(userTags, userTagWeights);
    const userProj = new Float32Array(16);
    if (userEmb) {
      for (let i = 0; i < 16; i++) {
        let sum = 0;
        for (let j = 0; j < tagDim; j++) {
          sum += userEmb[j] * this.projUser[j][i];
        }
        userProj[i] = sum;
      }
    }
    for (let i = 0; i < 16; i++) features[i] = userProj[i];

    // Get post tag embedding (projected to 16d)
    const postTags = (post.tag_string || '').split(' ').filter(t => t);
    const postEmb = tagEmbedding.getAverageEmbedding(postTags);
    const postProj = new Float32Array(16);
    if (postEmb) {
      for (let i = 0; i < 16; i++) {
        let sum = 0;
        for (let j = 0; j < tagDim; j++) {
          sum += postEmb[j] * this.projPost[j][i];
        }
        postProj[i] = sum;
      }
    }
    for (let i = 0; i < 16; i++) features[16 + i] = postProj[i];

    // Cosine similarity between user and post embeddings
    let dot = 0, normU = 0, normP = 0;
    for (let i = 0; i < 16; i++) {
      dot += userProj[i] * postProj[i];
      normU += userProj[i] * userProj[i];
      normP += postProj[i] * postProj[i];
    }
    features[32] = (Math.sqrt(normU) * Math.sqrt(normP) > 0)
      ? dot / (Math.sqrt(normU) * Math.sqrt(normP))
      : 0;

    // Rating preference
    const rating = post.rating || 'g';
    features[33] = (userProfile?.ratingPreferences?.[rating] || 0);

    // Media type preference
    const isVideo = ['mp4', 'webm'].includes(post.file_ext);
    features[34] = isVideo
      ? (userProfile?.mediaTypePreferences?.video || 0)
      : (userProfile?.mediaTypePreferences?.image || 0);

    // Tag overlap ratio
    if (userTags.length > 0 && postTags.length > 0) {
      const userTagSet = new Set(userTags);
      let overlap = 0;
      for (const tag of postTags) {
        if (userTagSet.has(tag)) overlap++;
      }
      features[35] = overlap / postTags.length;
    } else {
      features[35] = 0;
    }

    // Post metadata features
    features[36] = Math.min(1, (post.score || 0) / 100);  // normalized post score
    features[37] = isVideo ? 1 : 0;                        // is video
    features[38] = Math.min(1, ((post.width || 0) * (post.height || 0)) / (1920 * 1080));  // resolution
    features[39] = post.tag_string ? Math.min(1, post.tag_string.split(' ').length / 50) : 0;  // tag count

    return features;
  }

  /**
   * Forward pass through the MLP.
   * @param {Float32Array} features - Input feature vector
   * @returns {number} - Predicted engagement probability [0, 1]
   */
  forward(features) {
    // Layer 1: input -> hidden1 (ReLU)
    const h1 = new Float32Array(HIDDEN1);
    for (let j = 0; j < HIDDEN1; j++) {
      let sum = this.bias1[j];
      for (let i = 0; i < INPUT_DIM; i++) {
        sum += features[i] * this.weights1[i][j];
      }
      h1[j] = Math.max(0, sum);  // ReLU
    }

    // Layer 2: hidden1 -> hidden2 (ReLU)
    const h2 = new Float32Array(HIDDEN2);
    for (let j = 0; j < HIDDEN2; j++) {
      let sum = this.bias2[j];
      for (let i = 0; i < HIDDEN1; i++) {
        sum += h1[i] * this.weights2[i][j];
      }
      h2[j] = Math.max(0, sum);  // ReLU
    }

    // Layer 3: hidden2 -> output (Sigmoid)
    let output = this.bias3[0];
    for (let i = 0; i < HIDDEN2; i++) {
      output += h2[i] * this.weights3[i][0];
    }
    return 1 / (1 + Math.exp(-output));  // Sigmoid
  }

  /**
   * Score a single post using the ML model.
   * @param {Object} post
   * @param {Map} userTagScores
   * @param {Object} userProfile
   * @returns {number} - Engagement score [0, 1]
   */
  scorePost(post, userTagScores, userProfile) {
    if (this.interactionCount < TRAIN_THRESHOLD) {
      return -1;  // Signal to use heuristic fallback
    }

    const features = this.extractFeatures(post, userTagScores, userProfile);
    return this.forward(features);
  }

  /**
   * Score multiple posts. Returns array of scores.
   */
  scorePosts(posts, userTagScores, userProfile) {
    if (this.interactionCount < TRAIN_THRESHOLD) {
      return posts.map(() => -1);
    }

    const scores = [];
    for (const post of posts) {
      const features = this.extractFeatures(post, userTagScores, userProfile);
      scores.push(this.forward(features));
    }
    return scores;
  }

  /**
   * Add a training sample and perform online learning.
   * @param {Object} post - The post that was interacted with
   * @param {string} interactionType
   * @param {number} value
   * @param {Map} userTagScores
   * @param {Object} userProfile
   */
  addTrainingSample(post, interactionType, value, userTagScores, userProfile) {
    // Compute label
    let label = INTERACTION_LABELS[interactionType];
    if (interactionType === 'timeSpent') {
      // Normalize time spent: 0-30s maps to 0.3-0.9
      label = Math.min(0.9, 0.3 + (value / 30000) * 0.6);
    }
    if (label === undefined) return;

    const features = this.extractFeatures(post, userTagScores, userProfile);
    this.pendingBatch.push({ features, label });
    this.interactionCount++;

    // Train when batch is full
    if (this.pendingBatch.length >= BATCH_SIZE) {
      this._trainBatch();
    }

    // Mark as trained once we have enough data
    if (this.interactionCount >= TRAIN_THRESHOLD) {
      this.isTrained = true;
    }
  }

  /**
   * Train on the pending mini-batch using SGD with momentum.
   */
  _trainBatch() {
    if (this.pendingBatch.length === 0) return;

    // Accumulate gradients
    const gW1 = this._zeroLikeW(this.weights1);
    const gB1 = new Float32Array(HIDDEN1);
    const gW2 = this._zeroLikeW(this.weights2);
    const gB2 = new Float32Array(HIDDEN2);
    const gW3 = this._zeroLikeW(this.weights3);
    const gB3 = new Float32Array(OUTPUT_DIM);

    let totalLoss = 0;

    for (const { features, label } of this.pendingBatch) {
      // Forward pass (cache activations)
      const h1 = new Float32Array(HIDDEN1);
      for (let j = 0; j < HIDDEN1; j++) {
        let sum = this.bias1[j];
        for (let i = 0; i < INPUT_DIM; i++) {
          sum += features[i] * this.weights1[i][j];
        }
        h1[j] = Math.max(0, sum);
      }

      const h2 = new Float32Array(HIDDEN2);
      for (let j = 0; j < HIDDEN2; j++) {
        let sum = this.bias2[j];
        for (let i = 0; i < HIDDEN1; i++) {
          sum += h1[i] * this.weights2[i][j];
        }
        h2[j] = Math.max(0, sum);
      }

      let output = this.bias3[0];
      for (let i = 0; i < HIDDEN2; i++) {
        output += h2[i] * this.weights3[i][0];
      }
      const prediction = 1 / (1 + Math.exp(-output));

      // Binary cross-entropy loss
      const eps = 1e-7;
      const loss = -(label * Math.log(prediction + eps) + (1 - label) * Math.log(1 - prediction + eps));
      totalLoss += loss;

      // Backward pass
      const dOutput = prediction - label;  // derivative of BCE with sigmoid

      // Gradients for layer 3
      for (let i = 0; i < HIDDEN2; i++) {
        gW3[i][0] += dOutput * h2[i];
      }
      gB3[0] += dOutput;

      // Backprop to hidden2
      const dH2 = new Float32Array(HIDDEN2);
      for (let i = 0; i < HIDDEN2; i++) {
        dH2[i] = dOutput * this.weights3[i][0];
        if (h2[i] <= 0) dH2[i] = 0;  // ReLU derivative
      }

      // Gradients for layer 2
      for (let j = 0; j < HIDDEN2; j++) {
        for (let i = 0; i < HIDDEN1; i++) {
          gW2[i][j] += dH2[j] * h1[i];
        }
        gB2[j] += dH2[j];
      }

      // Backprop to hidden1
      const dH1 = new Float32Array(HIDDEN1);
      for (let i = 0; i < HIDDEN1; i++) {
        let sum = 0;
        for (let j = 0; j < HIDDEN2; j++) {
          sum += dH2[j] * this.weights2[i][j];
        }
        dH1[i] = h1[i] <= 0 ? 0 : sum;  // ReLU derivative
      }

      // Gradients for layer 1
      for (let j = 0; j < HIDDEN1; j++) {
        for (let i = 0; i < INPUT_DIM; i++) {
          gW1[i][j] += dH1[j] * features[i];
        }
        gB1[j] += dH1[j];
      }
    }

    // Average gradients and apply SGD with momentum
    const batchSize = this.pendingBatch.length;
    const lr = LEARNING_RATE / batchSize;

    for (let i = 0; i < INPUT_DIM; i++) {
      for (let j = 0; j < HIDDEN1; j++) {
        const grad = gW1[i][j] / batchSize + L2_LAMBDA * this.weights1[i][j];
        this.vW1[i][j] = MOMENTUM * this.vW1[i][j] - lr * grad;
        this.weights1[i][j] += this.vW1[i][j];
      }
    }
    for (let j = 0; j < HIDDEN1; j++) {
      const grad = gB1[j] / batchSize;
      this.vB1[j] = MOMENTUM * this.vB1[j] - lr * grad;
      this.bias1[j] += this.vB1[j];
    }

    for (let i = 0; i < HIDDEN1; i++) {
      for (let j = 0; j < HIDDEN2; j++) {
        const grad = gW2[i][j] / batchSize + L2_LAMBDA * this.weights2[i][j];
        this.vW2[i][j] = MOMENTUM * this.vW2[i][j] - lr * grad;
        this.weights2[i][j] += this.vW2[i][j];
      }
    }
    for (let j = 0; j < HIDDEN2; j++) {
      const grad = gB2[j] / batchSize;
      this.vB2[j] = MOMENTUM * this.vB2[j] - lr * grad;
      this.bias2[j] += this.vB2[j];
    }

    for (let i = 0; i < HIDDEN2; i++) {
      const grad = gW3[i][0] / batchSize + L2_LAMBDA * this.weights3[i][0];
      this.vW3[i][0] = MOMENTUM * this.vW3[i][0] - lr * grad;
      this.weights3[i][0] += this.vW3[i][0];
    }
    {
      const grad = gB3[0] / batchSize;
      this.vB3[0] = MOMENTUM * this.vB3[0] - lr * grad;
      this.bias3[0] += this.vB3[0];
    }

    // Record loss
    const avgLoss = totalLoss / batchSize;
    this.trainingHistory.push(avgLoss);
    if (this.trainingHistory.length > 50) {
      this.trainingHistory.shift();
    }

    // Clear batch
    this.pendingBatch = [];
  }

  /**
   * Force training on any remaining samples in the pending batch.
   */
  flushTraining() {
    if (this.pendingBatch.length > 0) {
      this._trainBatch();
    }
  }

  /**
   * Reset the model to untrained state.
   */
  reset() {
    this._initializeWeights();
    this.interactionCount = 0;
    this.isTrained = false;
    this.trainingHistory = [];
    this.pendingBatch = [];
  }

  /**
   * Get model statistics.
   */
  getStats() {
    return {
      isTrained: this.isTrained,
      interactionCount: this.interactionCount,
      pendingSamples: this.pendingBatch.length,
      lastLoss: this.trainingHistory.length > 0
        ? this.trainingHistory[this.trainingHistory.length - 1]
        : null,
      avgLoss: this.trainingHistory.length > 0
        ? this.trainingHistory.reduce((a, b) => a + b, 0) / this.trainingHistory.length
        : null,
      modelSize: this._estimateModelSize(),
    };
  }

  _estimateModelSize() {
    // Rough estimate in bytes
    return (
      INPUT_DIM * HIDDEN1 * 4 +  // weights1
      HIDDEN1 * 4 +              // bias1
      HIDDEN1 * HIDDEN2 * 4 +    // weights2
      HIDDEN2 * 4 +              // bias2
      HIDDEN2 * OUTPUT_DIM * 4 + // weights3
      OUTPUT_DIM * 4 +           // bias3
      tagEmbedding.dim * 16 * 8  // projection matrices (2x)
    );
  }

  /**
   * Get per-tag contribution to the ML score for a post.
   * Measures how much each post tag shifts the score away from baseline.
   */
  getTagContributions(post, userTagScores, userProfile) {
    if (!this.isTrained) return [];

    const baseline = this.scorePost(post, userTagScores, userProfile);
    if (baseline < 0) return [];

    const postTags = (post.tag_string || '').split(' ').filter(t => t);
    const contributions = [];

    for (const tag of postTags) {
      // Create a copy of the post without this tag
      const postWithoutTag = { ...post, tag_string: postTags.filter(t => t !== tag).join(' ') };
      const scoreWithout = this.scorePost(postWithoutTag, userTagScores, userProfile);
      const delta = baseline - scoreWithout;
      contributions.push({ tag, delta: Math.abs(delta), direction: delta > 0 ? 'positive' : 'negative' });
    }

    contributions.sort((a, b) => b.delta - a.delta);
    return contributions.slice(0, 10);
  }

  /**
   * Get the key ML features for a post with their values.
   */
  getFeatureValues(post, userTagScores, userProfile) {
    const features = this.extractFeatures(post, userTagScores, userProfile);
    const userEntries = userTagScores
      ? (userTagScores instanceof Map
        ? Array.from(userTagScores.entries())
        : Object.entries(userTagScores))
      : [];
    const userTags = userEntries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag]) => tag);
    const userEmb = tagEmbedding.getAverageEmbedding(userTags);
    const postTags = (post.tag_string || '').split(' ').filter(t => t);
    const postEmb = tagEmbedding.getAverageEmbedding(postTags);

    // Compute cosine similarity
    let dot = 0, normU = 0, normP = 0;
    if (userEmb && postEmb) {
      for (let i = 0; i < tagEmbedding.dim; i++) {
        dot += userEmb[i] * postEmb[i];
        normU += userEmb[i] * userEmb[i];
        normP += postEmb[i] * postEmb[i];
      }
    }
    const similarity = (Math.sqrt(normU) * Math.sqrt(normP) > 0)
      ? dot / (Math.sqrt(normU) * Math.sqrt(normP))
      : 0;

    // Tag overlap
    let overlap = 0;
    if (userTagScores && postTags.length > 0) {
      const userTagKeys = userTagScores instanceof Map
        ? Array.from(userTagScores.keys())
        : Object.keys(userTagScores);
      const userTagSet = new Set(userTagKeys);
      for (const tag of postTags) {
        if (userTagSet.has(tag)) overlap++;
      }
    }
    const overlapRatio = postTags.length > 0 ? overlap / postTags.length : 0;

    return {
      embeddingSimilarity: similarity,
      tagOverlapRatio: overlapRatio,
      userEmbeddingStrength: Math.sqrt(normU),
      postEmbeddingStrength: Math.sqrt(normP),
      ratingPreference: features[33] || 0,
      mediaTypePreference: features[34] || 0,
      postScore: features[36] || 0,
      isVideo: post.file_ext ? ['mp4', 'webm'].includes(post.file_ext) : false,
      tagCount: postTags.length,
    };
  }
}

export { MLScorer };
export const mlScorer = new MLScorer();
export default mlScorer;
