import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({
  storeInteraction: vi.fn(async () => true), loadAppSettings: vi.fn(async () => ({})),
  getPreferences: vi.fn(async () => ({})), getProfileSnapshot: vi.fn(async () => null),
  getInteractions: vi.fn(async () => []), storeProfileSnapshot: vi.fn(async () => {}),
}));
vi.mock('../src/services/StorageService', () => ({ default: storage }));
vi.mock('../src/services/ImageAnalysisCache.js', () => ({ hydrateImageAnalysis: async () => {} }));
import { RecommendationWorkerCore } from '../src/workers/recommendation.worker.js';

const post = (id, artist, extra = {}) => ({ id, source: 'source', tag_string: `${artist} witch`, tag_string_artist: artist, tag_string_general: 'witch', file_ext: 'jpg', ...extra });
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('Deep Dive stays segmented from the feed', () => {
  it('learns from a dive at a fraction of normal weight and leaves the feed session untouched', async () => {
    const dive = { deepDive: true };
    const core = new RecommendationWorkerCore();
    core.banditExplorer = { recordReward: vi.fn() };
    await core.trackInteraction(1, 'deepDive', 1, post(1, 'a'), false, dive);
    for (let id = 2; id < 12; id++) {
      await core.trackInteraction(id, 'like', 1, post(id, 'a', { _strategy: 'deepDive' }), false, dive);
      await core.trackInteraction(id, 'timeSpent', 20000, post(id, 'a', { _strategy: 'deepDive' }), false, dive);
    }
    const weights = storage.storeInteraction.mock.calls.map(([interaction]) => interaction.metadata.profileWeight);
    expect(Math.max(...weights)).toBeLessThanOrEqual(0.035);
    // The feed's session learner, satiation and strategy bandit never saw the dive.
    expect(core.sessionInterest.weight).toBe(0);
    expect(core.sessionInterest.satiation(post(99, 'a'))).toBe(0);
    expect(core.banditExplorer.recordReward).not.toHaveBeenCalled();

    // The same activity outside a dive moves the feed's session at full weight.
    const normal = new RecommendationWorkerCore();
    await normal.trackInteraction(1, 'like', 1, post(1, 'a'));
    expect(storage.storeInteraction.mock.calls.at(-1)[0].metadata.profileWeight).toBeGreaterThan(0.3);
    expect(normal.sessionInterest.weight).toBeGreaterThan(0);
  });
});
