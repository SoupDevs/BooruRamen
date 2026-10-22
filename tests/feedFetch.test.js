import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/RecommendationSystem', () => ({ default: {}, deepDiveState: { generation: 0, active: false } }));
vi.mock('../src/services/StorageService', () => ({ default: { getViewedPosts: async () => ({}) } }));
vi.mock('../src/services/ReportService', () => ({ default: { getBlockSets: async () => ({ postKeys: new Set() }), filterPosts: posts => posts } }));
vi.mock('../src/services/BooruService', () => ({ default: {} }));
vi.mock('../src/services/TagSuggestionService', () => ({ default: { ingestTags() {} } }));
vi.mock('../src/services/ImageAnalysisService.js', () => ({ default: { enqueue() {}, subscribe() {} } }));
vi.mock('../src/stores/settings', () => ({ useSettingsStore: () => ({ initialize: async () => {} }) }));
vi.mock('../src/stores/player', () => ({ usePlayerStore: () => ({}) }));
vi.mock('../src/stores/interactions', () => ({ useInteractionsStore: () => ({}) }));

const { default: FeedView } = await import('../src/views/FeedView.vue');

// A FeedView-shaped `this` whose recommendation calls resolve on demand.
function feed(query) {
  const calls = [];
  const vm = {
    ...FeedView.data.call({}),
    $route: { query },
    $refs: {},
    $nextTick: () => {},
    mediaType: { images: true, videos: true },
    whitelistTags: [], blacklistTags: [],
    recommendationSystem: {
      resetExploreSession() {},
      getCuratedExploreFeed: () => new Promise(resolve => calls.push({ query: { ...vm.$route.query }, resolve })),
    },
  };
  for (const [name, fn] of Object.entries(FeedView.methods)) if (typeof fn === 'function') vm[name] = fn.bind(vm);
  Object.assign(vm, { observePosts() {}, determineCurrentPost() {}, analyzeUpcomingImages() {}, processVideoUrls() {} });
  return { vm, calls };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const post = (id, tags) => ({ id, source: 's', tag_string: tags, file_ext: 'jpg' });
// A full batch, so one call fills the runway.
const batch = (first, tags) => Array.from({ length: 5 }, (_, i) => post(first + i, tags));

describe('feed fetching', () => {
  it('runs a search requested during a prefetch once the prefetch returns', async () => {
    const { vm, calls } = feed({ whitelist: '' });
    vm.fetchPosts(true);
    await flush();
    expect(calls).toHaveLength(1);
    // A tag tap changes the route while that fetch is still running.
    vm.$route.query = { whitelist: 'cat' };
    vm.fetchPosts(true);
    calls[0].resolve(batch(1, 'dog'));
    await flush();
    // The stale batch is discarded and the new search runs.
    expect(vm.posts.map(p => p.id)).not.toContain(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].query).toEqual({ whitelist: 'cat' });
    calls[1].resolve(batch(10, 'cat'));
    await flush();
    expect(vm.posts.map(p => p.id)).toContain(10);
  });

  it('does not restart a search that is already running', async () => {
    const { vm, calls } = feed({ whitelist: '' });
    vm.fetchPosts(true);
    await flush();
    vm.fetchPosts(true);
    calls[0].resolve(batch(1, 'dog'));
    await flush();
    expect(vm.pendingNewSearch).toBe(false);
    expect(vm.posts.map(p => p.id)).toContain(1);
  });

  it('puts a recovery pick right after the current post', async () => {
    const { vm } = feed({});
    let pick = post(9, 'cat');
    vm.recommendationSystem.takeRecoveryPick = async () => pick;
    vm.posts = [post(1, 'a'), post(2, 'b'), post(3, 'c')];
    vm.currentPostIndex = 0;
    await vm.insertRecoveryPick();
    expect(vm.posts.map(p => p.id)).toEqual([1, 9, 2, 3]);
    // Never a post that is already queued.
    pick = post(3, 'c');
    await vm.insertRecoveryPick();
    expect(vm.posts.map(p => p.id)).toEqual([1, 9, 2, 3]);
  });

  it('reads the extension from file_ext, ignoring case and query strings', () => {
    const ext = FeedView.methods.getFileExtension;
    expect(ext({ file_ext: 'MP4' })).toBe('mp4');
    expect(ext({ file_url: 'https://x.test/a/b.JPG?12345' })).toBe('jpg');
  });
});
