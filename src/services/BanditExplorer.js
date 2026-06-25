/**
 * BanditExplorer.js
 * Thompson Sampling-based multi-armed bandit for optimizing exploration strategies.
 *
 * Each "arm" is a query strategy (anchor, pivot, reach, wildcard, fallback).
 * The reward signal is user engagement: likes, favorites, and time-spent > threshold.
 *
 * Thompson Sampling maintains a Beta distribution per arm:
 *   - Alpha = number of positive engagements + 1 (prior)
 *   - Beta = number of non-engagements + 1 (prior)
 *   - At each decision point, sample from each Beta distribution and pick the highest
 *
 * This naturally balances exploration vs exploitation:
 *   - Well-performing strategies get tried more (exploitation)
 *   - Uncertain strategies still get sampled (exploration)
 *   - As confidence grows, the best strategy dominates
 *
 * Arms also have "contextual decay" — if a strategy stops yielding good results,
 * its alpha is periodically down-weighted to allow re-exploration.
 */

const STRATEGY_TYPES = ['anchor', 'pivot', 'reach', 'wildcard', 'fallback'];
const PRIOR_ALPHA = 1.0;   // Beta prior
const PRIOR_BETA = 1.0;
const DECAY_RATE = 0.95;   // Per-session decay for alpha (engagement decay)
const MIN_HISTORY = 3;     // Minimum samples before we trust the distribution
const REWARD_THRESHOLD = 0.5;  // Engagement score above this = "success"

class BanditArm {
  constructor(type) {
    this.type = type;
    this.alpha = PRIOR_ALPHA;
    this.beta = PRIOR_BETA;
    this.totalAttempts = 0;
    this.successes = 0;
    this.lastUsed = 0;
    this.consecutiveFailures = 0;
  }

  /**
   * Sample from the Beta distribution using the Cheng algorithm.
   */
  sample() {
    // For Beta(α, β): sample from Gamma(α, 1) / (Gamma(α, 1) + Gamma(β, 1))
    // We use a simple approximation for small α, β values
    const x = this._gammaSample(this.alpha);
    const y = this._gammaSample(this.beta);
    return x / (x + y);
  }

  /**
   * Update the posterior with a reward observation.
   * @param {number} reward - Engagement score in [0, 1]
   */
  update(reward) {
    this.totalAttempts++;
    this.lastUsed = Date.now();

    if (reward >= REWARD_THRESHOLD) {
      this.successes++;
      this.consecutiveFailures = 0;
      // Increment alpha proportionally to reward strength
      this.alpha += reward;
    } else {
      this.consecutiveFailures++;
      // Increment beta for non-reward
      this.beta += (1 - reward);
    }
  }

  /**
   * Apply temporal decay to allow re-exploration of previously good arms.
   */
  applyDecay() {
    // Decay alpha more aggressively than beta to favor re-exploration
    this.alpha = PRIOR_ALPHA + (this.alpha - PRIOR_ALPHA) * DECAY_RATE;
    this.beta = PRIOR_BETA + (this.beta - PRIOR_BETA) * DECAY_RATE;
  }

  /**
   * Get the expected reward (mean of Beta distribution).
   */
  getExpectedReward() {
    return this.alpha / (this.alpha + this.beta);
  }

  /**
   * Get uncertainty (variance of Beta distribution).
   */
  getUncertainty() {
    const sum = this.alpha + this.beta;
    return (this.alpha * this.beta) / (sum * sum * (sum + 1));
  }

  /**
   * Serialize for storage.
   */
  toSnapshot() {
    return {
      type: this.type,
      alpha: this.alpha,
      beta: this.beta,
      totalAttempts: this.totalAttempts,
      successes: this.successes,
      lastUsed: this.lastUsed,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  /**
   * Restore from snapshot.
   */
  static fromSnapshot(data) {
    const arm = new BanditArm(data.type);
    arm.alpha = data.alpha;
    arm.beta = data.beta;
    arm.totalAttempts = data.totalAttempts;
    arm.successes = data.successes;
    arm.lastUsed = data.lastUsed;
    arm.consecutiveFailures = data.consecutiveFailures;
    return arm;
  }

  /**
   * Gamma distribution sample using the Cheng-Tsao algorithm.
   */
  _gammaSample(shape) {
    if (shape < 1) {
      // Use boost method for shape < 1
      return this._gammaSample(shape + 1) * Math.pow(Math.random(), 1 / shape);
    }

    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);

    while (true) {
      let x, v;
      do {
        x = this._normalSample();
        v = 1 + c * x;
      } while (v <= 0);

      v = v * v * v;
      const u = Math.random();

      if (u < 1 - 0.0331 * x * x * x * x) {
        return d * v;
      }
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
        return d * v;
      }
    }
  }

