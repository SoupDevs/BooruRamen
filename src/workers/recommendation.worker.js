import StorageService from '../services/StorageService';
import { TagEmbedding } from '../services/TagEmbedding';
import { MLScorer } from '../services/MLScorer';
import { BanditExplorer } from '../services/BanditExplorer';

// Constants for recommendation system

const TAG_CATEGORIES = ['artist', 'copyright', 'character', 'general', 'meta'];

// Heuristic scoring constants (fallback when ML is not trained)

export const COMMON_TAGS = [
  '1girl', '1boy', '2girls', '2boys', 'solo', 'comic', 'monochrome',
  'greyscale', 'unknown_artist', 'text', 'commentary', 'translated',
  'multiple_girls', 'multiple_boys', 'scenery', 'original', 'highres',
  'absurdres', 'check_commentary', 'photo', 'parody',
  'long_hair', 'breasts', 'large_breasts', 'looking_at_user', 'short_hair',
  'animated', 'tagme', 'copyright_request', 'spoiler', 'source_request',
  'artist_request', 'character_request', 'cosplay_request', 'check_character',
  'duplicate', 'sound', 'looking_at_viewer', 'looking_at_another',
  'simple_background'
];

class RecommendationWorkerCore {
  constructor() {
    this.userEmbedding = null;
    this.avoidedTags = [...COMMON_TAGS];
    this.lastUpdateTime = 0;
    this.postScoreCache = new Map();
    this.strategyCursors = {};
    this.exhaustedStrategies = new Set();

    // ML components
    this.mlInitialized = false;
  }

