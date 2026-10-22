/**
 * GlobalTagGraph.js
 * What the booru looks like around the user's interests, learned from every
 * candidate post the feed fetches (not just the ones the user engaged with).
 *
 * TagEmbedding only sees the user's positives, so it knows nothing about
 * tags the user has never met, which is exactly where discovery happens.
 * This graph records, from the unlabeled candidate stream:
 *  - document frequency per tag (for IDF weighting of ubiquitous tags),
 *  - co-occurrence between the user's current interest tags and any other
 *    tag (to find adjacent interests),
 *  - frequency within trending batches (order:rank results) versus all
 *    batches (to find what is rising right now).
 * All counts decay with time and are capped, so the graph stays small and
 * follows the booru as it changes.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const DOC_HALF_LIFE_MS = 30 * DAY_MS;
export const TREND_HALF_LIFE_MS = 2 * DAY_MS;
const MAX_TAGS = 6000;
const MAX_NEIGHBORS = 120;
const MAX_INTERESTS = 60;

const splitTags = value => (value || '').split(/\s+/).filter(Boolean);
const decayFactor = (elapsed, halfLife) => Math.pow(0.5, Math.max(0, elapsed) / halfLife);

export function postTags(post) {
  return [...new Set([post.tag_string, post.tag_string_artist, post.tag_string_copyright, post.tag_string_character, post.tag_string_general].flatMap(splitTags))];
}

export class GlobalTagGraph {
  constructor(data = null, clock = Date.now) {
    this.clock = clock;
    this.docFreq = new Map(Object.entries(data?.docFreq || {}));
    this.trendFreq = new Map(Object.entries(data?.trendFreq || {}));
    this.neighbors = new Map(Object.entries(data?.neighbors || {}).map(([tag, map]) => [tag, new Map(Object.entries(map))]));
    this.totalDocs = data?.totalDocs || 0;
    this.totalTrend = data?.totalTrend || 0;
    this.lastDecay = data?.lastDecay || this.clock();
  }

  _decay() {
    const now = this.clock();
    const elapsed = now - this.lastDecay;
    if (elapsed < 60 * 60 * 1000) return; // hourly is plenty
    const doc = decayFactor(elapsed, DOC_HALF_LIFE_MS), trend = decayFactor(elapsed, TREND_HALF_LIFE_MS);
    for (const [tag, count] of this.docFreq) { const next = count * doc; if (next < 0.05) this.docFreq.delete(tag); else this.docFreq.set(tag, next); }
    for (const [tag, count] of this.trendFreq) { const next = count * trend; if (next < 0.05) this.trendFreq.delete(tag); else this.trendFreq.set(tag, next); }
    for (const map of this.neighbors.values()) for (const [tag, count] of map) map.set(tag, count * doc);
    this.totalDocs *= doc; this.totalTrend *= trend; this.lastDecay = now;
  }

  /**
   * @param {Object[]} posts - candidate posts from one fetch
   * @param {Object} options
   * @param {Set<string>} options.interests - the user's current top tags
   * @param {Set<string>} options.avoided - tags that carry no taste signal
   * @param {(post) => boolean} options.isTrending - whether a post came from a trending query
   */
  observe(posts, { interests = new Set(), avoided = new Set(), isTrending = () => false } = {}) {
    this._decay();
    const tracked = [...interests].slice(0, MAX_INTERESTS);
    for (const post of posts) {
      const tags = postTags(post).filter(tag => !avoided.has(tag));
      if (!tags.length) continue;
      const trending = isTrending(post);
      this.totalDocs += 1;
      if (trending) this.totalTrend += 1;
      for (const tag of tags) {
        this.docFreq.set(tag, (this.docFreq.get(tag) || 0) + 1);
        if (trending) this.trendFreq.set(tag, (this.trendFreq.get(tag) || 0) + 1);
      }
      const present = new Set(tags);
      for (const interest of tracked) {
        if (!present.has(interest)) continue;
        let map = this.neighbors.get(interest);
        if (!map) this.neighbors.set(interest, map = new Map());
        for (const tag of tags) if (tag !== interest) map.set(tag, (map.get(tag) || 0) + 1);
      }
    }
    this._prune(new Set(tracked));
  }

  _prune(keepInterests) {
    if (this.docFreq.size > MAX_TAGS) {
      const kept = [...this.docFreq].sort((a, b) => b[1] - a[1]).slice(0, MAX_TAGS);
      this.docFreq = new Map(kept);
      for (const tag of this.trendFreq.keys()) if (!this.docFreq.has(tag)) this.trendFreq.delete(tag);
    }
    for (const [interest, map] of this.neighbors) {
      if (map.size > MAX_NEIGHBORS * 1.5) this.neighbors.set(interest, new Map([...map].sort((a, b) => b[1] - a[1]).slice(0, MAX_NEIGHBORS)));
    }
    if (this.neighbors.size > MAX_INTERESTS * 2) {
      for (const interest of [...this.neighbors.keys()]) {
        if (this.neighbors.size <= MAX_INTERESTS) break;
        if (!keepInterests.has(interest)) this.neighbors.delete(interest);
      }
    }
  }

  /** Smoothed inverse document frequency; ubiquitous tags approach 0. */
  idf(tag) {
    if (this.totalDocs < 50) return 1;
    const df = this.docFreq.get(tag) || 0;
    return Math.max(0, Math.min(1, Math.log((this.totalDocs + 1) / (df + 1)) / Math.log(this.totalDocs + 1) * 1.5));
  }

  /**
   * Tags that keep showing up alongside the user's interests but that the
   * user has little history with: the next most likely things to enjoy.
   * @param {Array<{tag, score}>} interests - weighted top tags
   * @param {(tag) => number} familiarity - user's existing evidence per tag
   * @param {Set<string>} exclude
   */
  adjacentTags(interests, familiarity = () => 0, exclude = new Set(), limit = 10) {
    const scores = new Map();
    // The interest each tag owes most of its score to, for "close to X".
    const via = new Map();
    for (const { tag: interest, score: weight } of interests) {
      const map = this.neighbors.get(interest);
      const base = this.docFreq.get(interest) || 0;
      if (!map || base < 3) continue;
      for (const [tag, count] of map) {
        if (exclude.has(tag) || count < 2) continue;
        // Lift: how much more often the tag appears with this interest than overall.
        const lift = (count / base) / Math.max(1e-6, (this.docFreq.get(tag) || count) / Math.max(1, this.totalDocs));
        if (lift < 1.5) continue;
        const value = weight * Math.log(lift) * this.idf(tag) * Math.min(1, count / 5);
        scores.set(tag, (scores.get(tag) || 0) + value);
        if (value > (via.get(tag)?.value ?? -Infinity)) via.set(tag, { interest, value });
      }
    }
    return [...scores]
      .map(([tag, score]) => ({ tag, score: score / (1 + familiarity(tag)), via: via.get(tag)?.interest }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** How strongly a tag is over-represented in trending batches right now. */
  trendLift(tag) {
    if (this.totalTrend < 20) return 0;
    const trend = (this.trendFreq.get(tag) || 0) / this.totalTrend;
    const base = (this.docFreq.get(tag) || 0) / Math.max(1, this.totalDocs);
    if ((this.trendFreq.get(tag) || 0) < 3 || !base) return 0;
    return trend / base;
  }

  /**
   * Trending tags near the user's taste: rising in trending batches and
   * either already liked or adjacent to what is liked.
   * @param {(tag) => number} affinity - user's affinity per tag (-1..1)
   * @param {Map<string, number>} adjacency - adjacent tag -> score
   */
  personalTrends(affinity = () => 0, adjacency = new Map(), exclude = new Set(), limit = 8) {
    const results = [];
    for (const tag of this.trendFreq.keys()) {
      if (exclude.has(tag)) continue;
      const lift = this.trendLift(tag);
      if (lift < 1.3) continue;
      const closeness = Math.max(affinity(tag), adjacency.get(tag) || 0);
      if (closeness <= 0) continue;
      results.push({ tag, score: Math.log(lift) * closeness * this.idf(tag) });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  toSnapshot() {
    return {
      docFreq: Object.fromEntries(this.docFreq),
      trendFreq: Object.fromEntries(this.trendFreq),
      neighbors: Object.fromEntries([...this.neighbors].map(([tag, map]) => [tag, Object.fromEntries(map)])),
      totalDocs: this.totalDocs, totalTrend: this.totalTrend, lastDecay: this.lastDecay,
    };
  }
}