  /**
   * Standard normal sample using Box-Muller transform.
   */
  _normalSample() {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

class BanditExplorer {
  constructor() {
    this.arms = new Map();
    this.sessionCount = 0;
    this.totalRewards = 0;
    this.rewardHistory = [];
    this._initializeArms();
  }

  _initializeArms() {
    for (const type of STRATEGY_TYPES) {
      this.arms.set(type, new BanditArm(type));
    }
  }

  /**
   * Initialize from stored snapshot.
   */
  init(snapshot) {
    if (snapshot && snapshot.arms) {
      this.arms = new Map();
      for (const armData of snapshot.arms) {
        this.arms.set(armData.type, BanditArm.fromSnapshot(armData));
      }
    }
    this.sessionCount = snapshot?.sessionCount || 0;
    this.totalRewards = snapshot?.totalRewards || 0;
    this.rewardHistory = snapshot?.rewardHistory || [];
  }

  /**
   * Select the best strategy arm using Thompson Sampling.
   * @param {Object} context - Optional context for future contextual bandit extension
   * @returns {{ type: string, sampledValue: number }}
   */
  selectArm(context = null) {
    let bestArm = null;
    let bestSample = -Infinity;

    for (const [type, arm] of this.arms) {
      // Skip exhausted strategies
      if (type === 'fallback') continue;

      const sample = arm.sample();
      if (sample > bestSample) {
        bestSample = sample;
        bestArm = type;
      }
    }

    // Fallback if all arms are exhausted
    if (!bestArm) {
      bestArm = 'fallback';
      bestSample = 0;
    }

    return { type: bestArm, sampledValue: bestSample };
  }

  /**
   * Select top-K arms for multi-strategy queries.
   * @param {number} k
   * @returns {Array<{ type: string, sampledValue: number }>}
   */
  selectTopK(k = 3) {
    const samples = [];
    for (const [type, arm] of this.arms) {
      samples.push({ type, sampledValue: arm.sample() });
    }
    samples.sort((a, b) => b.sampledValue - a.sampledValue);
    return samples.slice(0, k);
  }

  /**
   * Record a reward for a strategy.
   * @param {string} strategyType
   * @param {number} reward - Engagement score in [0, 1]
   */
  recordReward(strategyType, reward) {
    const arm = this.arms.get(strategyType);
    if (!arm) return;

    arm.update(reward);
    this.totalRewards += reward;
    this.rewardHistory.push({ strategy: strategyType, reward, timestamp: Date.now() });

    // Keep history bounded
    if (this.rewardHistory.length > 200) {
      this.rewardHistory = this.rewardHistory.slice(-100);
    }
  }

  /**
   * End the current session — apply decay and increment counter.
   */
  endSession() {
    this.sessionCount++;
    for (const arm of this.arms.values()) {
      arm.applyDecay();
    }
  }

  /**
   * Get the current best strategy (highest expected reward).
   */
  getBestStrategy() {
    let bestType = 'anchor';
    let bestExpected = -1;

    for (const [type, arm] of this.arms) {
      const expected = arm.getExpectedReward();
      if (expected > bestExpected) {
        bestExpected = expected;
        bestType = type;
      }
    }

    return { type: bestType, expectedReward: bestExpected };
  }

  /**
   * Get statistics about the bandit.
   */
  getStats() {
    const arms = {};
    for (const [type, arm] of this.arms) {
      arms[type] = {
        alpha: arm.alpha,
        beta: arm.beta,
        expectedReward: arm.getExpectedReward(),
        uncertainty: arm.getUncertainty(),
        attempts: arm.totalAttempts,
        successes: arm.successes,
        consecutiveFailures: arm.consecutiveFailures,
      };
    }

    return {
      sessionCount: this.sessionCount,
      totalRewards: this.totalRewards,
      avgReward: this.rewardHistory.length > 0
        ? this.totalRewards / this.rewardHistory.length
        : 0,
      arms,
      bestStrategy: this.getBestStrategy(),
    };
  }

  /**
   * Serialize for storage.
   */
  toSnapshot() {
    return {
      arms: Array.from(this.arms.values()).map(arm => arm.toSnapshot()),
      sessionCount: this.sessionCount,
      totalRewards: this.totalRewards,
      rewardHistory: this.rewardHistory.slice(-50),
    };
  }

  /**
   * Reset all arms to prior.
   */
  reset() {
    this.arms.clear();
    this._initializeArms();
    this.sessionCount = 0;
    this.totalRewards = 0;
    this.rewardHistory = [];
  }
}

export const banditExplorer = new BanditExplorer();
export default banditExplorer;
