import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

const deepDive = vi.hoisted(() => ({ generation: 0, active: false }));
const cache = vi.hoisted(() => ({ saved: null, saves: [] }));

vi.mock('../src/services/RecommendationSystem', () => ({ default: {}, deepDiveState: deepDive }));
vi.mock('../src/services/StorageService', () => ({ default: { getViewedPosts: async () => ({ 's|4': { data: { id: 4, source: 's' } } }) } }));
vi.mock('../src/services/ReportService', () => ({ default: { getBlockSets: async () => ({ postKeys: new Set() }), filterPosts: posts => posts.filter(post => post.id !== 3) } }));
vi.mock('../src/services/BooruService', () => ({ default: {} }));
vi.mock('../src/services/TagSuggestionService', () => ({ default: { ingestTags() {} } }));
vi.mock('../src/services/ImageAnalysisService.js', () => ({ default: { enqueue() {}, subscribe() {} } }));
vi.mock('../src/stores/settings', () => ({ useSettingsStore: () => ({ initialize: async () => {}, activeSource: { type: 'danbooru', url: 'https://d.test' }, customSources: [] }) }));
vi.mock('../src/stores/player', () => ({ usePlayerStore: () => ({}) }));
vi.mock('../src/stores/interactions', () => ({ useInteractionsStore: () => ({}) }));
vi.mock('../src/services/RunwayCache.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      takeRunway: async () => { const saved = cache.saved; cache.saved = null; return saved; },
      saveRunway: (...args) => { cache.saves.push(args); },
    },
  };
});

const { saveRunway, takeRunway, clearRunway, RUNWAY_MAX_AGE_MS } = await import('../src/services/RunwayCache.js');
const { default: FeedView } = await import('../src/views/FeedView.vue');

const post = (id, tags = 'cat', rating = 'g') => ({ id, source: 's', rating, tag_string: tags, file_ext: 'jpg' });

describe('runway cache storage', () => {
  it('returns a saved runway once, for the same feed only', async () => {
    await saveRunway('feed-a', [post(1), post(2)], [post(9)]);
    expect(await takeRunway('feed-b')).toBeNull();
    // A mismatched read still consumes the entry: it belonged to another feed.
    expect(await takeRunway('feed-a')).toBeNull();

    await saveRunway('feed-a', [post(1), post(2)], [post(9)]);
    const restored = await takeRunway('feed-a');
    expect(restored.runway.map(p => p.id)).toEqual([1, 2]);
    expect(restored.pool.map(p => p.id)).toEqual([9]);
    expect(await takeRunway('feed-a')).toBeNull();
  });

  it('expires after a day', async () => {
    await saveRunway('feed-a', [post(1)], []);
    expect(await takeRunway('feed-a', Date.now() + RUNWAY_MAX_AGE_MS + 1)).toBeNull();
  });

  it('removes the entry when there is nothing left to save, and on clear', async () => {
    await saveRunway('feed-a', [post(1)], []);
    await saveRunway('feed-a', [], []);
    expect(await takeRunway('feed-a')).toBeNull();
    await saveRunway('feed-a', [post(1)], []);
    await clearRunway();
    expect(await takeRunway('feed-a')).toBeNull();
  });
});

function feed() {
  const calls = [];
  const restoredPool = [];
  const vm = {
    ...FeedView.data.call({}),
    $route: { query: {} },
    $refs: {},
    $nextTick: () => {},
    mediaType: { images: true, videos: true },
    whitelistTags: [], blacklistTags: ['spider'],
    recommendationSystem: {
      candidatePool: [],
      resetExploreSession() {},
      restorePool(posts) { restoredPool.push(...posts); },
      applyContentFilters: (posts, { blacklist, selectedRatings }) => posts.filter(p => !blacklist.some(tag => p.tag_string.split(' ').includes(tag)) && selectedRatings.includes({ g: 'general' }[p.rating])),
      applyClientSideFilters: posts => posts,
      getCuratedExploreFeed: () => new Promise(resolve => calls.push(resolve)),
    },
  };
  for (const [name, fn] of Object.entries(FeedView.methods)) if (typeof fn === 'function') vm[name] = fn.bind(vm);
  Object.assign(vm, { observePosts() {}, determineCurrentPost() {}, analyzeUpcomingImages() {}, processVideoUrls() {} });
  return { vm, calls, restoredPool };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('feed start from a saved runway', () => {
  it('shows allowed saved posts before the first fetch returns', async () => {
    const { vm, calls, restoredPool } = feed();
    cache.saved = {
      // 2 blacklisted, 3 reported, 4 already seen, 6 not General
      runway: [post(1), post(2, 'cat spider'), post(3), post(4), post(5), post(6, 'cat', 'q')],
      pool: [post(7), post(8, 'spider')],
    };
    vm.runwayRestoreTried = false;
    vm.fetchPosts(true);
    await flush();
    expect(calls).toHaveLength(1);
    expect(vm.posts.map(p => p.id)).toEqual([1, 5]);
    expect(vm.loading).toBe(false);
    expect(restoredPool.map(p => p.id)).toEqual([7]);

    // Fresh posts queue up behind the restored ones.
    calls[0]([10, 11, 12, 13, 14].map(id => post(id)));
    await flush();
    expect(vm.posts.map(p => p.id)).toEqual([1, 5, 10, 11, 12, 13, 14]);
  });

  it('does not restore into Deep Dive', async () => {
    const { vm, calls } = feed();
    vm.runwayRestoreTried = false;
    deepDive.active = true;
    cache.saved = { runway: [post(1)], pool: [] };
    vm.fetchPosts(true);
    await flush();
    expect(vm.posts).toEqual([]);
    expect(cache.saved).not.toBeNull();
    deepDive.active = false;
    calls[0]([]);
    await flush();
  });

  it('saves the posts ahead of the current one', () => {
    const { vm } = feed();
    cache.saves.length = 0;
    vm.posts = [post(1), post(2), post(3)];
    vm.currentPostIndex = 0;
    vm.saveRunway();
    expect(cache.saves[0][1].map(p => p.id)).toEqual([2, 3]);
  });
});
