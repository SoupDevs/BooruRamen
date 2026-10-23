import StorageService from '../services/StorageService';
import tagEmbedding from '../services/TagEmbedding';
import { MLScorer, TRAIN_THRESHOLD } from '../services/MLScorer';
import { BanditExplorer } from '../services/BanditExplorer';
import { hydrateImageAnalysis } from '../services/ImageAnalysisCache.js';
import { learningPost } from '../services/imageFeatures.js';
import { MAX_SCORE_WEIGHT } from '../plugins/limits.js';
import { postKey } from '../services/postKey.js';
import { SessionInterest, interactionSignal, PROFILE_HALF_LIFE_HOURS } from '../services/SessionInterest.js';
import { DeepDiveInterest } from '../services/DeepDiveInterest.js';
import { DwellBaseline, dwellEngagement, engagementLabel, focusPostOnTag, isVideoPost, SKIP_LABEL, TOGGLE_TYPES } from '../services/signals.js';

import { diversify } from '../services/Diversity.js';
import { GlobalTagGraph } from '../services/GlobalTagGraph.js';

// Impressions remembered for bandit credit (one reward per shown post).
const IMPRESSION_MEMORY = 500;
// Largest score cut for a fully satiated artist/character/copyright.
const SATIATION_WEIGHT = 0.3;
const SNAPSHOT_SAVE_INTERVAL_MS = 30 * 1000;
// Exploration: every Nth slot normally, every 2nd under a run of skips.
const EXPLORE_INTERVAL = 4;
const EXPLORE_INTERVAL_PRESSURED = 2;
// Upper-confidence bonus per unit of uncertainty for exploration picks.
const EXPLORE_UCB = 0.5;
// Exploration never reaches into the bottom of the candidate list.
const EXPLORE_SCORE_FLOOR_QUANTILE = 0.3;
// Session pacing. The first posts of a session decide whether it goes on,
// and a run of skips is where users leave:
//  - a session opens with OPENER_SLOTS of the most confident exploit picks,
//  - RESERVE_SIZE strong candidates are held back from later batches, and
//  - after RECOVERY_SKIP_STREAK skips in a row one of them is served next.
export const OPENER_SLOTS = 3;
export const RESERVE_SIZE = 2;
export const RECOVERY_SKIP_STREAK = 3;
// "Why this post": discovery picks name the liked tag that best explains
// them, if any of the post's tags has at least this much affinity.
const DISCOVERY_STRATEGIES = new Set(['adjacent', 'trending', 'wildcard']);
const LIKED_REASON_MIN = 0.15;
const IDENTITY_CATEGORIES = new Set(['artist', 'copyright', 'character']);

const TAG_CATEGORIES = ['artist', 'copyright', 'character', 'general', 'meta'];
// Slow "core" profile: long-standing favourites outlive a month-long phase.
const CORE_HALF_LIFE_HOURS = 180 * 24;



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

export class RecommendationWorkerCore {
  constructor() {
    this.userEmbedding = null;
    this.rawTagScores = {};
    this.rawCoreTagScores = {};
    this.rawRatingPreferences = { general: 0, sensitive: 0, questionable: 0, explicit: 0 };
    this.rawMediaTypePreferences = { image: 0, video: 0 };
    this.tagScores = {};
    this.tagEngagement = {};
    this.tagCategories = {};
    this.ratingPreferences = null;
    this.mediaTypePreferences = null;
    this.avoidedTags = [...COMMON_TAGS];
    this.lastUpdateTime = 0;
    this.postScoreCache = new Map();
    this.strategyCursors = {};
    this.exhaustedStrategies = new Set();

    // ML components
    this.mlInitialized = false;
    // Set by new interactions; refreshUserProfile skips the rebuild (and its
    // snapshot write) when nothing changed.
    this.profileDirty = true;
    this.profileRefreshedAt = 0;
    // After the first build the profile lives in memory and later rebuilds
    // only add newer interactions, so the snapshot can be written lazily.
    this.profileLoaded = false;
    this.profileUpdate = null;
    this.snapshotSavedAt = 0;
    this.snapshotTimer = null;
    this.sessionInterest = new SessionInterest();
    this.deepDive = new DeepDiveInterest();
    this.resetPacing();
    // In-memory state is authoritative once loaded; snapshots only persist it.
    this.dwellBaseline = null;
    this.impressions = new Map();
    this.tagGraph = new GlobalTagGraph();
  }

  async initialize() {
    this.strategyCursors = {};
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.strategyCursors = {};
      this.exhaustedStrategies = new Set();

      const stored = await StorageService.getProfileSnapshot();
      this.dwellBaseline = new DwellBaseline(stored?.dwellBaseline);
      this.tagGraph = new GlobalTagGraph(stored?.tagGraph);

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
      // Use the module singleton: MLScorer imports the same singleton for
      // feature extraction, so training a separate instance here would leave
      // the scorer reading from an empty, untrained embedding table.
      this.tagEmbedding = tagEmbedding;
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
    // A new search or mode starts its feed from the top: open strongly
    // again, and drop reserve picks chosen under the old filters.
    this.resetPacing();
    // ML components only exist after initialize(); a reset triggered from
    // the settings page can arrive before the feed ever initialized them
    if (this.banditExplorer) this.banditExplorer.endSession();
  }

  applyDecay(hoursPassed) {
    const coreDecay = Math.pow(0.5, hoursPassed / CORE_HALF_LIFE_HOURS);
    for (const tag in this.rawCoreTagScores) {
      this.rawCoreTagScores[tag] *= coreDecay;
      if (Math.abs(this.rawCoreTagScores[tag]) < 0.01) delete this.rawCoreTagScores[tag];
    }
    const decayFactor = Math.pow(0.5, hoursPassed / PROFILE_HALF_LIFE_HOURS);
    for (const tag in this.rawTagScores) {
      this.rawTagScores[tag] *= decayFactor;
      if (Math.abs(this.rawTagScores[tag]) < 0.01) delete this.rawTagScores[tag];
    }
    for (const rating in this.rawRatingPreferences) {
      this.rawRatingPreferences[rating] *= decayFactor;
    }
    for (const type in this.rawMediaTypePreferences) {
      this.rawMediaTypePreferences[type] *= decayFactor;
    }
  }

  async refreshUserProfile(maxAgeMs = 5 * 60 * 1000) {
    if (this.profileDirty || Date.now() - this.profileRefreshedAt > maxAgeMs) await this.updateUserProfile();
  }

  /**
   * Rebuilds are serialized: two overlapping incremental rebuilds would both
   * apply the same new interactions.
   */
  updateUserProfile() {
    const run = () => this._updateUserProfile();
    this.profileUpdate = (this.profileUpdate || Promise.resolve()).then(run, run);
    return this.profileUpdate;
  }