  async initialize() {
    this.strategyCursors = {};
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.strategyCursors = {};
      this.exhaustedStrategies = new Set();

      // Initialize ML components
      await this._initializeML();

      await this.updateUserProfile();

      if (this.updateInterval) clearInterval(this.updateInterval);
      this.updateInterval = setInterval(() => this.updateUserProfile(), 5 * 60 * 1000);
    })();

    return this.initPromise;
  }

  /**
   * Initialize ML components (tag embeddings, scorer, bandit).
   */
  async _initializeML() {
    if (this.mlInitialized) return;

    try {
      this.tagEmbedding = new TagEmbedding();
      this.mlScorer = new MLScorer();
      this.banditExplorer = new BanditExplorer();

      await this.tagEmbedding.init();
      await this.mlScorer.init();
      await this.banditExplorer.init(
        (await StorageService.getProfileSnapshot())?.banditState
      );
      this.mlInitialized = true;
      console.log('[ML] Components initialized successfully');
    } catch (e) {
      console.error('[ML] Failed to initialize ML components:', e);
      // Non-fatal: system falls back to heuristics
      this.mlInitialized = false;
    }
  }

  resetExploreSession() {
    this.strategyCursors = {};
    this.exhaustedStrategies = new Set();
    this.banditExplorer.endSession();
  }


  async updateUserProfile() {
    const preferences = await StorageService.getPreferences();
    if (preferences.avoidedTags && Array.isArray(preferences.avoidedTags)) {
      this.avoidedTags = preferences.avoidedTags;
    } else {
      this.avoidedTags = [...COMMON_TAGS];
    }

    const resetTimestamp = preferences.recommendationResetTime || 0;
    const now = Date.now();
    let interactions = [];
    let isIncremental = false;

    const snapshot = await StorageService.getProfileSnapshot();

    if (snapshot && (!resetTimestamp || snapshot.timestamp > resetTimestamp)) {
      this.lastUpdateTime = snapshot.timestamp || 0;

      const hoursSinceSnapshot = (now - this.lastUpdateTime) / (1000 * 60 * 60);

      interactions = await StorageService.getRecentInteractions(this.lastUpdateTime);
      isIncremental = true;
    } else {
      interactions = await StorageService.getInteractions();
      if (resetTimestamp > 0) {
        interactions = interactions.filter(i => i.timestamp > resetTimestamp);
      }
    }

    if (interactions.length === 0 && !isIncremental) {
      return;
    }

    // Process interactions for both heuristic profile and ML
    interactions.forEach(interaction => {
      const ageInHours = (now - interaction.timestamp) / (1000 * 60 * 60);
      const recencyWeight = Math.exp(-0.05 * ageInHours);
      weight *= recencyWeight;

      if (interaction.type === 'timeSpent') {
        weight *= (interaction.value / 1000);
      }

      if (interaction.metadata && interaction.metadata.post) {

        // Feed interaction to ML components
        if (this.mlInitialized) {
          this.tagEmbedding.addInteraction(interaction);

          // Compute label for ML training
          let label = 0.5;
          if (interaction.type === 'like' && interaction.value > 0) label = 0.8;
          else if (interaction.type === 'favorite' && interaction.value > 0) label = 1.0;
          else if (interaction.type === 'dislike') label = 0.0;
          else if (interaction.type === 'timeSpent') {
            label = Math.min(0.9, 0.3 + (interaction.value / 30000) * 0.6);
          }

          this.mlScorer.addTrainingSample(
            interaction.metadata.post,
            interaction.type,
            interaction.value,
            null,
            null
          );

          // Record reward for bandit ONLY when the post was fetched via a strategy
          // (explore mode). This ensures the bandit learns which query strategies
          // produce engaging content.
          const strategy = interaction.metadata.post._strategy;
          if (strategy) {
            this.banditExplorer.recordReward(strategy, label);
          }
        }
      }
    });

    // Flush any remaining training samples
    if (this.mlInitialized) {
      this.mlScorer.flushTraining();
    }

    this.lastUpdateTime = now;
    await this._saveProfileSnapshot();
  }

  /**
   * Save the current profile state including ML model and bandit state.
   */
  async _saveProfileSnapshot() {
    const snapshot = {
      timestamp: this.lastUpdateTime,
    };

    // Save ML model state
    if (this.mlInitialized) {
      snapshot.tagEmbeddings = tagEmbedding.toSnapshot();
      snapshot.mlModel = this.mlScorer.toSnapshot();
      snapshot.banditState = this.banditExplorer.toSnapshot();
    }

    await StorageService.storeProfileSnapshot(snapshot);
  }




  async resetRecommendations() {
    const resetTime = Date.now();
    await StorageService.storePreferences({ recommendationResetTime: resetTime });

    const preferences = await StorageService.getPreferences();
    if (preferences.avoidedTags && Array.isArray(preferences.avoidedTags)) {
      this.avoidedTags = preferences.avoidedTags;
    } else {
      this.avoidedTags = [...COMMON_TAGS];
    }

    this.postScoreCache.clear();
    this.resetExploreSession();

    // Reset ML components
    if (this.mlInitialized) {
      this.mlScorer.reset();
      this.banditExplorer.reset();
    }

    await StorageService.storeProfileSnapshot({
      timestamp: resetTime,
    });
  }

  async trackInteraction(postId, interactionType, value, postData, updateImmediately = false) {
    await StorageService.storeInteraction({
      postId,
      type: interactionType,
      value,
      metadata: { post: postData }
    });

    this.postScoreCache.delete(postId);

    if (updateImmediately) {
      await this.updateUserProfile();
    }
  }

  /**
   * Score a post using ML model if trained, otherwise fall back to heuristic.
   * @param {Object} post
   * @returns {number} - Score (engagement probability or heuristic score)
   */
  scorePost(post) {
    if (this.postScoreCache.has(post.id)) {
      return this.postScoreCache.get(post.id);
    }

    let score;

    // Use ML scorer if trained
    if (this.mlScorer.isTrained) {
      score = this.mlScorer.scorePost(
        post,
        null,
        null
      );

      // If ML returns valid score
      if (score >= 0) {
        // Add small random noise for tiebreaking (preserves some diversity)
        score += Math.random() * 0.05;

        this.postScoreCache.set(post.id, score);
        return score;
      }
    }

    // Cold start: no ML model yet, use post's community score as default
    score = post.score || 0;
    this.postScoreCache.set(post.id, score);
    return score;
  }

  scorePosts(posts) {
    return posts.map(post => ({ post, score: this.scorePost(post) }));
  }

  getPostScoreDetails(post) {
    const details = {
      totalScore: 0, ratingScore: 0, mediaScore: 0,
      tagScore: 0, strategyBonus: 0, strategy: post._strategy || 'none',
      contributingTags: [], mlScore: null, mlConfidence: 0
    };

    // Get the actual score used for ranking
    details.totalScore = this.scorePost(post);

    // ML score breakdown
    if (this.mlScorer && this.mlScorer.isTrained) {
      const mlScore = this.mlScorer.scorePost(post, null, null);
      if (mlScore >= 0) {
        details.mlScore = mlScore;
        details.mlConfidence = Math.min(1, this.mlScorer.interactionCount / 50);
      }
    }

    // Strategy bonus applied during ranking (from rankPosts)
    if (post._strategy) {
      switch (post._strategy) {
        case 'pivot': details.strategyBonus = 0.3; break;
        case 'reach': details.strategyBonus = 0.5; break;
        case 'wildcard': details.strategyBonus = 0.4; break;
        case 'duo': details.strategyBonus = 0.5; break;
      }
    }

    // Contributing tags: compute user-tag affinity via embedding similarity
    const postTags = (post.tag_string || '').split(' ').filter(Boolean);
    const contributors = [];

    // Build user interest embedding from historically engaged tags
    if (this.mlInitialized && tagEmbedding && tagEmbedding.tagFrequency.size > 0) {
      const topTags = Array.from(tagEmbedding.tagFrequency.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([tag]) => tag);
      this.userEmbedding = tagEmbedding.getAverageEmbedding(topTags);
    }
    const userEmb = this.userEmbedding;

    for (const tag of postTags.slice(0, 15)) {
      const tagEmb = tagEmbedding.getEmbedding(tag);
      if (tagEmb && userEmb) {
        let dot = 0, normU = 0, normT = 0;
        for (let i = 0; i < tagEmb.length; i++) {
          dot += userEmb[i] * tagEmb[i];
          normU += userEmb[i] * userEmb[i];
          normT += tagEmb[i] * tagEmb[i];
        }
        const denom = Math.sqrt(normU) * Math.sqrt(normT);
        const score = denom > 1e-8 ? dot / denom : 0;
        if (score > 0) {
          contributors.push({ tag, score, category: 'similarity' });
        }
      }
    }
    contributors.sort((a, b) => b.score - a.score);
    details.contributingTags = contributors.slice(0, 10);

    return details;
  }

  rankPosts(posts) {
    if (!posts || posts.length === 0) return [];
    const scoredPosts = posts.map(post => {
      let score = this.scorePost(post);
      switch (post._strategy) {
        case 'pivot': score += 0.3; break;
        case 'reach': score += 0.5; break;
        case 'wildcard': score += 0.4; break;
        case 'duo': score += 0.5; break;
      }
      return { post, score };
    });
    scoredPosts.sort((a, b) => b.score - a.score);
    return scoredPosts.map(sp => sp.post);
  }

  summarizeTagScores(limit = 10) {
    // Return top tags by embedding norm (strength of learned representation)
    if (!this.mlInitialized) return {};
    const tagScores = [];
    for (const [tag, emb] of tagEmbedding.embeddings) {
      const norm = Math.sqrt(emb.reduce((s, v) => s + v * v, 0));
      tagScores.push({ tag, score: norm });
    }
    tagScores.sort((a, b) => b.score - a.score);
    return Object.fromEntries(tagScores.slice(0, limit).map(t => [t.tag, t.score]));
  }

  getRecommendedTags(limit = 5) {
    // Return tags with strongest embedding representations
    if (!this.mlInitialized) return [];
    const tagScores = [];
    for (const [tag, emb] of tagEmbedding.embeddings) {
      const norm = Math.sqrt(emb.reduce((s, v) => s + v * v, 0));
      tagScores.push({ tag, score: norm });
    }
    tagScores.sort((a, b) => b.score - a.score);
    return tagScores.slice(0, limit).map(t => t.tag);
  }

  getRecommendedRatings() {
    // Simplified — return general as default
    return ['general'];
  }

  buildRecommendedQueryParams(includeUserTags = true, exploreMode = false) {
    let tags = [];
    if (includeUserTags && this.mlInitialized) {
      const recommendedTags = this.getRecommendedTags(1);
      if (recommendedTags.length > 0) tags.push(recommendedTags[0]);
    }
    if (exploreMode && tags.length < 2) {
      const saferStrategies = ['age:<1d', 'age:<3d', 'age:<1w', 'order:rank', 'order:favcount'];
      tags.push(saferStrategies[Math.floor(Math.random() * saferStrategies.length)]);
    }
    return { tags: tags.join(' ') };
  }

  getQueryableTags() {
    return this.getQueryableTagsWithScores().map(item => item.tag);
  }

  getQueryableTagsWithScores() {
    if (!this.mlInitialized) return [];
    // Use tag embedding norms as query weights
    const tagScores = [];
    for (const [tag, emb] of tagEmbedding.embeddings) {
      if (this.avoidedTags.includes(tag)) continue;
      const norm = Math.sqrt(emb.reduce((s, v) => s + v * v, 0));
      tagScores.push({ tag, score: norm });
    }
    return tagScores.sort((a, b) => b.score - a.score);
  }

  /**
   * Generate multi-strategy queries using Thompson Sampling for strategy selection.
   * The bandit optimizes which strategies to use based on past performance.
   */
  generateMultiStrategyQueries(selectedRatings = ['general'], whitelist = []) {
    const queries = [];
    let topTagsWithScores = this.getQueryableTagsWithScores();

    if (topTagsWithScores.length === 0 && whitelist && whitelist.length > 0) {
      topTagsWithScores = whitelist.slice(0, 10).map((tag, index) => ({
        tag, score: 1.0 - (index * 0.05)
      }));
    }
    topTagsWithScores = topTagsWithScores.filter(t => t.tag !== 'video');
    const tier1Pool = topTagsWithScores.slice(0, 10);
    const tier2Pool = topTagsWithScores.slice(10, 25);
    const usedTags = new Set();

    // Use Thompson Sampling to select strategies
    const banditSelections = this.banditExplorer.selectTopK(5);
    const selectedStrategies = new Set(banditSelections.map(s => s.type));

    // Anchor strategy (always include if we have tags)
    const anchorTag = this.weightedRandomSelect(tier1Pool, usedTags);
    if (anchorTag && !this.exhaustedStrategies.has(anchorTag.tag)) {
      queries.push({ tags: anchorTag.tag, type: 'anchor', intent: 'Core interest - highest affinity content' });
      usedTags.add(anchorTag.tag);
    }

    // Pivot strategy (use bandit-selected strategy if available)
    const pivotModifiers = ['age:>3mo', 'age:>1y', 'order:rank age:<1mo', 'order:favcount age:<1mo'];
    for (let i = 0; i < 2; i++) {
      const pivotTag = this.weightedRandomSelect(tier1Pool, usedTags);
      if (pivotTag) {
        const modifier = pivotModifiers[Math.floor(Math.random() * pivotModifiers.length)];
        const pivotQuery = `${pivotTag.tag} ${modifier}`;
        if (!this.exhaustedStrategies.has(pivotQuery)) {
          queries.push({ tags: pivotQuery, type: 'pivot', intent: `Core interest "${pivotTag.tag}" + modifier` });
          usedTags.add(pivotTag.tag);
        }
      }
    }

    // Reach strategy
    if (tier2Pool.length > 0) {
      const reachTag = this.weightedRandomSelect(tier2Pool, usedTags);
      if (reachTag && !this.exhaustedStrategies.has(reachTag.tag)) {
        queries.push({ tags: reachTag.tag, type: 'reach', intent: 'Secondary interest - expanding horizons' });
        usedTags.add(reachTag.tag);
      }
    }

    // Wildcard strategy
    const wildcardOptions = ['order:rank age:<1mo', 'order:popular age:<1mo'];
    const wildcardQuery = wildcardOptions[Math.floor(Math.random() * wildcardOptions.length)];
    if (!this.exhaustedStrategies.has(wildcardQuery)) {
      queries.push({ tags: wildcardQuery, type: 'wildcard', intent: 'Global discovery - trending content' });
    }

    // Fallback if no queries generated
    if (queries.length === 0) {
      const fallbacks = ['order:rank age:<1mo', 'order:popular age:<1mo', 'age:<1w'];
      for (const fb of fallbacks) {
        if (!this.exhaustedStrategies.has(fb)) {
          queries.push({ tags: fb, type: 'fallback', intent: 'Emergency fallback' });
          break;
        }
      }
    }

    return queries.filter((query, index, self) => self.findIndex(q => q.tags === query.tags) === index);
  }

  weightedRandomSelect(candidates, exclude = new Set()) {
    const available = candidates.filter(c => !exclude.has(c.tag) && !this.exhaustedStrategies.has(c.tag));
    if (available.length === 0) return null;
    const totalWeight = available.reduce((sum, c) => sum + Math.max(0.01, c.score), 0);
    let random = Math.random() * totalWeight;
    for (const candidate of available) {
      random -= Math.max(0.01, candidate.score);
      if (random <= 0) return candidate;
    }
    return available[available.length - 1];
  }

  selectNextBestPost(postPool) {
    if (!postPool || postPool.length === 0) return { nextPost: null, remainingPosts: [] };
    const scoredPosts = postPool.map(post => ({ post, score: this.scorePost(post) }));
    scoredPosts.sort((a, b) => b.score - a.score);
    const [best, ...rest] = scoredPosts;
    return { nextPost: best.post, remainingPosts: rest.map(item => item.post) };
  }

  updateExhausted(tag) {
    this.exhaustedStrategies.add(tag);
  }

  /**
   * Get comprehensive stats including ML components.
   */
  getMLStats() {
    return {
      tagEmbeddings: this.tagEmbedding.getStats(),
      mlScorer: this.mlScorer.getStats(),
      bandit: this.banditExplorer.getStats(),
    };
  }
}

