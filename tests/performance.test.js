import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({
  storeInteraction: vi.fn(async () => true), loadAppSettings: vi.fn(async () => ({})),
  getPreferences: vi.fn(async () => ({})), getProfileSnapshot: vi.fn(async () => null),
  getInteractions: vi.fn(async () => []), getRecentInteractions: vi.fn(async () => []),
  storeProfileSnapshot: vi.fn(async () => {}),
}));
vi.mock('../src/services/StorageService', () => ({ default: storage }));
vi.mock('../src/services/ImageAnalysisCache.js', () => ({ hydrateImageAnalysis: async () => {} }));
import { RecommendationWorkerCore } from '../src/workers/recommendation.worker.js';
import { TagEmbedding } from '../src/services/TagEmbedding.js';

beforeEach(() => { vi.clearAllMocks(); storage.getInteractions.mockResolvedValue([]); storage.getRecentInteractions.mockResolvedValue([]); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const like = (tags) => ({ type: 'like', value: 1, metadata: { post: { tag_string: tags } } });

describe('tag embedding updates', () => {
  const posts = Array.from({ length: 40 }, (_, i) => `common tag_${i % 7} tag_${i % 11} tag_${i % 13} solo_${i}`);

  it('re-embeds a liked post\'s tags exactly as a full rebuild would', () => {
    const embedding = new TagEmbedding();
    posts.forEach(tags => embedding.addInteraction(like(tags)));
    const incremental = ['common', 'tag_3', 'solo_39'].map(tag => Array.from(embedding.getEmbedding(tag)));
    embedding._buildEmbeddings();
    const rebuilt = ['common', 'tag_3', 'solo_39'].map(tag => Array.from(embedding.getEmbedding(tag)));
    incremental.forEach((vec, i) => vec.forEach((value, d) => expect(value).toBeCloseTo(rebuilt[i][d], 5)));
  });

  it('keeps the running co-occurrence total equal to the stored counts', () => {
    const embedding = new TagEmbedding();
    posts.forEach(tags => embedding.addInteraction(like(tags)));
    let sum = 0;
    for (const coocs of embedding.tagCooccurrence.values()) for (const count of coocs.values()) sum += count;
    expect(embedding.totalCoocWeight).toBeCloseTo(sum, 6);
    const restored = new TagEmbedding();
    restored.loadFromSnapshot(embedding.toSnapshot());
    expect(restored.totalCoocWeight).toBeCloseTo(sum, 6);
  });

  it('does not rebuild the whole table for every new tag', () => {
    const embedding = new TagEmbedding();
    posts.forEach(tags => embedding.addInteraction(like(tags)));
    const rebuild = vi.spyOn(embedding, '_buildEmbeddings');
    embedding.addInteraction(like('common brand_new_tag'));
    expect(rebuild).not.toHaveBeenCalled();
    expect(embedding.getEmbedding('brand_new_tag')).toBeTruthy();
  });
});

describe('profile rebuilds', () => {
  const interaction = (id, timestamp) => ({ postId: id, type: 'like', value: 1, timestamp, metadata: { post: { id, source: 's', tag_string: 'landscape', tag_string_general: 'landscape', file_ext: 'jpg' }, profileWeight: 1 } });

  it('reads the stored snapshot once and then only adds newer interactions', async () => {
    const core = new RecommendationWorkerCore();
    storage.getInteractions.mockResolvedValue([interaction(1, Date.now())]);
    await core.updateUserProfile();
    const first = core.rawTagScores.landscape;
    storage.getRecentInteractions.mockResolvedValue([interaction(2, Date.now() + 1)]);
    await core.updateUserProfile();
    expect(storage.getProfileSnapshot).toHaveBeenCalledTimes(1);
    expect(core.rawTagScores.landscape).toBeGreaterThan(first * 1.5);
  });

  it('writes the snapshot at most once per interval and still writes the latest state', async () => {
    vi.useFakeTimers();
    const core = new RecommendationWorkerCore();
    await core.updateUserProfile();
    await core.updateUserProfile();
    await core.updateUserProfile();
    expect(storage.storeProfileSnapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30 * 1000);
    expect(storage.storeProfileSnapshot).toHaveBeenCalledTimes(2);
  });

  it('runs overlapping rebuilds one after the other', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const since = (list) => async (time) => list.filter(i => i.timestamp > time);
    const run = async (parallel) => {
      vi.setSystemTime(1000);
      const core = new RecommendationWorkerCore();
      await core.updateUserProfile();
      vi.setSystemTime(2000);
      storage.getRecentInteractions.mockImplementation(since([interaction(4, 1500)]));
      await Promise.all(Array.from({ length: parallel }, () => core.updateUserProfile()));
      return core.rawTagScores.landscape;
    };
    expect(await run(2)).toBeCloseTo(await run(1), 6);
  });
});