  async _updateUserProfile() {
    // Cleared before the awaits: an interaction stored mid-rebuild marks the
    // profile dirty again and is picked up by the next refresh.
    this.profileDirty = false;
    this.profileRefreshedAt = Date.now();
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

    const snapshot = this.profileLoaded ? null : await StorageService.getProfileSnapshot();

    if (this.profileLoaded) {
      // The in-memory profile is newer than (or equal to) the stored one.
      const hoursSinceUpdate = (now - this.lastUpdateTime) / (1000 * 60 * 60);
      if (hoursSinceUpdate > 0) this.applyDecay(hoursSinceUpdate);
      interactions = await StorageService.getRecentInteractions(this.lastUpdateTime);
      isIncremental = true;
    } else if (snapshot && (!resetTimestamp || snapshot.timestamp > resetTimestamp)) {
      this.rawTagScores = snapshot.rawTagScores || snapshot.tagScores || {};
      // Older snapshots have no core profile: seed it from the current one.
      this.rawCoreTagScores = snapshot.coreTagScores || { ...this.rawTagScores };
      this.tagEngagement = snapshot.tagEngagement || {};
      this.tagCategories = snapshot.tagCategories || {};
      this.rawRatingPreferences = snapshot.ratingPreferences || { general: 0, sensitive: 0, questionable: 0, explicit: 0 };
      this.rawMediaTypePreferences = snapshot.mediaTypePreferences || { image: 0, video: 0 };
      this.lastUpdateTime = snapshot.timestamp || 0;

      const hoursSinceSnapshot = (now - this.lastUpdateTime) / (1000 * 60 * 60);
      if (hoursSinceSnapshot > 0) this.applyDecay(hoursSinceSnapshot);

      interactions = await StorageService.getRecentInteractions(this.lastUpdateTime);
      isIncremental = true;
    } else {
      this.initializeDefaultProfile();
      interactions = await StorageService.getInteractions();
      if (resetTimestamp > 0) {
        interactions = interactions.filter(i => i.timestamp > resetTimestamp);
      }
    }

    if (interactions.length === 0 && !isIncremental) {
      this.normalizeScores();
      this.profileLoaded = true;
      return;
    }

    // Normalize now so ML feature extraction during training sees the
    // current tag affinities instead of last update's (or empty) scores
    this.normalizeScores();

    // A fresh or reset ML model (e.g., after a feature-layout change) has
    // seen none of the stored history — the incremental path only feeds it
    // interactions newer than the last snapshot. Flag it for a backfill.
    const mlNeedsBackfill = this.mlInitialized && isIncremental && this.mlScorer.interactionCount === 0;
    const backfillUpTo = this.lastUpdateTime;

    const settings = await StorageService.loadAppSettings();
    await hydrateImageAnalysis(interactions.map(i => i.metadata?.post).filter(Boolean), { includeAi: !!settings?.settings?.aiTaggingEnabled });
    interactions = interactions.map(i => i.metadata?.post ? { ...i, metadata: { ...i.metadata, post: learningPost(i.metadata.post) } } : i);

    // Process interactions for both heuristic profile and ML
    interactions.forEach(interaction => {
      // Undo events (un-like, un-favorite, clearing a dislike) carry no
      // preference signal. Processing them poisons the profile: a like is
      // logged together with a dislike-clear, whose -1.0 weight would cancel
      // the like's +1.0 on every tag.
      const isToggle = interaction.type === 'like' || interaction.type === 'favorite' || interaction.type === 'dislike';
      if (isToggle && !interaction.value) {
        // ...but an undo of a toggle the profile already absorbed carries
        // the opposite of that contribution, so un-liking un-learns.
        // A full rebuild never sees the undone toggle (the undo row replaced
        // it), so only the incremental path has anything to take back.
        const undo = interaction.metadata?.undoWeight;
        if (isIncremental && undo && interaction.metadata?.post) {
          const age = (now - interaction.timestamp) / (1000 * 60 * 60);
          this.updateProfileWithPost(
            interaction.metadata.post,
            undo * Math.pow(0.5, age / PROFILE_HALF_LIFE_HOURS),
            (interaction.metadata.undoCoreWeight ?? undo) * Math.pow(0.5, age / CORE_HALF_LIFE_HOURS)
          );
        }
        return;
      }

      const ageInHours = (now - interaction.timestamp) / (1000 * 60 * 60);
      const recencyWeight = Math.pow(0.5, ageInHours / PROFILE_HALF_LIFE_HOURS);
      const coreRecency = Math.pow(0.5, ageInHours / CORE_HALF_LIFE_HOURS);
      const durableWeight = interaction.metadata?.profileWeight ?? 1;
      const weight = interactionSignal(interaction.type, interaction.value, interaction.metadata?.engagement) * recencyWeight * durableWeight;

      if (interaction.metadata && interaction.metadata.post) {
        this.updateProfileWithPost(interaction.metadata.post, weight, recencyWeight ? weight * coreRecency / recencyWeight : 0);

        // Feed interaction to ML components
        if (this.mlInitialized) {
          this.tagEmbedding.addInteraction(interaction);

          this.mlScorer.addTrainingSample(
            interaction.metadata.post,
            interaction.type,
            interaction.value,
            this.tagScores,
            {
              ratingPreferences: this.ratingPreferences,
              mediaTypePreferences: this.mediaTypePreferences,
            },
            durableWeight,
            interaction.metadata.engagement
          );

        }
      }
    });

    // Retrain a fresh/reset ML model from stored history. Only the scorer
    // needs this — tag embeddings and the heuristic profile persist in the
    // snapshot independently of the model weights.
    if (mlNeedsBackfill) {
      await this._backfillMLTraining(resetTimestamp, backfillUpTo);
    }

    // Flush any remaining training samples
    if (this.mlInitialized) {
      const wasTrained = this.mlScorer.isTrained;
      this.mlScorer.flushTraining();

      // Clear post cache when ML transitions to trained state
      // so posts are re-scored with the new ML model
      if (!wasTrained && this.mlScorer.isTrained) {
        this.postScoreCache.clear();
      }
    }

    this.lastUpdateTime = now;
    this.profileLoaded = true;
    this.normalizeScores();
    await this._scheduleSnapshotSave();
    this.postScoreCache.clear();
  }

  /**
   * The snapshot (tag embeddings and model included) runs to megabytes for a
   * long history, so it is written at most every SNAPSHOT_SAVE_INTERVAL_MS
   * instead of after every like. If the app closes before a pending write,
   * the next start replays the interactions newer than the stored snapshot.
   */
  _scheduleSnapshotSave() {
    if (this.snapshotTimer) return;
    const wait = Math.max(0, this.snapshotSavedAt + SNAPSHOT_SAVE_INTERVAL_MS - Date.now());
    const save = () => {
      this.snapshotTimer = null;
      this.snapshotSavedAt = Date.now();
      return this._saveProfileSnapshot().catch(e => console.error('Failed to save profile snapshot:', e));
    };
    if (wait === 0) return save();
    this.snapshotTimer = setTimeout(save, wait);
  }

  _cancelSnapshotSave() {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
  }

