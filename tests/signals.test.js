import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({
  storeInteraction: vi.fn(async () => true), getPostInteractions: vi.fn(async () => []), loadAppSettings: vi.fn(async () => ({})),
  getPreferences: vi.fn(async () => ({})), getProfileSnapshot: vi.fn(async () => null),
  getInteractions: vi.fn(async () => []), storeProfileSnapshot: vi.fn(async () => {}),
}));
vi.mock('../src/services/StorageService', () => ({ default: storage }));
vi.mock('../src/services/ImageAnalysisCache.js', () => ({ hydrateImageAnalysis: async () => {} }));
import { RecommendationWorkerCore } from '../src/workers/recommendation.worker.js';
import { DwellBaseline, dwellEngagement, engagementLabel, interactionSignal, focusPostOnTag, SKIP_LABEL } from '../src/services/signals.js';

const post = (id, tag, extra = {}) => ({ id, source: 'source', tag_string: tag, tag_string_general: tag, file_ext: 'jpg', ...extra });
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('engagement signals', () => {
  it('ignores undo events and keeps the legacy dwell scale without context', () => {
    expect(engagementLabel('like', 0)).toBeUndefined();
    expect(interactionSignal('favorite', 0)).toBe(0);
    expect(engagementLabel('timeSpent', 1000)).toBe(SKIP_LABEL);
    expect(interactionSignal('timeSpent', 1000)).toBe(-0.2);
    expect(interactionSignal('timeSpent', 30000)).toBeCloseTo(1, 5);
  });
  it('scores video watch time by completion, with loops above a full watch', () => {
    const clip = { video: true, durationSec: 10 };
    expect(dwellEngagement(1500, clip)).toBe(SKIP_LABEL);
    expect(dwellEngagement(5000, clip)).toBeGreaterThan(dwellEngagement(3000, clip));
    expect(dwellEngagement(10000, clip)).toBeGreaterThan(dwellEngagement(9000, clip));
    expect(dwellEngagement(20000, clip)).toBeGreaterThan(dwellEngagement(10000, clip));
    // Ten seconds of a ten-minute video is not a skip, but not a full watch either.
    expect(dwellEngagement(10000, { video: true, durationSec: 600 })).toBeLessThan(0.5);
  });
  it('reads image dwell relative to the user’s own pace', () => {
    const fast = new DwellBaseline(), slow = new DwellBaseline();
    for (let i = 0; i < 40; i++) { fast.observe(1500); slow.observe(12000); }
    const fastLabel = dwellEngagement(5000, { baseline: fast });
    const slowLabel = dwellEngagement(5000, { baseline: slow });
    expect(fastLabel).toBeGreaterThan(0.6);
    expect(slowLabel).toBeLessThan(0.4);
    // Not yet calibrated: the legacy absolute scale applies.
    expect(dwellEngagement(5000, { baseline: new DwellBaseline() })).toBeCloseTo(engagementLabel('timeSpent', 5000), 5);
  });
  it('weights deliberate implicit actions above ambient ones', () => {
    expect(engagementLabel('download', 1)).toBeGreaterThan(engagementLabel('details', 1));
    expect(interactionSignal('share', 1)).toBeGreaterThan(interactionSignal('like', 1));
    expect(interactionSignal('report', 1)).toBeLessThan(interactionSignal('dislike', 1));
  });
  it('narrows a tag tap to the tapped tag', () => {
    const focused = focusPostOnTag({ tag_string: 'a b c', tag_string_artist: 'a', tag_string_general: 'b c' }, 'b');
    expect(focused.tag_string).toBe('b');
    expect(focused.tag_string_artist).toBe('');
    expect(focused.tag_string_general).toBe('b');
  });
});

describe('strategy credit', () => {
  const coreWithBandit = () => {
    const core = new RecommendationWorkerCore();
    core.banditExplorer = { recordReward: vi.fn() };
    return core;
  };
  it('credits one reward per impression, using its best event', async () => {
    const core = coreWithBandit();
    const shown = post(1, 'landscape', { _strategy: 'reach' });
    await core.trackInteraction(1, 'like', 1, shown);
    await core.trackInteraction(1, 'dislike', 0, shown);
    expect(core.banditExplorer.recordReward).not.toHaveBeenCalled();
    await core.trackInteraction(1, 'timeSpent', 1500, shown);
    expect(core.banditExplorer.recordReward).toHaveBeenCalledTimes(1);
    expect(core.banditExplorer.recordReward).toHaveBeenCalledWith('reach', 0.8);
    await core.trackInteraction(1, 'timeSpent', 9000, shown);
    expect(core.banditExplorer.recordReward).toHaveBeenCalledTimes(1);
  });
  it('gives no credit for strategy-less posts or Deep Dive impressions', async () => {
    const core = coreWithBandit();
    await core.trackInteraction(1, 'timeSpent', 9000, post(1, 'landscape'));
    await core.trackInteraction(2, 'timeSpent', 9000, post(2, 'landscape', { _strategy: 'anchor' }), false, { deepDive: true });
    expect(core.banditExplorer.recordReward).not.toHaveBeenCalled();
  });
  it('stores normalised video engagement with the interaction', async () => {
    const core = new RecommendationWorkerCore();
    await core.trackInteraction(1, 'timeSpent', 20000, post(1, 'clip', { file_ext: 'mp4' }), false, { mediaDuration: 10 });
    const { metadata } = storage.storeInteraction.mock.calls[0][0];
    expect(metadata.mediaDuration).toBe(10);
    expect(metadata.engagement).toBeGreaterThan(0.9);
  });
});
