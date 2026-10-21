import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({
  storeInteraction: vi.fn(async () => true), loadAppSettings: vi.fn(async () => ({})),
  getPreferences: vi.fn(async () => ({})), getProfileSnapshot: vi.fn(async () => null),
  getInteractions: vi.fn(async () => []), storeProfileSnapshot: vi.fn(async () => {}),
}));
vi.mock('../src/services/StorageService', () => ({ default: storage }));
vi.mock('../src/services/ImageAnalysisCache.js', () => ({ hydrateImageAnalysis: async () => {} }));
import { RecommendationWorkerCore, OPENER_SLOTS, RESERVE_SIZE, RECOVERY_SKIP_STREAK } from '../src/workers/recommendation.worker.js';
import { SessionInterest, SESSION_IDLE_MS } from '../src/services/SessionInterest.js';

const post = (id, extra = {}) => ({
  id, source: 'source', tag_string: `artist${id} scenery`, tag_string_artist: `artist${id}`, tag_string_general: 'scenery', file_ext: 'jpg', ...extra,
});
const candidates = (first, count) => Array.from({ length: count }, (_, i) => post(first + i));

beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0); });
afterEach(() => vi.restoreAllMocks());

function pacedCore() {
  let now = 1_000_000;
  const core = new RecommendationWorkerCore();
  core.sessionInterest = new SessionInterest(() => now);
  core.resetPacing();
  // Higher id, lower score; every post is equally uncertain.
  core.scorePost = candidate => 1 - candidate.id * 0.001;
  core.postUncertainty = () => 0.5;
  const skip = id => core.sessionInterest.record(post(id), 'timeSpent', 500);
  return { core, skip, tick: ms => { now += ms; } };
}

describe('session openers', () => {
  it('opens a session with exploit picks even under exploration pressure', () => {
    const { core, skip } = pacedCore();
    for (let id = 900; id < 904; id++) skip(id); // pressure: explore every 2nd slot
    const { feed } = core.assembleFeed(candidates(1, 20), { maxTotal: 8 });
    expect(feed.slice(0, OPENER_SLOTS).some(item => item._explore)).toBe(false);
    expect(feed.slice(0, OPENER_SLOTS).map(item => item.id)).toEqual([1, 2, 3]);
    // The share of exploration in the batch is unchanged.
    expect(feed.filter(item => item._explore)).toHaveLength(4);
  });

  it('only opens once per session, and again after the session went idle', () => {
    const { core, skip, tick } = pacedCore();
    core.assembleFeed(candidates(1, 20), { maxTotal: 8 });
    for (let id = 900; id < 904; id++) skip(id);
    const next = core.assembleFeed(candidates(100, 20), { maxTotal: 8 }).feed;
    expect(next[1]._explore).toBe(true);

    tick(SESSION_IDLE_MS + 1);
    const reopened = core.assembleFeed(candidates(200, 20), { maxTotal: 8 }).feed;
    expect(reopened.slice(0, OPENER_SLOTS).some(item => item._explore)).toBe(false);
  });

  it('re-ranks a queue as a new session when asked', () => {
    const { core } = pacedCore();
    const queue = [post(1, { _explore: true }), post(2, { _explore: true }), post(3), post(4), post(5)];
    const ranked = core.rankPosts(queue, [], { opener: true });
    expect(ranked.slice(0, OPENER_SLOTS).map(item => item.id)).toEqual([3, 4, 5]);
    expect(ranked).toHaveLength(5);
  });
});

describe('recovery picks', () => {
  it('holds strong candidates back and serves one after a run of skips', () => {
    const { core, skip } = pacedCore();
    core.assembleFeed(candidates(1, 20), { maxTotal: 8 }); // opening batch keeps nothing back
    expect(core.reserve).toHaveLength(0);
    const { feed, rest } = core.assembleFeed(candidates(100, 20), { maxTotal: 8 });
    expect(core.reserve.map(item => item.id)).toEqual([100, 101]);
    const shown = [...feed, ...rest].map(item => item.id);
    expect(shown).not.toContain(100);
    expect(shown).not.toContain(101);
    expect(core.reserve).toHaveLength(RESERVE_SIZE);

    for (let id = 900; id < 900 + RECOVERY_SKIP_STREAK - 1; id++) skip(id);
    expect(core.takeRecoveryPick()).toBeNull();
    skip(950);
    const pick = core.takeRecoveryPick();
    expect(pick.id).toBe(100);
    expect(pick._recovery).toBe(true);
    // Once per run of skips.
    skip(951);
    expect(core.takeRecoveryPick()).toBeNull();

    // A like breaks the run; the next run gets the other pick.
    core.sessionInterest.record(post(960), 'like', 1);
    expect(core.takeRecoveryPick()).toBeNull();
    for (let id = 970; id < 970 + RECOVERY_SKIP_STREAK; id++) skip(id);
    expect(core.takeRecoveryPick().id).toBe(101);
  });

  it('skips reserve posts that are already in the feed, and stays out of Deep Dive', () => {
    const { core, skip } = pacedCore();
    core.assembleFeed(candidates(1, 20), { maxTotal: 8 });
    core.assembleFeed(candidates(100, 20), { maxTotal: 8 });
    for (let id = 900; id < 900 + RECOVERY_SKIP_STREAK; id++) skip(id);
    const feedMode = core.deepDive;
    core.deepDive = { active: true };
    expect(core.takeRecoveryPick()).toBeNull();
    core.deepDive = feedMode;
    expect(core.takeRecoveryPick(['source|100']).id).toBe(101);
  });

  it('drops the reserve when the feed starts over', () => {
    const { core } = pacedCore();
    core.assembleFeed(candidates(1, 20), { maxTotal: 8 });
    core.assembleFeed(candidates(100, 20), { maxTotal: 8 });
    core.resetExploreSession();
    expect(core.reserve).toEqual([]);
    expect(core.openerSlotsLeft()).toBe(OPENER_SLOTS);
  });
});
