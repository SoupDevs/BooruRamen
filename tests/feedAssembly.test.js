import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({
  storeInteraction: vi.fn(async () => true), loadAppSettings: vi.fn(async () => ({})),
  getPreferences: vi.fn(async () => ({})), getProfileSnapshot: vi.fn(async () => null),
  getInteractions: vi.fn(async () => []), storeProfileSnapshot: vi.fn(async () => {}),
}));
vi.mock('../src/services/StorageService', () => ({ default: storage }));
vi.mock('../src/services/ImageAnalysisCache.js', () => ({ hydrateImageAnalysis: async () => {} }));
import { RecommendationWorkerCore } from '../src/workers/recommendation.worker.js';
import { diversify, redundancy } from '../src/services/Diversity.js';
import { SessionInterest } from '../src/services/SessionInterest.js';
import { MLScorer } from '../src/services/MLScorer.js';

const post = (id, { artist = `artist${id}`, tags = 'scenery', ...extra } = {}) => ({
  id, source: 'source', tag_string: `${artist} ${tags}`, tag_string_artist: artist, tag_string_general: tags, file_ext: 'jpg', ...extra,
});
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Math, 'random').mockReturnValue(0); });
afterEach(() => vi.restoreAllMocks());

describe('diversity', () => {
  it('treats shared artists and near-identical hashes as redundant', () => {
    expect(redundancy(post(1, { artist: 'a' }), post(2, { artist: 'a' }))).toBeGreaterThan(0.5);
    expect(redundancy(post(1), post(2))).toBe(0);
    const hashed = (id, hash) => post(id, { imageAnalysis: { perceptualHash: hash } });
    expect(redundancy(hashed(1, 'ffffffffffffffff'), hashed(2, 'fffffffffffffff0'))).toBe(1);
  });
  it('breaks up a run of one artist without burying it', () => {
    const scored = [
      { post: post(1, { artist: 'a' }), score: 0.9 },
      { post: post(2, { artist: 'a' }), score: 0.89 },
      { post: post(3, { artist: 'a' }), score: 0.88 },
      { post: post(4, { artist: 'b' }), score: 0.8 },
      { post: post(5, { artist: 'c' }), score: 0.79 },
    ];
    const order = diversify(scored).map(item => item.post.id);
    expect(order[0]).toBe(1);
    expect(order.slice(1, 3)).toEqual([4, 5]);
    // The context carries over from what the user just saw.
    expect(diversify(scored, [post(9, { artist: 'a' })])[0].post.id).toBe(4);
  });
});

describe('session fatigue', () => {
  it('satiates on repeated artists and builds pressure on skip runs', () => {
    const session = new SessionInterest();
    expect(session.satiation(post(1, { artist: 'a' }))).toBe(0);
    for (let id = 1; id <= 4; id++) session.record(post(id, { artist: 'a' }), 'timeSpent', 6000);
    expect(session.satiation(post(9, { artist: 'a' }))).toBeGreaterThan(0.6);
    expect(session.satiation(post(9, { artist: 'b' }))).toBe(0);
    for (let id = 10; id < 14; id++) session.record(post(id), 'timeSpent', 500);
    expect(session.explorationPressure).toBe(1);
    session.record(post(20), 'like', 1);
    expect(session.explorationPressure).toBe(0);
  });
});

describe('feed assembly', () => {
  it('explores with uncertain, decent candidates instead of the worst ones', () => {
    const core = new RecommendationWorkerCore();
    const scores = new Map(), uncertain = new Set([8, 12, 18]);
    const candidates = Array.from({ length: 20 }, (_, i) => post(i + 1));
    candidates.forEach((candidate, i) => scores.set(candidate.id, 1 - i * 0.04));
    core.scorePost = candidate => scores.get(candidate.id);
    core.postUncertainty = candidate => (uncertain.has(candidate.id) ? 1 : 0);
    const { feed, rest } = core.assembleFeed(candidates, { maxTotal: 8 });
    expect(feed).toHaveLength(8);
    const explored = feed.filter(item => item._explore).map(item => item.id);
    // 18 is uncertain too, but below the score floor.
    expect(explored).toEqual([8, 12]);
    expect(feed.map(item => item.id)).not.toContain(20); // bottom of the list stays out
    expect(rest).toHaveLength(12);
  });
  it('explores more often during a run of skips', () => {
    const core = new RecommendationWorkerCore();
    for (let id = 100; id < 104; id++) core.sessionInterest.record(post(id), 'timeSpent', 500);
    const candidates = Array.from({ length: 20 }, (_, i) => post(i + 1));
    core.scorePost = candidate => 1 - candidate.id * 0.01;
    core.postUncertainty = () => 0.5;
    const { feed } = core.assembleFeed(candidates, { maxTotal: 8 });
    expect(feed.filter(item => item._explore)).toHaveLength(4);
  });
});

describe('neural-linear uncertainty', () => {
  it('is lower for the kind of post the model has been trained on', () => {
    vi.restoreAllMocks(); // real random weight initialisation
    const scorer = new MLScorer();
    const profile = { ratingPreferences: { g: 1 }, mediaTypePreferences: { image: 1, video: 0 } };
    const tagScores = { scenery: 1 };
    const seen = post(1, { tags: 'scenery', width: 1920, height: 1080, score: 50 });
    for (let i = 0; i < 40; i++) scorer.addTrainingSample(seen, 'like', 1, tagScores, profile);
    scorer.flushTraining();
    const familiar = scorer.uncertainty(seen, tagScores, profile);
    const novel = scorer.uncertainty(post(2, { tags: 'portrait', file_ext: 'mp4', width: 10, height: 10, score: 0 }), tagScores, profile);
    expect(familiar).not.toBeNull();
    expect(novel).toBeGreaterThan(familiar);
  });
});