const core = new RecommendationWorkerCore();

// Handle incoming messages
self.onmessage = async (e) => {
  const { id, type, payload } = e.data;

  try {
    let result;
    switch (type) {
      case 'initialize':
        await core.initialize();
        result = true;
        break;
      case 'resetExploreSession':
        core.resetExploreSession();
        result = true;
        break;
      case 'updateUserProfile':
        await core.updateUserProfile();
        result = true;
        break;
      case 'resetRecommendations':
        await core.resetRecommendations();
        result = true;
        break;
      case 'trackInteraction':
        await core.trackInteraction(payload.postId, payload.interactionType, payload.value, payload.postData, payload.updateImmediately);
        result = true;
        break;
      case 'scorePost':
        result = core.scorePost(payload);
        break;
      case 'scorePosts':
        result = core.scorePosts(payload);
        break;
      case 'getPostScoreDetails':
        result = core.getPostScoreDetails(payload);
        break;
      case 'rankPosts':
        result = core.rankPosts(payload);
        break;
      case 'summarizeTagScores':
        result = core.summarizeTagScores(payload);
        break;
      case 'getRecommendedTags':
        result = core.getRecommendedTags(payload);
        break;
      case 'getRecommendedRatings':
        result = core.getRecommendedRatings();
        break;
      case 'buildRecommendedQueryParams':
        result = core.buildRecommendedQueryParams(payload.includeUserTags, payload.exploreMode);
        break;
      case 'getQueryableTags':
        result = core.getQueryableTags();
        break;
      case 'getQueryableTagsWithScores':
        result = core.getQueryableTagsWithScores();
        break;
      case 'generateMultiStrategyQueries':
        result = core.generateMultiStrategyQueries(payload.selectedRatings, payload.whitelist);
        break;
      case 'selectNextBestPost':
        result = core.selectNextBestPost(payload);
        break;
      case 'updateExhausted':
        core.updateExhausted(payload);
        result = true;
        break;
      case 'getExhaustedStrategies':
        result = Array.from(core.exhaustedStrategies);
        break;
      case 'getMLStats':
        result = core.getMLStats();
        break;
      case 'findSimilarTags':
        result = this.tagEmbedding.findSimilarTags(payload.query, payload.topK || 10, new Set(payload.exclude || []));
        break;
      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    self.postMessage({ id, type: 'success', result });
  } catch (error) {
    console.error(`[RecommendationWorker] Error processing ${type}:`, error);
    self.postMessage({ id, type: 'error', error: error.message || String(error) });
  }
};