  /**
   * Feed stored interaction history to the ML scorer as training samples.
   * Used when the model was re-initialized (feature-layout change) but the
   * user already has interaction history — without this the model would sit
   * untrained (and the feed unscored by ML) until enough new interactions
   * accumulate.
   * @param {number} resetTimestamp - Ignore interactions before this time
   * @param {number} upToTimestamp - Ignore interactions after this time
   *   (newer ones were just processed by the regular incremental loop)
   */
  async _backfillMLTraining(resetTimestamp, upToTimestamp) {
    let history = await StorageService.getInteractions();
    history = history.filter(i =>
      i.timestamp > (resetTimestamp || 0) &&
      (!upToTimestamp || i.timestamp <= upToTimestamp) &&
      i.metadata?.post
    );
    if (history.length === 0) return;
    const settings = await StorageService.loadAppSettings();
    await hydrateImageAnalysis(history.map(i => i.metadata.post), { includeAi: !!settings?.settings?.aiTaggingEnabled });

    console.log(`[ML] Backfilling scorer from ${history.length} stored interactions`);
    for (const interaction of history) {
      this.mlScorer.addTrainingSample(
        learningPost(interaction.metadata.post),
        interaction.type,
        interaction.value,
        this.tagScores,
        {
          ratingPreferences: this.ratingPreferences,
          mediaTypePreferences: this.mediaTypePreferences,
        },
        interaction.metadata?.profileWeight ?? 1,
        interaction.metadata?.engagement
      );
    }
    this.mlScorer.flushTraining();
    if (this.mlScorer.isTrained) {
      this.postScoreCache.clear();
    }
  }

  /**
   * Save the current profile state including ML model and bandit state.
   */
  async _saveProfileSnapshot() {
    const snapshot = {
      timestamp: this.lastUpdateTime,
      rawTagScores: this.rawTagScores,
      coreTagScores: this.rawCoreTagScores,
      tagEngagement: this.tagEngagement,
      tagCategories: this.tagCategories,
      ratingPreferences: this.rawRatingPreferences,
      mediaTypePreferences: this.rawMediaTypePreferences,
      dwellBaseline: this.dwellBaseline?.toSnapshot(),
      tagGraph: this.tagGraph.toSnapshot(),
    };

    // Save ML model state
    if (this.mlInitialized) {
      snapshot.tagEmbeddings = this.tagEmbedding.toSnapshot();
      snapshot.mlModel = this.mlScorer.toSnapshot();
      snapshot.banditState = this.banditExplorer.toSnapshot();
    }

    await StorageService.storeProfileSnapshot(snapshot);
    this.normalizeScores();
  }

  updateProfileWithPost(post, weight, coreWeight = weight) {
    if (!weight && !coreWeight) return;
    const avoidedSet = new Set(this.avoidedTags || []);
    const processed = new Set();
    const processTag = (tag, category) => {
      if (!tag || avoidedSet.has(tag) || processed.has(tag)) return;
      processed.add(tag);
      if (this.rawTagScores[tag] === undefined) {
        this.rawTagScores[tag] = 0;
        this.tagCategories[tag] = category;
      } else if (category !== 'general' && this.tagCategories[tag] !== category) {
        // Sources that categorise tags late (Gelbooru looks them up after
        // the posts arrive) first report everything as general; take the
        // specific category as soon as a post carries it.
        this.tagCategories[tag] = category;
      }
      if (this.tagEngagement[tag] === undefined) {
        this.tagEngagement[tag] = 0;
      }
      this.rawTagScores[tag] += weight;
      this.rawCoreTagScores[tag] = (this.rawCoreTagScores[tag] || 0) + coreWeight;
      this.tagEngagement[tag] += Math.abs(weight);
    };

    TAG_CATEGORIES.forEach(category => {
      const tagString = post[`tag_string_${category}`] || '';
      if (tagString) tagString.split(' ').forEach(tag => processTag(tag, category));
    });

    const generalTags = post.tag_string || '';
    if (generalTags) {
      generalTags.split(' ').forEach(tag => processTag(tag, this.tagCategories[tag] || 'general'));
    }

    if (post.rating) {
      if (this.rawRatingPreferences[post.rating] === undefined) this.rawRatingPreferences[post.rating] = 0;
      this.rawRatingPreferences[post.rating] += weight;
    }

    if (post.file_ext) {
      const isVideo = ['mp4', 'webm'].includes(post.file_ext);
      const type = isVideo ? 'video' : 'image';
      this.rawMediaTypePreferences[type] += weight;
    }
  }

  normalizeScores() {
    this.tagScores = {};
    const tagScoreValues = Object.values(this.rawTagScores);
    if (tagScoreValues.length > 0) {
      const maxTagScore = Math.max(...tagScoreValues.map(Math.abs));
      if (maxTagScore > 0) {
        for (const tag in this.rawTagScores) {
          this.tagScores[tag] = this.rawTagScores[tag] / maxTagScore;
        }
      } else {
        this.tagScores = { ...this.rawTagScores };
      }
    }

    this.ratingPreferences = {};
    const totalRatingScore = Object.values(this.rawRatingPreferences).reduce((sum, val) => sum + Math.max(0, val), 0);
    if (totalRatingScore > 0) {
      for (const rating in this.rawRatingPreferences) {
        this.ratingPreferences[rating] = Math.max(0, this.rawRatingPreferences[rating]) / totalRatingScore;
      }
    } else {
      const ratings = Object.keys(this.rawRatingPreferences);
      ratings.forEach(rating => this.ratingPreferences[rating] = 1 / ratings.length);
    }

    this.mediaTypePreferences = {};
    const totalMediaScore = Math.max(0.001, this.rawMediaTypePreferences.image + this.rawMediaTypePreferences.video);
    this.mediaTypePreferences.image = this.rawMediaTypePreferences.image / totalMediaScore;
    this.mediaTypePreferences.video = this.rawMediaTypePreferences.video / totalMediaScore;
  }

  initializeDefaultProfile() {
    this.rawTagScores = {};
    this.rawCoreTagScores = {};
    this.tagScores = {};
    this.tagEngagement = {};
    this.tagCategories = {};

    this.rawRatingPreferences = { general: 1.0, sensitive: 0.0, questionable: 0, explicit: 0 };
    this.ratingPreferences = { ...this.rawRatingPreferences };

    this.rawMediaTypePreferences = { image: 0.8, video: 0.2 };
    this.mediaTypePreferences = { ...this.rawMediaTypePreferences };

    this.lastUpdateTime = Date.now();
  }

  /**
   * Wipe all in-memory recommendation and ML state without writing anything
   * to storage. Used by "Clear All Data": the caller clears IndexedDB, and
   * this makes the live session match the now-empty disk, as if the app had
   * been freshly installed.
   */
  factoryReset() {
    this._cancelSnapshotSave();
    this.profileDirty = true;
    this.deepDive.end();
    this.sessionInterest.reset();
    this.initializeDefaultProfile();
    this.postScoreCache.clear();
    this.resetExploreSession();
    this.dwellBaseline = new DwellBaseline();
    this.impressions.clear();
    this.tagGraph = new GlobalTagGraph();
    if (this.mlInitialized) {
      this.mlScorer.reset();
      this.banditExplorer.reset();
      this.tagEmbedding.reset();
    }
  }

