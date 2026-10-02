import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({
  storeInteraction: vi.fn(async () => true), loadAppSettings: vi.fn(async () => ({})),
  getPreferences: vi.fn(async () => ({})), getProfileSnapshot: vi.fn(async () => null),
  getInteractions: vi.fn(async () => []), storeProfileSnapshot: vi.fn(async () => {}),
}));
vi.mock('../src/services/StorageService', () => ({ default: storage }));
vi.mock('../src/services/ImageAnalysisCache.js', () => ({ hydrateImageAnalysis: async () => {} }));
import { RecommendationWorkerCore } from '../src/workers/recommendation.worker.js';
import { MLScorer } from '../src/services/MLScorer.js';
import { TagEmbedding } from '../src/services/TagEmbedding.js';

const post = (id, tag) => ({ id, source: 'source', tag_string: tag, tag_string_general: tag, file_ext: 'jpg' });
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Math, 'random').mockReturnValue(0); storage.getInteractions.mockResolvedValue([]); });
afterEach(() => vi.restoreAllMocks());

describe('session recommendation integration', () => {
  it('changes trained ML rankings and query interests immediately, including cached scores', async () => {
    const core = new RecommendationWorkerCore();
    core.mlInitialized = true;
    core.mlScorer = { isTrained: true, interactionCount: 25, scorePost: () => 0.5, getFeatureValues: () => [], getTagContributions: () => [] };
    const current = post(1, 'landscape'), candidate = post(2, 'landscape');
    core.scorePost(candidate);
    await core.trackInteraction(1, 'favorite', 1, current);
    const cacheScore = core.scorePost(candidate);
    expect(core.scorePost(candidate)).toBeCloseTo(cacheScore, 5);
    expect(core.getRecommendedTags()).toContain('landscape');
    const irrelevant = post(3, 'portrait');
    expect(core.rankPosts([irrelevant, candidate])[0]).toEqual(candidate);
    expect(core.getPostScoreDetails(candidate).sessionWeight).toBeGreaterThan(0);
    expect(storage.storeInteraction.mock.calls[0][0].metadata.profileWeight).toBe(0.35);
  });
  it('persists only moderated evidence and leaves the session out of profile snapshots', async () => {
    const core = new RecommendationWorkerCore();
    await core.trackInteraction(1, 'like', 1, post(1, 'landscape'));
    const interaction = storage.storeInteraction.mock.calls[0][0];
    storage.getInteractions.mockResolvedValue([{ ...interaction, timestamp: Date.now() }]);
    await core.updateUserProfile();
    expect(core.rawTagScores.landscape).toBeCloseTo(0.35, 4); // not doubled by category + full tag strings
    const snapshot = storage.storeProfileSnapshot.mock.calls[0][0];
    expect(snapshot.sessionInterest).toBeUndefined();
    const reopened = new RecommendationWorkerCore();
    expect(reopened.sessionInterest.weight).toBe(0);
    core.factoryReset();
    expect(core.sessionInterest.weight).toBe(0);
  });
  it('applies the same durable weight to neural training and both embedding update paths', () => {
    const scorer = new MLScorer();
    scorer.addTrainingSample(post(1, 'landscape sky'), 'like', 1, {}, {}, 0.35);
    expect(scorer.pendingBatch[0].weight).toBeCloseTo(2.5 * 0.35);
    scorer.addTrainingSample(post(2, 'landscape sky'), 'like', 1, {}, {}, 0);
    expect(scorer.interactionCount).toBe(1);
    const interaction = { type: 'like', value: 1, metadata: { post: post(1, 'landscape sky'), profileWeight: 0.35 } };
    for (const method of ['addInteraction', 'processInteractions']) {
      const embedding = new TagEmbedding();
      embedding[method](method === 'addInteraction' ? interaction : [interaction]);
      expect(embedding.tagFrequency.get('landscape')).toBe(0.35);
      expect(embedding.tagCooccurrence.get('landscape').get('sky')).toBe(0.35);
    }
  });
  it('keeps lasting interests stable across a day and fades them over a month', () => {
    const core = new RecommendationWorkerCore();
    core.rawTagScores = { landscape: 10 };
    core.applyDecay(24);
    expect(core.rawTagScores.landscape).toBeGreaterThan(9.7);
    core.rawTagScores = { landscape: 10 };
    core.applyDecay(30 * 24);
    expect(core.rawTagScores.landscape).toBeCloseTo(5);
  });
  it('switches feed ranking and query selection to an anchor, then restores normal ranking', async () => {
    const core = new RecommendationWorkerCore();
    core.mlInitialized = true;
    core.mlScorer = { isTrained: true, scorePost: post => post.tag_string === 'portrait' ? 0.99 : 0.01 };
    const familiar = post(3, 'portrait'), similar = post(2, 'landscape');
    expect(core.rankPosts([similar, familiar])[0]).toEqual(familiar);
    await core.setDeepDive(post(1, 'landscape'));
    expect(core.rankPosts([familiar, similar])[0]).toEqual(similar);
    expect(core.generateMultiStrategyQueries().every(query => query.tags.includes('landscape'))).toBe(true);
    await core.setDeepDive(null);
    expect(core.rankPosts([similar, familiar])[0]).toEqual(familiar);
  });
  it('keeps dive interactions out of normal session interests and persists reduced training weights', async () => {
    const core = new RecommendationWorkerCore();
    await core.trackInteraction(1, 'like', 1, post(1, 'portrait'));
    const session = core.sessionInterest.affinities();
    await core.setDeepDive(post(2, 'landscape'));
    await core.trackInteraction(3, 'like', 1, post(3, 'landscape'));
    expect(core.sessionInterest.affinities()).toEqual(session);
    const stored = storage.storeInteraction.mock.calls[1][0];
    expect(stored.metadata.profileWeight).toBeCloseTo(0.035);
    expect(stored.metadata.deepDive).toBe(true);
    await core.setDeepDive(null);
    await core.trackInteraction(4, 'timeSpent', 30000, post(4, 'landscape'), false, { deepDive: true });
    expect(core.sessionInterest.affinities()).toEqual(session);
    expect(storage.storeInteraction.mock.calls[2][0].metadata.profileWeight).toBeCloseTo(0.015);
    core.factoryReset();
    expect(core.deepDive.active).toBe(false);
  });
});
