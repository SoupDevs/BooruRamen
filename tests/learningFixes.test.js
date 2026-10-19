import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory storage that upserts on (postId, type, source) like StorageService.
const storage = vi.hoisted(() => {
  const state = { rows: [], snapshot: null, clock: Date.now() - 60000 };
  return {
    state,
    storeInteraction: vi.fn(async (interaction) => {
      const source = interaction.metadata?.post?.source ?? null;
      const row = { ...JSON.parse(JSON.stringify(interaction)), source, timestamp: (state.clock += 10) };
      const existing = state.rows.find(r => r.postId === row.postId && r.type === row.type && r.source === source);
      if (existing) Object.assign(existing, row); else state.rows.push(row);
      return true;
    }),
    getPostInteractions: vi.fn(async (postId) => state.rows.filter(r => r.postId === postId)),
    loadAppSettings: vi.fn(async () => ({})), getPreferences: vi.fn(async () => ({})),
    getProfileSnapshot: vi.fn(async () => state.snapshot && JSON.parse(JSON.stringify(state.snapshot))),
    storeProfileSnapshot: vi.fn(async (snapshot) => { state.snapshot = { ...snapshot, timestamp: state.clock += 10 }; }),
    getInteractions: vi.fn(async () => state.rows.slice()),
    getRecentInteractions: vi.fn(async (since) => state.rows.filter(r => r.timestamp > since)),
  };
});
vi.mock('../src/services/StorageService', () => ({ default: storage }));
vi.mock('../src/services/ImageAnalysisCache.js', () => ({ hydrateImageAnalysis: async () => {} }));
import { RecommendationWorkerCore } from '../src/workers/recommendation.worker.js';

const post = (tags = 'zebra_tag', extra = {}) => ({ id: 7, source: 's', tag_string: tags, tag_string_general: tags, file_ext: 'jpg', ...extra });

async function core() {
  const instance = new RecommendationWorkerCore();
  await instance.initialize();
  return instance;
}

beforeEach(() => { storage.state.rows.length = 0; storage.state.snapshot = null; });

describe('undoing a toggle', () => {
  it('takes an absorbed like back out of the profile', async () => {
    const engine = await core();
    await engine.trackInteraction(7, 'like', 1, post());
    await engine.updateUserProfile();
    expect(engine.rawTagScores.zebra_tag).toBeGreaterThan(0);
    await engine.trackInteraction(7, 'like', 0, post());
    await engine.updateUserProfile();
    expect(Math.abs(engine.rawTagScores.zebra_tag ?? 0)).toBeLessThan(1e-6);
  });

  it('does nothing extra when the like was undone before it was absorbed', async () => {
    const engine = await core();
    await engine.trackInteraction(7, 'like', 1, post());
    await engine.trackInteraction(7, 'like', 0, post());
    await engine.updateUserProfile();
    expect(engine.rawTagScores.zebra_tag ?? 0).toBe(0);
  });
});

describe('autoscroll', () => {
  it('ignores a long dwell that autoscroll paced but keeps skips', async () => {
    const engine = await core();
    await engine.trackInteraction(7, 'timeSpent', 8000, post(), false, { autoScroll: true });
    expect(storage.state.rows[0].metadata.profileWeight).toBe(0);
    await engine.trackInteraction(8, 'timeSpent', 500, { ...post('other_tag'), id: 8 }, false, { autoScroll: true });
    expect(storage.state.rows[1].metadata.profileWeight).toBeGreaterThan(0);
  });
});

describe('tag categories', () => {
  it('upgrades a tag first seen as general once a post carries its category', async () => {
    const engine = await core();
    engine.updateProfileWithPost(post('some_artist'), 1);
    expect(engine.tagCategories.some_artist).toBe('general');
    engine.updateProfileWithPost(post('some_artist', { tag_string_general: '', tag_string_artist: 'some_artist' }), 1);
    expect(engine.tagCategories.some_artist).toBe('artist');
  });
});