  async resetRecommendations() {
    this._cancelSnapshotSave();
    this.profileDirty = true;
    this.deepDive.end();
    this.sessionInterest.reset();
    const resetTime = Date.now();
    await StorageService.storePreferences({ recommendationResetTime: resetTime });

    const preferences = await StorageService.getPreferences();
    if (preferences.avoidedTags && Array.isArray(preferences.avoidedTags)) {
      this.avoidedTags = preferences.avoidedTags;
    } else {
      this.avoidedTags = [...COMMON_TAGS];
    }

    this.initializeDefaultProfile();
    this.postScoreCache.clear();
    this.resetExploreSession();

    // Reset ML components so the model retrains only from interactions
    // made after this point. The persisted snapshot below intentionally
    // omits mlModel/banditState/tagEmbeddings, so the reset also survives
    // an app restart.
    if (this.mlInitialized) {
      this.mlScorer.reset();
      this.banditExplorer.reset();
      this.tagEmbedding.reset();
    }

    await StorageService.storeProfileSnapshot({
      timestamp: resetTime,
      rawTagScores: this.rawTagScores,
      tagEngagement: this.tagEngagement,
      tagCategories: this.tagCategories,
      ratingPreferences: this.rawRatingPreferences,
      mediaTypePreferences: this.rawMediaTypePreferences,
      // Viewing pace and the booru's tag graph are not taste: they survive
      // a recommendation reset.
      dwellBaseline: this.dwellBaseline?.toSnapshot(),
      tagGraph: this.tagGraph.toSnapshot(),
    });
  }

  async trackInteraction(postId, interactionType, value, postData, updateImmediately = false, context = null) {
    // Capture mode before awaiting storage/image analysis so leaving a dive
    // cannot turn its last watch-time event into ordinary profile evidence.
    const diving = context?.deepDive ?? this.deepDive.active;
    const evidence = this.deepDive;
    const settings = await StorageService.loadAppSettings();
    if (postData) await hydrateImageAnalysis([postData], { includeAi: !!settings?.settings?.aiTaggingEnabled });
    let learnedPost = postData ? learningPost(postData) : null;
    let storedPost = postData;
    // A tag tap is interest in that tag, not in everything else on the post.
    if (interactionType === 'tagTap' && context?.tag && postData) {
      storedPost = focusPostOnTag(postData, context.tag);
      learnedPost = focusPostOnTag(learnedPost, context.tag);
    }
    // Normalise dwell once, at record time, with the baseline as it was then;
    // profile rebuilds and model training read the stored label.
    let engagement = null;
    if (interactionType === 'timeSpent' && learnedPost) {
      if (!this.dwellBaseline) this.dwellBaseline = new DwellBaseline();
      const video = isVideoPost(learnedPost);
      engagement = dwellEngagement(value, { video, durationSec: context?.mediaDuration, baseline: this.dwellBaseline });
      // Autoscroll paces the dwell, so it says nothing about the user's pace
      if (!video && !context?.autoScroll) this.dwellBaseline.observe(value);
    }
    // Autoscroll decides how long a post stays on screen, so a long dwell
    // under it is not the user choosing to stay. Skips still count: moving
    // on before autoscroll does is a choice.
    const passiveDwell = interactionType === 'timeSpent' && context?.autoScroll
      && (engagement ?? engagementLabel(interactionType, value)) > SKIP_LABEL + 1e-9;
    const profileWeight = passiveDwell ? 0 : diving
      ? evidence.profileWeight(learnedPost, interactionType, value, this.avoidedTags, engagement)
      : this.sessionInterest.record(learnedPost, interactionType, value, this.avoidedTags, engagement);
    const undo = TOGGLE_TYPES.includes(interactionType) && !value && postData
      ? await this.undoWeights(postId, interactionType, postData)
      : null;
    await StorageService.storeInteraction({
      postId,
      type: interactionType,
      value,
      metadata: {
        post: storedPost, profileWeight, deepDive: diving,
        ...(engagement !== null && { engagement }),
        ...(context?.mediaDuration && { mediaDuration: context.mediaDuration }),
        ...(context?.tag && { tag: context.tag }),
        ...(passiveDwell && { autoScroll: true }),
        ...(undo && { undoWeight: undo.weight, undoCoreWeight: undo.coreWeight }),
      }
    });
    if (!diving && !passiveDwell) this.creditStrategy(postData, interactionType, value, engagement);
    this.profileDirty = true;

    this.postScoreCache.clear();

    if (updateImmediately) {
      await this.updateUserProfile();
    }
  }

  /**
   * The profile contribution an undo must take back: the toggle being
   * undone, if the profile has already absorbed it (it is stored before the
   * last rebuild). A toggle not absorbed yet is simply overwritten by the
   * undo row and never counted. Its pending training samples are dropped.
   * @returns {{ weight: number, coreWeight: number } | null}
   */
  async undoWeights(postId, interactionType, postData) {
    const source = postData?.source ?? null;
    const rows = await StorageService.getPostInteractions(postId);
    const prior = rows.find(row => row.type === interactionType && (row.source ?? null) === source && row.value);
    if (this.mlInitialized) this.mlScorer.forget(postKey(postData), interactionType);
    if (!prior || prior.timestamp > this.lastUpdateTime) return null;
    const signal = interactionSignal(prior.type, prior.value, prior.metadata?.engagement);
    const durable = prior.metadata?.profileWeight ?? 1;
    const hours = (Date.now() - prior.timestamp) / (1000 * 60 * 60);
    const weight = -signal * durable * Math.pow(0.5, hours / PROFILE_HALF_LIFE_HOURS);
    const coreWeight = -signal * durable * Math.pow(0.5, hours / CORE_HALF_LIFE_HOURS);
    return weight ? { weight, coreWeight } : null;
  }

  /**
   * One bandit reward per impression of a strategy-fetched post: the best
   * label among its events, credited when the impression ends (its watch
   * time is logged on leaving the post). Crediting every event separately
   * counted a liked post two or three times, and crediting strategy-less
   * posts to the leading arm made the leader self-reinforcing.
   */
  creditStrategy(post, type, value, engagement) {
    const strategy = post?._strategy;
    if (!strategy || !this.banditExplorer) return;
    const label = engagementLabel(type, value, engagement);
    if (label === undefined) return;
    const key = postKey(post);
    let impression = this.impressions.get(key);
    if (!impression) {
      impression = { strategy, best: label, credited: false };
      this.impressions.set(key, impression);
      if (this.impressions.size > IMPRESSION_MEMORY) this.impressions.delete(this.impressions.keys().next().value);
    }
    if (impression.credited) return;
    impression.best = Math.max(impression.best, label);
    if (type === 'timeSpent') {
      this.banditExplorer.recordReward(impression.strategy, impression.best);
      impression.credited = true;
    }
  }

  /**
   * Score a post using ML model if trained, otherwise fall back to heuristic.
   * @param {Object} post
   * @returns {number} - Score (engagement probability or heuristic score)
   */
  scorePost(post) {
    const key = postKey(post);
    post = learningPost(post);
    if (this.postScoreCache.has(key)) {
      return this.blendRankingScore(this.postScoreCache.get(key), post);
    }

    let score;

    // Use ML scorer when trained
    if (this.mlInitialized && this.mlScorer.isTrained) {
      score = this.mlScorer.scorePost(
        post,
        this.tagScores,
        {
          ratingPreferences: this.ratingPreferences,
          mediaTypePreferences: this.mediaTypePreferences,
        }
      );

      // ML returns valid score — use it directly
      if (score >= 0) {
        // Add small random noise for discovery
        score += Math.random() * 0.05;
        this.postScoreCache.set(key, score);
        return this.blendRankingScore(score, post);
      }
    }

    // Cold start: use embedding-based similarity (no heuristic)
    score = this._embeddingScore(post);
    score += Math.random() * 0.1; // more noise during cold start for exploration
    this.postScoreCache.set(key, score);
    return this.blendRankingScore(score, post);
  }

