/**
 * FeedMetrics.js
 * How well the feed is doing, computed on-device from stored interactions.
 *
 * Every impression's watch time is logged with the post as it was shown,
 * including the ranking score it had (_score), whether it filled an
 * exploration slot (_explore) and which strategy fetched it (_strategy).
 * That makes progressive validation possible without retraining anything:
 * the score was predicted before the user reacted, so its AUC against what
 * happened next measures the ranker honestly.
 */
import { engagementLabel, SKIP_LABEL } from './signals.js';
import { postKey } from './postKey.js';

export const SESSION_GAP_MS = 15 * 60 * 1000;
export const POSITIVE_LABEL = 0.6;

/** Probability that a random positive impression outscored a random negative one. */
export function auc(pairs, minEach = 1) {
  const sorted = pairs.filter(pair => Number.isFinite(pair.score)).sort((a, b) => a.score - b.score);
  let positives = 0, negatives = 0, rankSum = 0;
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && sorted[j].score === sorted[i].score) j++;
    const averageRank = (i + j + 1) / 2; // 1-based, ties share their rank
    for (let k = i; k < j; k++) if (sorted[k].positive) { positives++; rankSum += averageRank; } else negatives++;
    i = j;
  }
  if (positives < minEach || negatives < minEach) return null;
  return (rankSum - positives * (positives + 1) / 2) / (positives * negatives);
}

const rate = (count, total) => (total ? count / total : null);
const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * @param {Object[]} interactions - stored interactions (any order)
 * @param {Object} [options]
 * @param {number} [options.since] - ignore interactions before this timestamp
 */
export function computeFeedMetrics(interactions, { since = 0 } = {}) {
  const events = interactions
    .filter(item => item.timestamp >= since && !item.metadata?.deepDive && item.metadata?.post)
    .sort((a, b) => a.timestamp - b.timestamp);

  // One record per shown post: its first impression, best reaction overall
  // (a like is logged before the watch time that closes the impression).
  const best = new Map();
  for (const event of events) {
    const label = engagementLabel(event.type, event.value, event.metadata.engagement);
    if (label === undefined) continue;
    const key = postKey(event.metadata.post);
    best.set(key, Math.max(best.get(key) ?? 0, label));
  }
  const impressions = new Map();
  for (const event of events) {
    const key = postKey(event.metadata.post);
    if (event.type !== 'timeSpent' || impressions.has(key)) continue;
    const post = event.metadata.post;
    impressions.set(key, {
      timestamp: event.timestamp, dwell: engagementLabel('timeSpent', event.value, event.metadata.engagement),
      best: best.get(key) ?? 0, score: post._score, explore: !!post._explore, strategy: post._strategy || 'unknown',
    });
  }
  const shown = [...impressions.values()];
  const isPositive = item => item.best >= POSITIVE_LABEL;
  const likes = events.filter(event => ['like', 'favorite'].includes(event.type) && event.value).length;

  const group = (items) => ({ impressions: items.length, positiveRate: rate(items.filter(isPositive).length, items.length) });
  const byStrategy = {};
  for (const item of shown) (byStrategy[item.strategy] ||= []).push(item);

  const sessions = [];
  for (const item of shown) {
    const last = sessions[sessions.length - 1];
    if (last && item.timestamp - last.end < SESSION_GAP_MS) { last.end = item.timestamp; last.impressions++; }
    else sessions.push({ start: item.timestamp, end: item.timestamp, impressions: 1 });
  }

  return {
    impressions: shown.length,
    skipRate: rate(shown.filter(item => item.dwell !== undefined && item.dwell <= SKIP_LABEL).length, shown.length),
    positiveRate: rate(shown.filter(isPositive).length, shown.length),
    likesPer100: shown.length ? (likes / shown.length) * 100 : null,
    // Needs a handful of each side before the number means anything.
    auc: auc(shown.filter(item => item.best >= POSITIVE_LABEL || item.best <= SKIP_LABEL)
      .map(item => ({ score: item.score, positive: isPositive(item) })), 5),
    exploration: { explore: group(shown.filter(item => item.explore)), exploit: group(shown.filter(item => !item.explore)) },
    byStrategy: Object.fromEntries(Object.entries(byStrategy).map(([name, items]) => [name, group(items)])),
    sessions: {
      count: sessions.length,
      medianMinutes: median(sessions.map(session => (session.end - session.start) / 60000)),
      medianImpressions: median(sessions.map(session => session.impressions)),
    },
  };
}
