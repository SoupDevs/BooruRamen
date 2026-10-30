import { describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => ({ initialize: async () => {}, tagAlwaysInclude: [], tagNeverInclude: [], overrideNeverInclude: [], activeSource: null, customSources: [] }));
const cache = vi.hoisted(() => ({ saved: null, saves: [] }));

vi.mock('../src/services/RecommendationSystem', () => ({ default: {}, deepDiveState: { generation: 0, active: false } }));
vi.mock('../src/services/StorageService', () => ({ default: { getViewedPosts: async () => ({}) } }));
vi.mock('../src/services/ReportService', () => ({ default: { getBlockSets: async () => ({ postKeys: new Set() }), filterPosts: posts => posts } }));
vi.mock('../src/services/BooruService', () => ({ default: {} }));
vi.mock('../src/services/TagSuggestionService', () => ({ default: { ingestTags() {} } }));
vi.mock('../src/services/ImageAnalysisService.js', () => ({ default: { enqueue() {}, subscribe() {} } }));
vi.mock('../src/stores/settings', () => ({ useSettingsStore: () => settings }));
vi.mock('../src/stores/player', () => ({ usePlayerStore: () => ({}) }));
vi.mock('../src/stores/interactions', () => ({ useInteractionsStore: () => ({}) }));
vi.mock('../src/services/RunwayCache.js', () => ({
  default: {
    takeRunway: async (context) => { const saved = cache.saved; cache.saved = null; return saved && saved.context === context ? saved : null; },
    saveRunway: (...args) => { cache.saves.push(args); },
  },
}));

const { feedFilterSignature } = await import('../src/services/feedFilters.js');
const { default: pluginHost } = await import('../src/plugins/PluginHost.js');
const { default: FeedView } = await import('../src/views/FeedView.vue');

function feed(query = {}) {
  const calls = [];
  const vm = {
    ...FeedView.data.call({}),
    $route: { query },
    $refs: {},
    $nextTick: () => {},
    mediaType: { images: true, videos: true },
    whitelistTags: [], blacklistTags: [],
    recommendationSystem: {
      candidatePool: [],
      resetExploreSession() {},
      restorePool() {},
      applyContentFilters: posts => posts,
      applyClientSideFilters: posts => posts,
      getCuratedExploreFeed: () => new Promise(resolve => calls.push(resolve)),
    },
  };
  for (const [name, fn] of Object.entries(FeedView.methods)) if (typeof fn === 'function') vm[name] = fn.bind(vm);
  Object.assign(vm, { observePosts() {}, determineCurrentPost() {}, analyzeUpcomingImages() {}, processVideoUrls() {} });
  vm.onFilterChange = FeedView.watch.filterSignature.bind(vm);
  return { vm, calls };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const post = (id, tags = 'cat') => ({ id, source: 's', rating: 'g', tag_string: tags, file_ext: 'jpg' });
const batch = first => Array.from({ length: 5 }, (_, i) => post(first + i));

describe('feed filter signature', () => {
  it('changes with the override rules and the enabled plugins, not their order', () => {
    const base = feedFilterSignature({ tagAlwaysInclude: ['a', 'b'] }, [{ id: 'x', enabled: true }, { id: 'y', enabled: false }]);
    expect(feedFilterSignature({ tagAlwaysInclude: ['b', 'a'] }, [{ id: 'y', enabled: false }, { id: 'x', enabled: true }])).toBe(base);
    expect(feedFilterSignature({ tagAlwaysInclude: ['a', 'b'], tagNeverInclude: ['c'] }, [{ id: 'x', enabled: true }])).not.toBe(base);
    expect(feedFilterSignature({ tagAlwaysInclude: ['a', 'b'], overrideNeverInclude: ['q'] }, [{ id: 'x', enabled: true }])).not.toBe(base);
    expect(feedFilterSignature({ tagAlwaysInclude: ['a', 'b'] }, [{ id: 'x', enabled: true }, { id: 'y', enabled: true }])).not.toBe(base);
    expect(feedFilterSignature({ tagAlwaysInclude: ['a', 'b'] }, [])).not.toBe(base);
  });
});

describe('feed refresh on filter changes', () => {
  it('starts a new search when an override rule changes, even mid-fetch', async () => {
    const { vm, calls } = feed();
    vm.fetchPosts(true);
    await flush();
    expect(calls).toHaveLength(1);
    settings.tagNeverInclude = ['spider'];
    vm.onFilterChange(vm.currentFilterSignature());
    calls[0](batch(1));
    await flush();
    // The batch fetched under the old rules is dropped and a new search runs.
    expect(vm.posts.map(p => p.id)).not.toContain(1);
    expect(calls).toHaveLength(2);
    calls[1](batch(10));
    await flush();
    expect(vm.posts.map(p => p.id)).toContain(10);
    settings.tagNeverInclude = [];
  });

  it('starts a new search when a plugin is turned on or off', async () => {
    const { vm, calls } = feed();
    vm.fetchPosts(true);
    await flush();
    calls[0](batch(1));
    await flush();
    pluginHost.state.plugins.push({ id: 'test-plugin', enabled: true });
    vm.onFilterChange(vm.currentFilterSignature());
    await flush();
    expect(calls).toHaveLength(2);
    expect(vm.posts).toEqual([]);
    calls[1](batch(10));
    await flush();
    expect(vm.posts.map(p => p.id)).toEqual([10, 11, 12, 13, 14]);
    pluginHost.state.plugins.pop();
  });

  it('ignores a change before the first search has read the settings', () => {
    const { vm, calls } = feed();
    vm.onFilterChange('anything');
    expect(calls).toHaveLength(0);
    expect(vm.isFetching).toBe(false);
  });

  it('saves the runway under the filters it was fetched with', async () => {
    const { vm, calls } = feed({ blacklist: 'dog' });
    vm.runwayRestoreTried = true;
    vm.fetchPosts(true);
    await flush();
    calls[0](batch(1));
    await flush();
    const fetchedUnder = vm.runwayContext();
    // Apply changes the route before the old feed unmounts.
    vm.$route.query = { blacklist: 'dog,cat' };
    cache.saves.length = 0;
    vm.saveRunway();
    expect(cache.saves[0][0]).toBe(fetchedUnder);
    expect(cache.saves[0][0]).not.toBe(vm.runwayContext());
  });

  it('does not bring back a runway saved under other override rules', async () => {
    const { vm, calls } = feed();
    cache.saved = { context: vm.runwayContext(), runway: [post(1), post(2)], pool: [] };
    settings.tagAlwaysInclude = ['solo'];
    vm.runwayRestoreTried = false;
    vm.fetchPosts(true);
    await flush();
    expect(vm.posts).toEqual([]);
    expect(calls).toHaveLength(1);
    calls[0]([]);
    await flush();
    settings.tagAlwaysInclude = [];
  });
});