  blendRankingScore(score, post) {
    const blended = this.deepDive.blend(this.sessionInterest.blend(score, post, this.avoidedTags), post, this.avoidedTags, tagEmbedding);
    // Ranking multiplier from plugins (feedHooks.applyScoreHook), already
    // clamped there; checked again since it arrives on the post.
    const weight = Number.isFinite(post._pluginWeight) ? Math.min(MAX_SCORE_WEIGHT, Math.max(0, post._pluginWeight)) : 1;
    // A dive asks for more of the same; normal browsing tires of repeats.
    if (this.deepDive.active) return blended * weight;
    return blended * weight * (1 - SATIATION_WEIGHT * this.sessionInterest.satiation(post, this.avoidedTags));
  }

  /**
   * 0..1: how little the engine knows about this kind of post. Uses the
   * ML model's neural-linear posterior when available, otherwise how much
   * interaction evidence the post's tags have.
   */
  postUncertainty(post) {
    post = learningPost(post);
    if (this.mlInitialized && this.mlScorer.isTrained && this.mlScorer.uncertainty) {
      const value = this.mlScorer.uncertainty(post, this.tagScores, {
        ratingPreferences: this.ratingPreferences, mediaTypePreferences: this.mediaTypePreferences,
      });
      if (value !== null) return value;
    }
    const avoided = new Set(this.avoidedTags);
    const tags = (post.tag_string || '').split(/\s+/).filter(tag => tag && !avoided.has(tag));
    if (!tags.length) return 1;
    const evidence = tags.reduce((sum, tag) => sum + (this.tagEngagement[tag] || 0), 0) / tags.length;
    return 1 / Math.sqrt(1 + evidence);
  }

  resetPacing() {
    this.pacingSessionStart = this.sessionInterest?.startedAt ?? null;
    this.slotsServed = 0;
    this.reserve = [];
    this.recoveryArmed = true;
  }

  /** Opener slots still owed to the current session. */
  openerSlotsLeft() {
    if (!this.reserve) this.resetPacing();
    const startedAt = this.sessionInterest.startedAt;
    if (startedAt !== this.pacingSessionStart) {
      // The session interest went idle and restarted: a new session.
      this.pacingSessionStart = startedAt;
      this.slotsServed = 0;
      this.recoveryArmed = true;
    }
    return Math.max(0, OPENER_SLOTS - this.slotsServed);
  }

  /**
   * The tag on this post the user has shown the most liking for, preferring
   * a series, character or artist when it is about as strong. Never an
   * avoided, meta or metatag tag.
   * @returns {{ tag: string, category: string }|null}
   */
  likedReasonTag(post) {
    const avoided = new Set([...this.avoidedTags, 'video']);
    const categoryOf = tag => this.tagCategories?.[tag]
      || [...IDENTITY_CATEGORIES].find(category => (post[`tag_string_${category}`] || '').split(/\s+/).includes(tag))
      || 'general';
    let best = null, bestScore = LIKED_REASON_MIN;
    for (const tag of new Set((post.tag_string || '').split(/\s+/))) {
      if (!tag || tag.includes(':') || avoided.has(tag)) continue;
      const category = categoryOf(tag);
      if (category === 'meta') continue;
      const score = (this.tagScores?.[tag] || 0) * (IDENTITY_CATEGORIES.has(category) ? 1.25 : 1);
      if (score > bestScore) { best = { tag, category }; bestScore = score; }
    }
    return best;
  }

  /** Lower confidence bound: a high score the model is sure about. */
  confidentScore(item) {
    return item.score - EXPLORE_UCB * this.postUncertainty(item.post);
  }

  /**
   * After a run of skips, hand back one held-back strong pick to show next.
   * Fires once per run: the streak has to be broken before it fires again.
   * @returns {Object|null} the post, marked _recovery
   */
  takeRecoveryPick(exclude = []) {
    this.openerSlotsLeft();
    if (this.deepDive.active) return null;
    if (this.sessionInterest.skipStreak < RECOVERY_SKIP_STREAK) {
      this.recoveryArmed = true;
      return null;
    }
    if (!this.recoveryArmed) return null;
    const excluded = new Set(exclude);
    this.reserve = this.reserve.filter(post => !excluded.has(postKey(post)));
    if (!this.reserve.length) return null;
    // The reserve was scored when it was set aside; the session has moved
    // on since, so pick by today's score.
    const best = this.reserve
      .map(post => ({ post, score: this.scorePost(post) }))
      .sort((a, b) => this.confidentScore(b) - this.confidentScore(a))[0];
    this.reserve = this.reserve.filter(post => post !== best.post);
    this.recoveryArmed = false;
    best.post._score = Math.round(best.score * 1e4) / 1e4;
    return Object.assign(best.post, { _recovery: true });
  }

  /**
   * Order a batch of candidates for the feed.
   * Exploit slots: best scores, diversified against what was just shown.
   * Explore slots: the highest upper-confidence picks (score + uncertainty)
   * among the rest, never from the bottom of the list. Previously every 4th
   * slot came from the lowest-scored 40%: content the model was confident the
   * user would not like, which costs retention and teaches little.
   * @returns {{ feed: Object[], rest: Object[] }} chosen posts and leftovers
   */
  assembleFeed(posts, { maxTotal = 10, context = [] } = {}) {
    // The score each post is shown with is kept on it (and so stored with its
    // interactions) for progressive validation in FeedMetrics.
    const scored = posts.map(post => {
      const score = this.scorePost(post);
      post._score = Math.round(score * 1e4) / 1e4;
      return { post, score };
    });
    if (this.deepDive.active) {
      const ordered = diversify(scored, context, { lambda: 0.1 });
      return { feed: ordered.slice(0, maxTotal).map(item => item.post), rest: ordered.slice(maxTotal).map(item => item.post) };
    }
    const openers = this.openerSlotsLeft();
    const reserved = new Set(this.reserve.map(postKey));
    let byScore = scored.filter(item => !reserved.has(postKey(item.post))).sort((a, b) => b.score - a.score);
    // Top up the reserve once the session is under way, and only from a
    // batch with candidates to spare.
    const missing = RESERVE_SIZE - this.reserve.length;
    if (!openers && missing > 0 && byScore.length >= maxTotal + missing) {
      const held = [...byScore].sort((a, b) => this.confidentScore(b) - this.confidentScore(a)).slice(0, missing);
      this.reserve.push(...held.map(item => item.post));
      byScore = byScore.filter(item => !held.includes(item));
    }
    const total = Math.min(maxTotal, byScore.length);
    const interval = this.sessionInterest.explorationPressure >= 0.75 ? EXPLORE_INTERVAL_PRESSURED : EXPLORE_INTERVAL;
    const exploreCount = Math.floor(total / interval);
    const exploit = byScore.slice(0, total - exploreCount);
    const floor = byScore.length ? byScore[Math.floor((byScore.length - 1) * (1 - EXPLORE_SCORE_FLOOR_QUANTILE))].score : 0;
    const explore = byScore.slice(exploit.length)
      .filter(item => item.score >= floor)
      .map(item => ({ ...item, ucb: item.score + EXPLORE_UCB * this.postUncertainty(item.post) }))
      .sort((a, b) => b.ucb - a.ucb)
      .slice(0, exploreCount);
    const chosen = new Set([...exploit, ...explore].map(item => item.post));
    // Openers: the most confident exploit picks, ahead of everything else.
    const opening = [...exploit].sort((a, b) => this.confidentScore(b) - this.confidentScore(a)).slice(0, openers);
    const exploitOrder = [...opening, ...diversify(exploit.filter(item => !opening.includes(item)), [...context, ...opening.map(item => item.post)])];
    const feed = [];
    let e = 0, x = 0;
    for (let position = 0; feed.length < exploit.length + explore.length; position++) {
      const slot = position - opening.length;
      if (slot >= 0 && (slot + 1) % interval === 0 && x < explore.length) feed.push(Object.assign(explore[x++].post, { _explore: true }));
      else if (e < exploitOrder.length) feed.push(exploitOrder[e++].post);
      else feed.push(Object.assign(explore[x++].post, { _explore: true }));
    }
    this.slotsServed += feed.length;
    for (const post of feed) {
      if (!post._explore && !DISCOVERY_STRATEGIES.has(post._strategy)) continue;
      const liked = this.likedReasonTag(post);
      if (liked) post._reason = { ...post._reason, liked };
    }
    return { feed, rest: byScore.filter(item => !chosen.has(item.post)).map(item => item.post) };
  }

