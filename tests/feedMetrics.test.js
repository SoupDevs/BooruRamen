import { describe, expect, it } from 'vitest';
import { auc, computeFeedMetrics } from '../src/services/FeedMetrics.js';

const shown = (id, extra = {}) => ({ id, source: 'src', _strategy: 'anchor', ...extra });
const event = (timestamp, type, value, post, metadata = {}) => ({ timestamp, type, value, metadata: { post, ...metadata } });

describe('feed metrics', () => {
  it('computes AUC with ties', () => {
    expect(auc([{ score: 0.9, positive: true }, { score: 0.1, positive: false }])).toBe(1);
    expect(auc([{ score: 0.5, positive: true }, { score: 0.5, positive: false }])).toBe(0.5);
    expect(auc([{ score: 0.5, positive: true }])).toBeNull();
  });
  it('scores impressions by their best reaction, including a like before leaving', () => {
    const liked = shown(1, { _score: 0.8 }), skipped = shown(2, { _score: 0.3, _explore: true, _strategy: 'adjacent' });
    const metrics = computeFeedMetrics([
      event(1000, 'like', 1, liked),
      event(2000, 'timeSpent', 1500, liked),
      event(3000, 'timeSpent', 500, skipped, { engagement: 0.1 }),
      event(4000, 'timeSpent', 9000, shown(3), { deepDive: true }),
    ]);
    expect(metrics.impressions).toBe(2);
    expect(metrics.positiveRate).toBe(0.5);
    expect(metrics.skipRate).toBe(1); // both impressions were short; the like still counts as engaged
    expect(metrics.likesPer100).toBe(50);
    expect(metrics.auc).toBeNull(); // too few scored impressions to judge
    expect(metrics.exploration.explore).toEqual({ impressions: 1, positiveRate: 0 });
    expect(metrics.byStrategy.anchor.positiveRate).toBe(1);
  });
  it('splits sessions on long gaps', () => {
    const minute = 60 * 1000;
    const metrics = computeFeedMetrics([0, 2, 4, 60, 61].map((m, i) => event(m * minute, 'timeSpent', 5000, shown(i))));
    expect(metrics.sessions.count).toBe(2);
    expect(metrics.sessions.medianMinutes).toBe(2.5);
  });
});
