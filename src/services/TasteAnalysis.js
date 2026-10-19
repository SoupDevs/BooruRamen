/**
 * TasteAnalysis.js
 * Turns stored interactions into an explainable picture of the user's taste:
 * which tags they respond to (and the evidence for each), how they engage,
 * what is rising or fading, and how their interests connect.
 *
 * Everything is computed from the same signals the recommender learns from
 * (signals.js), so the page explains the feed rather than a parallel model.
 * Pure functions, no storage access: the view passes interactions in.
 */
import { engagementLabel, SKIP_LABEL, isVideoPost } from './signals.js';
import { postKey } from './postKey.js';

const DAY = 24 * 60 * 60 * 1000;
export const POSITIVE = 0.6;
export const RECENT_DAYS = 7;
export const BASELINE_DAYS = 30;
const SESSION_GAP = 15 * 60 * 1000;
// Pseudo-impressions pulling a tag's engagement rate toward the user's
// average, so three lucky posts do not outrank thirty solid ones.
const PRIOR_STRENGTH = 6;
const MIN_IMPRESSIONS = 3;
export const CATEGORIES = ['artist', 'copyright', 'character', 'general'];
const ACTION_TYPES = ['like', 'favorite', 'download', 'share', 'revisit', 'deepDive', 'tagTap', 'comments', 'details', 'unmute', 'dislike', 'report'];

const split = value => (value || '').split(/\s+/).filter(Boolean);

function categorisedTags(post) {
  const result = new Map();
  for (const category of CATEGORIES) for (const tag of split(post[`tag_string_${category}`])) result.set(tag, category);
  for (const tag of split(post.tag_string_meta)) result.set(tag, 'meta');
  if (!result.size) for (const tag of split(post.tag_string || post.tags)) result.set(tag, 'general');
  return result;
}