  async setDeepDive(post) {
    if (post) {
      const settings = await StorageService.loadAppSettings();
      await hydrateImageAnalysis([post], { includeAi: !!settings?.settings?.aiTaggingEnabled });
      this.deepDive = new DeepDiveInterest();
      this.deepDive.start(learningPost(post));
    } else this.deepDive.end();
    this.postScoreCache.clear();
    this.resetExploreSession();
  }

  /**
   * Embedding-based score for cold start (no heuristic).
   * Uses cosine similarity between user interest embedding and post tag embedding.
   */
  _embeddingScore(post) {
    if (!this.tagScores || Object.keys(this.tagScores).length === 0) return 0;

    // Build user interest embedding from top positive-affinity tags
    const userEntries = Object.entries(this.tagScores)
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    const userTags = userEntries.map(([tag]) => tag);
    const userTagWeights = new Map(userEntries);
    const userEmb = tagEmbedding.getAverageEmbedding(userTags, userTagWeights);

    // Build post tag embedding (IDF-weighted, noise tags excluded)
    const postTags = (post.tag_string || '').split(' ').filter(t => t);
    const postEmb = tagEmbedding.getPostEmbedding(postTags);

    if (!userEmb || !postEmb) return 0.1;

    // Cosine similarity
    let dot = 0, normU = 0, normP = 0;
    for (let i = 0; i < tagEmbedding.dim; i++) {
      dot += userEmb[i] * postEmb[i];
      normU += userEmb[i] * userEmb[i];
      normP += postEmb[i] * postEmb[i];
    }
    const denom = Math.sqrt(normU) * Math.sqrt(normP);
    if (denom < 1e-8) return 0.1;

    // Map from [-1, 1] to [0, 1]
    return (dot / denom + 1) * 0.5;
  }

  scorePosts(posts) {
    return posts.map(post => ({ post, score: this.scorePost(post) }));
  }

  getPostScoreDetails(post) {
    if (!this.tagScores) this.initializeDefaultProfile();

    // Get the actual score used for ranking
    const totalScore = this.scorePost(post);

    const details = {
      totalScore,
      deepDiveActive: this.deepDive.active,
      deepDiveSimilarity: this.deepDive.active ? this.deepDive.similarity(learningPost(post), this.avoidedTags, tagEmbedding) : null,
      sessionScore: this.sessionInterest.score(learningPost(post), this.avoidedTags),
      sessionWeight: this.sessionInterest.weight,
      mlScore: null,
      mlConfidence: 0,
      mlFeatures: null,
      mlTagContributions: null,
      contributingTags: [],
      mlActive: this.mlInitialized && this.mlScorer.isTrained,
      mlInteractionCount: this.mlInitialized ? this.mlScorer.interactionCount : 0,
      mlTrainThreshold: TRAIN_THRESHOLD,
    };

    // Get per-tag heuristic scores for reference (sorted by tag affinity)
    const postTags = (post.tag_string || '').split(' ').filter(t => t);
    const contributors = [];
    for (const tag of postTags) {
      if (this.tagScores[tag] !== undefined) {
        contributors.push({ tag, score: this.tagScores[tag] });
      }
    }
    contributors.sort((a, b) => b.score - a.score);
    details.contributingTags = contributors.slice(0, 10);

    // Add ML-specific breakdown when trained
    if (this.mlInitialized && this.mlScorer.isTrained) {
      const userProfile = {
        ratingPreferences: this.ratingPreferences,
        mediaTypePreferences: this.mediaTypePreferences,
      };
      const mlScore = this.mlScorer.scorePost(post, this.tagScores, userProfile);
      if (mlScore >= 0) {
        details.mlScore = mlScore;
        details.mlHeads = this.mlScorer.predictHeads?.(post, this.tagScores, userProfile) || null;
        details.uncertainty = this.postUncertainty(post);
        details.mlConfidence = Math.min(1, this.mlScorer.interactionCount / 50);

        try {
          details.mlFeatures = this.mlScorer.getFeatureValues(post, this.tagScores, userProfile);
          details.mlTagContributions = this.mlScorer.getTagContributions(post, this.tagScores, userProfile);
        } catch (e) {
          console.warn('[Worker] ML feature breakdown failed:', e);
        }
      }
    }

    return details;
  }

  /**
   * @param {Object[]} posts
   * @param {Object[]} [context] - what the user just saw
   * @param {Object} [options]
   * @param {boolean} [options.opener] - these posts open a new session (the
   *   app came back after a long pause): lead with the most confident
   *   non-exploration picks.
   */
  rankPosts(posts, context = [], { opener = false } = {}) {
    if (!posts || posts.length === 0) return [];
    // Exploration is chosen deliberately at feed assembly; a flat bonus per
    // strategy here would override the model on every re-rank.
    const scoredPosts = posts.map(post => {
      const score = this.scorePost(post);
      post._score = Math.round(score * 1e4) / 1e4;
      return { post, score };
    });
    if (this.deepDive.active) return diversify(scoredPosts, context, { lambda: 0.1 }).map(sp => sp.post);
    if (!opener) return diversify(scoredPosts, context).map(sp => sp.post);
    this.openerSlotsLeft();
    const opening = scoredPosts.filter(item => !item.post._explore)
      .sort((a, b) => this.confidentScore(b) - this.confidentScore(a))
      .slice(0, OPENER_SLOTS);
    this.slotsServed = opening.length;
    const rest = diversify(scoredPosts.filter(item => !opening.includes(item)), [...context, ...opening.map(item => item.post)]);
    return [...opening, ...rest].map(sp => sp.post);
  }