const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * One record per post the user saw or acted on, outside Deep Dives (a dive
 * reflects one chosen post, not the user's taste at large).
 */
export function buildImpressions(interactions) {
  const byPost = new Map();
  for (const event of [...interactions].sort((a, b) => a.timestamp - b.timestamp)) {
    const post = event.metadata?.post;
    if (!post || event.metadata?.deepDive) continue;
    const key = postKey(post);
    let impression = byPost.get(key);
    if (!impression) {
      impression = { key, post, timestamp: event.timestamp, best: null, dwellMs: 0, dwellLabel: null, duration: null, actions: {}, timeSpentCount: 0 };
      byPost.set(key, impression);
    }
    if (event.type === 'timeSpent') {
      impression.dwellMs += event.value || 0;
      impression.timeSpentCount++;
      const label = engagementLabel('timeSpent', event.value, event.metadata.engagement);
      impression.dwellLabel = Math.max(impression.dwellLabel ?? 0, label);
      if (event.metadata.mediaDuration) impression.duration = event.metadata.mediaDuration;
    } else if (event.value) {
      impression.actions[event.type] = (impression.actions[event.type] || 0) + 1;
    }
    const label = engagementLabel(event.type, event.value, event.metadata.engagement);
    if (label !== undefined) impression.best = Math.max(impression.best ?? 0, label);
  }
  return [...byPost.values()].filter(impression => impression.best !== null);
}

/**
 * @param {Object[]} interactions - stored interactions
 * @param {Object} [options]
 * @param {Iterable<string>} [options.avoided] - tags that carry no taste signal
 * @param {number} [options.now]
 */
export function analyzeTaste(interactions, { avoided = [], now = Date.now() } = {}) {
  const avoidedSet = new Set(avoided);
  const impressions = buildImpressions(interactions);
  const isPositive = impression => impression.best >= POSITIVE;
  const positives = impressions.filter(isPositive);
  const baseRate = impressions.length ? (positives.length + 1) / (impressions.length + 2) : 0.5;
  const recentSince = now - RECENT_DAYS * DAY;
  const baselineSince = recentSince - BASELINE_DAYS * DAY;

  // Per-tag evidence
  const tags = new Map();
  for (const impression of impressions) {
    const positive = isPositive(impression);
    const skipped = impression.timeSpentCount > 0 && impression.dwellLabel <= SKIP_LABEL && !positive;
    const video = isVideoPost(impression.post);
    const completed = video && impression.duration && impression.dwellMs / 1000 >= impression.duration;
    for (const [tag, category] of categorisedTags(impression.post)) {
      if (category === 'meta' || avoidedSet.has(tag)) continue;
      let entry = tags.get(tag);
      if (!entry) {
        entry = { tag, category, impressions: 0, positives: 0, skips: 0, completions: 0, actions: {}, recentImpressions: 0, recentPositives: 0, baselineImpressions: 0, baselinePositives: 0, firstPositive: null, lastSeen: 0 };
        tags.set(tag, entry);
      }
      entry.impressions++;
      if (positive) { entry.positives++; entry.firstPositive ??= impression.timestamp; }
      if (skipped) entry.skips++;
      if (completed) entry.completions++;
      for (const [type, count] of Object.entries(impression.actions)) entry.actions[type] = (entry.actions[type] || 0) + count;
      if (impression.timestamp >= recentSince) { entry.recentImpressions++; if (positive) entry.recentPositives++; }
      else if (impression.timestamp >= baselineSince) { entry.baselineImpressions++; if (positive) entry.baselinePositives++; }
      entry.lastSeen = Math.max(entry.lastSeen, impression.timestamp);
    }
  }
  for (const entry of tags.values()) {
    const rate = (entry.positives + PRIOR_STRENGTH * baseRate) / (entry.impressions + PRIOR_STRENGTH);
    entry.rate = entry.positives / entry.impressions;
    entry.lift = rate / baseRate;
    // Strength combines how much better than average the tag does with how
    // much evidence there is; disliked/skipped tags go negative.
    const deliberate = (entry.actions.like || 0) + 2 * (entry.actions.favorite || 0) + 2 * (entry.actions.download || 0)
      + 2 * (entry.actions.share || 0) + (entry.actions.revisit || 0) + 2 * (entry.actions.deepDive || 0) + (entry.actions.tagTap || 0)
      - 2 * (entry.actions.dislike || 0) - 3 * (entry.actions.report || 0);
    entry.score = Math.log(entry.lift) * Math.log1p(entry.impressions) + 0.15 * deliberate;
  }
  const qualified = [...tags.values()].filter(entry => entry.impressions >= MIN_IMPRESSIONS || (entry.actions.favorite || entry.actions.download));
  const liked = qualified.filter(entry => entry.score > 0 && entry.positives > 0).sort((a, b) => b.score - a.score);
  const topByCategory = Object.fromEntries(CATEGORIES.map(category => [category, liked.filter(entry => entry.category === category).slice(0, 6)]));
  const avoidedTags = qualified
    .filter(entry => entry.impressions >= 5 && entry.lift < 0.6 && (entry.skips / entry.impressions >= 0.5 || entry.actions.dislike))
    .sort((a, b) => a.score - b.score)
    .slice(0, 6);

  // Trends: engagement rate in the last week against the month before.
  const rising = [], fading = [], newInterests = [];
  for (const entry of liked.slice(0, 80)) {
    const recentRate = entry.recentImpressions ? entry.recentPositives / entry.recentImpressions : null;
    const baselineRate = entry.baselineImpressions ? entry.baselinePositives / entry.baselineImpressions : null;
    if (entry.firstPositive >= recentSince && entry.recentPositives >= 3) newInterests.push(entry);
    else if (recentRate !== null && baselineRate !== null && entry.recentPositives >= 2 && entry.baselineImpressions >= 3 && recentRate > baselineRate * 1.5 + 0.05) rising.push(entry);
    if (entry.baselinePositives >= 3 && entry.recentPositives === 0) fading.push(entry);
  }

  // Engagement style
  const images = impressions.filter(impression => !isVideoPost(impression.post) && impression.timeSpentCount);
  const videos = impressions.filter(impression => isVideoPost(impression.post) && impression.timeSpentCount);
  const timed = impressions.filter(impression => impression.timeSpentCount);
  const withDuration = videos.filter(impression => impression.duration);
  const actionCounts = Object.fromEntries(ACTION_TYPES.map(type => [type, impressions.reduce((sum, impression) => sum + (impression.actions[type] || 0), 0)]));
  const silent = positives.filter(impression => !impression.actions.like && !impression.actions.favorite).length;
  const hours = new Array(24).fill(0);
  for (const impression of timed) hours[new Date(impression.timestamp).getHours()]++;
  const sessions = [];
  for (const impression of timed) {
    const last = sessions[sessions.length - 1];
    if (last && impression.timestamp - last.end < SESSION_GAP) { last.end = impression.timestamp + impression.dwellMs; last.count++; }
    else sessions.push({ start: impression.timestamp, end: impression.timestamp + impression.dwellMs, count: 1 });
  }
  const skipRate = list => (list.length ? list.filter(impression => impression.dwellLabel <= SKIP_LABEL && !isPositive(impression)).length / list.length : null);

  const engagement = {
    impressions: impressions.length,
    positiveRate: impressions.length ? positives.length / impressions.length : null,
    skipRate: skipRate(timed),
    activeMinutes: timed.reduce((sum, impression) => sum + impression.dwellMs, 0) / 60000,
    silentShare: positives.length ? silent / positives.length : null,
    actions: actionCounts,
    images: { count: images.length, skipRate: skipRate(images), medianSeconds: median(images.map(impression => impression.dwellMs / 1000)), positiveRate: images.length ? images.filter(isPositive).length / images.length : null },
    videos: {
      count: videos.length, skipRate: skipRate(videos),
      completionRate: withDuration.length ? withDuration.filter(impression => impression.dwellMs / 1000 >= impression.duration).length / withDuration.length : null,
      rewatchRate: withDuration.length ? withDuration.filter(impression => impression.dwellMs / 1000 >= impression.duration * 1.9).length / withDuration.length : null,
      positiveRate: videos.length ? videos.filter(isPositive).length / videos.length : null,
    },
    hours,
    sessions: { count: sessions.length, medianMinutes: median(sessions.map(session => (session.end - session.start) / 60000)), medianPosts: median(sessions.map(session => session.count)) },
    daysActive: new Set(timed.map(impression => new Date(impression.timestamp).toDateString())).size,
  };

  const deepDives = interactions
    .filter(event => event.type === 'deepDive' && event.value && event.metadata?.post)
    .map(event => ({ post: event.metadata.post, timestamp: event.timestamp }));

  return {
    tags, liked, topByCategory, avoidedTags, rising: rising.slice(0, 5), fading: fading.slice(0, 5), newInterests: newInterests.slice(0, 5),
    engagement, deepDives, baseRate, graph: buildTagGraph(impressions.filter(isPositive), liked.slice(0, 40)),
  };
}

/**
 * Nodes: the strongest liked tags. Edges: how often two of them appear
 * together on posts the user engaged with (Jaccard), keeping each node's
 * strongest few links so the map shows structure instead of a hairball.
 */
export function buildTagGraph(positiveImpressions, topTags, { maxEdgesPerNode = 4, minJaccard = 0.12 } = {}) {
  const index = new Map(topTags.map((entry, i) => [entry.tag, i]));
  const counts = new Array(topTags.length).fill(0);
  const pairs = new Map();
  for (const impression of positiveImpressions) {
    const present = [...categorisedTags(impression.post).keys()].filter(tag => index.has(tag)).map(tag => index.get(tag));
    for (const i of present) counts[i]++;
    for (let a = 0; a < present.length; a++) for (let b = a + 1; b < present.length; b++) {
      const key = present[a] < present[b] ? `${present[a]}:${present[b]}` : `${present[b]}:${present[a]}`;
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
  }
  const candidates = [...pairs].map(([key, together]) => {
    const [a, b] = key.split(':').map(Number);
    return { source: a, target: b, together, weight: together / (counts[a] + counts[b] - together) };
  }).filter(edge => edge.weight >= minJaccard && edge.together >= 2).sort((x, y) => y.weight - x.weight);
  const degree = new Array(topTags.length).fill(0);
  const edges = [];
  for (const edge of candidates) {
    if (degree[edge.source] >= maxEdgesPerNode && degree[edge.target] >= maxEdgesPerNode) continue;
    degree[edge.source]++; degree[edge.target]++;
    edges.push(edge);
  }
  return { nodes: topTags.map(entry => ({ tag: entry.tag, category: entry.category, score: entry.score, positives: entry.positives })), edges };
}

/**
 * Deterministic force-directed layout (no randomness, so the map does not
 * jump between visits). Positions are in a unit square, padded.
 */
export function layoutGraph(graph, { iterations = 300 } = {}) {
  const n = graph.nodes.length;
  if (!n) return [];
  const nodes = graph.nodes.map((node, i) => {
    // Golden-angle spiral start: strongest tags near the centre.
    const radius = 0.4 * Math.sqrt((i + 0.5) / n), angle = i * 2.399963;
    return { ...node, x: 0.5 + radius * Math.cos(angle), y: 0.5 + radius * Math.sin(angle), vx: 0, vy: 0 };
  });
  const ideal = 0.9 / Math.sqrt(n + 1);
  for (let step = 0; step < iterations; step++) {
    const cooling = 1 - step / iterations;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = a.x - b.x, dy = a.y - b.y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const force = (ideal * ideal) / distance * 0.02;
      dx /= distance; dy /= distance;
      a.vx += dx * force; a.vy += dy * force; b.vx -= dx * force; b.vy -= dy * force;
    }
    for (const edge of graph.edges) {
      const a = nodes[edge.source], b = nodes[edge.target];
      const dx = b.x - a.x, dy = b.y - a.y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const force = (distance - ideal) * 0.08 * (0.5 + edge.weight);
      a.vx += dx / distance * force; a.vy += dy / distance * force; b.vx -= dx / distance * force; b.vy -= dy / distance * force;
    }
    for (const node of nodes) {
      node.vx += (0.5 - node.x) * 0.03; node.vy += (0.5 - node.y) * 0.03; // gravity keeps it compact
      const speed = Math.hypot(node.vx, node.vy), cap = 0.03 * cooling + 0.002;
      if (speed > cap) { node.vx *= cap / speed; node.vy *= cap / speed; }
      // Padded so labels under the bottom row and long names at the sides fit.
      node.x = Math.min(0.92, Math.max(0.08, node.x + node.vx));
      node.y = Math.min(0.88, Math.max(0.06, node.y + node.vy));
      node.vx *= 0.5; node.vy *= 0.5;
    }
  }
  return nodes;
}