  summarizeTagScores(limit = 10) {
    const sortedTags = Object.entries(this.tagScores || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
    return Object.fromEntries(sortedTags);
  }

  getRecommendedTags(limit = 5) {
    if (!this.tagScores) return [];
    return Object.entries(this.rankingTagScores())
      .filter(([tag, score]) => score > 0 && this.tagCategories[tag] !== 'meta')
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag]) => tag);
  }

  getRecommendedRatings() {
    if (!this.ratingPreferences) return ['general'];
    return Object.entries(this.ratingPreferences)
      .filter(([_, pref]) => pref > 0.15)
      .map(([rating]) => rating);
  }

  buildRecommendedQueryParams(includeUserTags = true) {
    let tags = [];
    if (includeUserTags && this.tagScores) {
      const recommendedTags = this.getRecommendedTags(1);
      if (recommendedTags.length > 0) tags.push(recommendedTags[0]);
    }
    if (tags.length < 2) {
      const saferStrategies = ['age:<1d', 'age:<3d', 'age:<1w', 'order:rank', 'order:favcount'];
      tags.push(saferStrategies[Math.floor(Math.random() * saferStrategies.length)]);
    }
    return { tags: tags.join(' ') };
  }

  getQueryableTags() {
    return this.getQueryableTagsWithScores().map(item => item.tag);
  }

  getQueryableTagsWithScores() {
    if (!this.tagScores) return [];
    const QUERY_CATEGORY_WEIGHTS = { character: 1.0, copyright: 1.0, artist: 1.0, general: 0.5, meta: 0.0 };
    return Object.entries(this.rankingTagScores())
      .filter(([tag, score]) => score > 0)
      .filter(([tag]) => this.tagCategories[tag] !== 'meta')
      .filter(([tag]) => !this.avoidedTags.includes(tag))
      .filter(([tag]) => tag !== 'video')
      .map(([tag, score]) => {
        const category = this.tagCategories?.[tag] || 'general';
        const weight = QUERY_CATEGORY_WEIGHTS[category] ?? 0.15;
        // Tags that are on most posts make poor queries and poor evidence.
        return { tag, score: score * weight * (0.3 + 0.7 * this.tagGraph.idf(tag)) };
      })
      .sort((a, b) => b.score - a.score);
  }

  rankingTagScores() {
    const weight = this.sessionInterest.weight;
    const sessionTags = this.sessionInterest.affinities();
    const tags = new Set([...Object.keys(this.tagScores), ...Object.keys(sessionTags)]);
    return Object.fromEntries([...tags].map(tag => [tag, (this.tagScores[tag] || 0) * (1 - weight) + (sessionTags[tag] || 0) * weight]));
  }

  /**
   * Generate multi-strategy queries using Thompson Sampling for strategy selection.
   * The bandit optimizes which strategies to use based on past performance.
   */
  generateMultiStrategyQueries(selectedRatings = ['general'], whitelist = []) {
    if (this.deepDive.active) return this.deepDive.queries(this.avoidedTags, tagEmbedding);
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

    // Use Thompson Sampling to select which strategies to deploy
    const banditSelections = this.banditExplorer.selectTopK(5);
    const selectedStrategies = new Set(banditSelections.map(s => s.type));

    // Anchor strategy (always include if we have tags and bandit selected it)
    if (selectedStrategies.has('anchor')) {
      const anchorTag = this.weightedRandomSelect(tier1Pool, usedTags);
      if (anchorTag && !this.exhaustedStrategies.has(anchorTag.tag)) {
        queries.push({ tags: anchorTag.tag, type: 'anchor', intent: 'Core interest - highest affinity content' });
        usedTags.add(anchorTag.tag);
      }
    }

    // Pivot strategy (use bandit-selected strategy if available)
    if (selectedStrategies.has('pivot')) {
      const pivotModifiers = ['age:>3mo', 'age:>1y', 'order:rank age:<1mo', 'order:favcount age:<1mo'];
      const numPivots = Math.min(2, Math.max(1, banditSelections.find(s => s.type === 'pivot') ? 2 : 1));
      for (let i = 0; i < numPivots; i++) {
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
    }

    // Reach strategy: secondary interests, or half the time a long-time
    // favourite that has gone quiet lately
    const dormant = this.dormantInterests();
    if (selectedStrategies.has('reach') && (tier2Pool.length > 0 || dormant.length > 0)) {
      const rediscover = dormant.length > 0 && (tier2Pool.length === 0 || Math.random() < 0.5);
      const reachTag = this.weightedRandomSelect(rediscover ? dormant : tier2Pool, usedTags);
      if (reachTag && !this.exhaustedStrategies.has(reachTag.tag)) {
        queries.push({ tags: reachTag.tag, type: 'reach', intent: rediscover ? 'Rediscovering a long-time favourite' : 'Secondary interest - expanding horizons' });
        usedTags.add(reachTag.tag);
      }
    }

    // Adjacent strategy: a neighbour of the user's interests they barely know
    if (selectedStrategies.has('adjacent')) {
      const adjacentTag = this.weightedRandomSelect(this.adjacentInterests(), usedTags);
      if (adjacentTag && !this.exhaustedStrategies.has(adjacentTag.tag)) {
        queries.push({ tags: adjacentTag.tag, type: 'adjacent', intent: 'Adjacent interest - likely to enjoy, not yet explored', reason: { tag: adjacentTag.tag, via: adjacentTag.via || null, viaCategory: this.tagCategories?.[adjacentTag.via] || null } });
        usedTags.add(adjacentTag.tag);
      }
    }

    // Trending strategy: what is rising near the user's taste
    if (selectedStrategies.has('trending')) {
      const trendQuery = this.trendingQuery(tier1Pool, usedTags);
      if (trendQuery && !this.exhaustedStrategies.has(trendQuery.tags)) {
        queries.push(trendQuery);
        usedTags.add(trendQuery.tag);
      }
    }

    // Wildcard strategy
    if (selectedStrategies.has('wildcard')) {
      const wildcardOptions = ['order:rank age:<1mo', 'order:popular age:<1mo'];
      const wildcardQuery = wildcardOptions[Math.floor(Math.random() * wildcardOptions.length)];
      if (!this.exhaustedStrategies.has(wildcardQuery)) {
        queries.push({ tags: wildcardQuery, type: 'wildcard', intent: 'Global discovery - trending content' });
      }
    }

    // Fallback if no queries generated (bandit may have excluded all arms)
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

  /**
   * Tags that are strong in the slow core profile but weak in the current
   * one: favourites the user has drifted away from, worth resurfacing now
   * and then rather than letting them decay away entirely.
   */
  dormantInterests(limit = 10) {
    const core = Object.entries(this.rawCoreTagScores || {}).filter(([, score]) => score > 0);
    if (!core.length) return [];
    const maxCore = Math.max(...core.map(([, score]) => score));
    const avoided = new Set(this.avoidedTags);
    return core
      .map(([tag, score]) => ({ tag, core: score / maxCore, current: Math.max(0, this.tagScores?.[tag] || 0) }))
      .filter(item => item.core > 0.3 && item.current < item.core * 0.5 && !avoided.has(item.tag) && this.tagCategories[item.tag] !== 'meta')
      .map(item => ({ tag: item.tag, score: item.core - item.current }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Neighbours of the user's interests that the user has little history with. */
  adjacentInterests(limit = 10) {
    const interests = this.getQueryableTagsWithScores().slice(0, 25);
    const exclude = new Set([...this.avoidedTags, ...interests.map(item => item.tag), 'video']);
    for (const [tag, score] of Object.entries(this.tagScores || {})) if (score < -0.1) exclude.add(tag);
    for (const [tag, category] of Object.entries(this.tagCategories || {})) if (category === 'meta') exclude.add(tag);
    return this.tagGraph.adjacentTags(interests, tag => this.tagEngagement[tag] || 0, exclude, limit);
  }

  /**
   * A trending query near the user's taste: a rising tag they like or that
   * neighbours their interests, sorted by the booru's hot ranking. Before the
   * graph has seen enough trending batches, a core interest's hot posts.
   */
  trendingQuery(corePool, exclude = new Set()) {
    const adjacent = this.adjacentInterests(25);
    const top = adjacent[0]?.score || 1;
    const adjacency = new Map(adjacent.map(item => [item.tag, item.score / top]));
    const avoid = new Set([...this.avoidedTags, ...exclude, 'video']);
    const trends = this.tagGraph.personalTrends(tag => this.tagScores?.[tag] || 0, adjacency, avoid);
    const pick = this.weightedRandomSelect(trends, exclude) || this.weightedRandomSelect(corePool, exclude);
    if (!pick) return null;
    const personal = trends.some(item => item.tag === pick.tag);
    return { tag: pick.tag, tags: `${pick.tag} order:rank`, type: 'trending', intent: personal ? `Trending near your taste: "${pick.tag}"` : `Hot right now in "${pick.tag}"`, reason: { tag: pick.tag, personal } };
  }

  /** Learn the booru's tag structure from a batch of fetched candidates. */
  observeCandidates(posts) {
    if (!posts?.length) return;
    this.tagGraph.observe(posts.map(post => learningPost(post)), {
      interests: new Set(this.getQueryableTagsWithScores().slice(0, 60).map(item => item.tag)),
      avoided: new Set(this.avoidedTags),
      isTrending: post => /order:(rank|popular)/.test(post._searchCriteria || ''),
    });
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
  /**
   * Use the bandit to select the next query tag for normal (non-explore) mode.
   * The bandit picks a strategy arm; that strategy determines the tag pool and modifier.
   * Returns { tag, strategy, modifier } — the tag to append to the query.
   */
  selectBanditTag() {
    const topTagsWithScores = this.getQueryableTagsWithScores();
    if (topTagsWithScores.length === 0) {
      return { tag: null, strategy: 'fallback', modifier: null };
    }

    const filtered = topTagsWithScores.filter(t => t.tag !== 'video');
    const tier1Pool = filtered.slice(0, 10);
    const tier2Pool = filtered.slice(10, 25);

    // Pick arm via Thompson Sampling (single best)
    const selection = this.banditExplorer.selectArm();
    const strategy = selection.type;

    const pivotModifiers = ['age:>3mo', 'age:>1y', 'order:rank age:<1mo', 'order:favcount age:<1mo'];

    switch (strategy) {
      case 'anchor': {
        const pick = this.weightedRandomSelect(tier1Pool);
        return pick ? { tag: pick.tag, strategy, modifier: null } : { tag: null, strategy: 'fallback', modifier: null };
      }
      case 'pivot': {
        const pick = this.weightedRandomSelect(tier1Pool);
        const modifier = pivotModifiers[Math.floor(Math.random() * pivotModifiers.length)];
        return pick ? { tag: pick.tag, strategy, modifier } : { tag: null, strategy: 'fallback', modifier: null };
      }
      case 'reach': {
        if (tier2Pool.length === 0) {
          // Fallback to tier1 if tier2 empty
          const pick = this.weightedRandomSelect(tier1Pool);
          return pick ? { tag: pick.tag, strategy: 'reach', modifier: null } : { tag: null, strategy: 'fallback', modifier: null };
        }
        const pick = this.weightedRandomSelect(tier2Pool);
        return pick ? { tag: pick.tag, strategy, modifier: null } : { tag: null, strategy: 'fallback', modifier: null };
      }
      case 'adjacent': {
        const pick = this.weightedRandomSelect(this.adjacentInterests()) || this.weightedRandomSelect(tier2Pool.length ? tier2Pool : tier1Pool);
        return pick ? { tag: pick.tag, strategy, modifier: null } : { tag: null, strategy: 'fallback', modifier: null };
      }
      case 'trending': {
        const query = this.trendingQuery(tier1Pool);
        return query ? { tag: query.tag, strategy, modifier: 'order:rank' } : { tag: null, strategy: 'wildcard', modifier: 'order:rank age:<1mo' };
      }
      case 'wildcard': {
        // Wildcard returns a trending/popular query modifier, no specific tag
        return { tag: null, strategy: 'wildcard', modifier: 'order:rank age:<1mo' };
      }
      case 'fallback':
      default: {
        // Fallback: pick from top of tier1 (highest score) as safe default
        const pick = tier1Pool[0] || filtered[0];
        return { tag: pick ? pick.tag : null, strategy: 'fallback', modifier: null };
      }
    }
  }

  getMLStats() {
    if (!this.mlInitialized) {
      return { tagEmbeddings: null, mlScorer: null, bandit: null };
    }
    return {
      tagEmbeddings: this.tagEmbedding.getStats(),
      mlScorer: this.mlScorer.getStats(),
      bandit: this.banditExplorer.getStats(),
    };
  }
}

const core = new RecommendationWorkerCore();

// Handle incoming messages
if (typeof self !== 'undefined') self.onmessage = async (e) => {
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
      case 'refreshUserProfile':
        await core.refreshUserProfile();
        result = true;
        break;
      case 'resetRecommendations':
        await core.resetRecommendations();
        result = true;
        break;
      case 'factoryReset':
        core.factoryReset();
        result = true;
        break;
      case 'trackInteraction':
        await core.trackInteraction(payload.postId, payload.interactionType, payload.value, payload.postData, payload.updateImmediately, payload.context);
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
      case 'takeRecoveryPick':
        result = core.takeRecoveryPick(payload);
        break;
      case 'rankPosts':
        result = Array.isArray(payload) ? core.rankPosts(payload) : core.rankPosts(payload.posts, payload.context, payload.options);
        break;
      case 'observeCandidates':
        core.observeCandidates(payload);
        result = true;
        break;
      case 'assembleFeed':
        result = core.assembleFeed(payload.posts, payload.options);
        break;
      case 'setDeepDive':
        await core.setDeepDive(payload);
        result = true;
        break;
      case 'imageAnalysisReady': {
        const settings = await StorageService.loadAppSettings();
        const post = settings?.settings?.aiTaggingEnabled ? payload : { ...payload, imageAnalysis: { ...payload.imageAnalysis, aiTags: [] } };
        core.deepDive.refresh(learningPost(post));
        if (core.mlInitialized) core.mlScorer.refreshPostFeatures(post, core.tagScores, {
          ratingPreferences: core.ratingPreferences, mediaTypePreferences: core.mediaTypePreferences,
        });
        core.postScoreCache.clear();
        result = true;
        break;
      }
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
        result = core.buildRecommendedQueryParams(payload.includeUserTags);
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
      case 'selectBanditTag':
        result = core.selectBanditTag();
        break;
      case 'getMLStats':
        result = core.getMLStats();
        break;
      case 'findSimilarTags':
        result = tagEmbedding.findSimilarTags(payload.query, payload.topK || 10, new Set(payload.exclude || []));
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
