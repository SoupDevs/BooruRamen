import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/StorageService', () => ({ default: {} }));
vi.mock('../src/services/BooruService', () => ({ default: { getTagLimit: () => 2 } }));
vi.mock('../src/services/ProfileService', () => ({ getActiveProfileDbName: () => 'test' }));
vi.mock('../src/services/ImageAnalysisService.js', () => ({ default: { subscribe() {} } }));
vi.mock('../src/services/ImageAnalysisCache.js', () => ({ hydrateImageAnalysis: async () => {} }));
vi.mock('../src/stores/settings.js', () => ({ useSettingsStore: () => ({ aiTaggingEnabled: false }) }));

// Stand-in worker: one strategy query; assembly ranks by the plugin weight
// each post carries, and records what it received.
const worker = vi.hoisted(() => ({ queries: [{ tags: 'cat', type: 'anchor' }], assembled: [], interactions: [] }));
globalThis.Worker = class {
  postMessage({ id, type, payload }) {
    let result = true;
    if (type === 'generateMultiStrategyQueries') result = worker.queries;
    if (type === 'assembleFeed') {
      worker.assembled = payload.posts;
      result = { feed: [...payload.posts].sort((a, b) => (b._pluginWeight ?? 1) - (a._pluginWeight ?? 1)), rest: [] };
    }
    if (type === 'trackInteraction') worker.interactions.push(payload);
    queueMicrotask(() => this.onmessage({ data: { id, type: 'success', result } }));
  }
};

const { default: recommendations } = await import('../src/services/RecommendationSystem.js');
const { pluginHost } = await import('../src/plugins/index.js');
const { MAX_SCORE_WEIGHT } = await import('../src/plugins/feedHooks.js');

const post = (id, tags, rating = 'g') => ({ id, source: 'src', tag_string: tags, rating });
const options = (extra = {}) => ({ whitelist: [], blacklist: [], selectedRatings: ['general'], wantsImages: true, wantsVideos: true, ...extra });
let ids = 0;
const installed = [];
async function install(setup) {
  const id = `feed-test-${++ids}`;
  await pluginHost.register({ id, name: id, setup }, { origin: 'installed' });
  installed.push(id);
  return id;
}

beforeAll(() => pluginHost.start());
afterEach(async () => {
  while (installed.length) await pluginHost.unregister(installed.pop());
  worker.queries = [{ tags: 'cat', type: 'anchor' }];
  recommendations.resetExploreSession();
});

describe('feed:queries', () => {
  it('lets a plugin add a search, without its rating metatag', async () => {
    await install(api => api.on('feed:queries', queries => [...queries, { tags: 'dog rating:e', type: 'my-plugin' }]));
    const sent = [];
    await recommendations.getCuratedExploreFeed(async query => { sent.push(query.tags); return [post(sent.length, 'x')]; }, options());
    const dog = sent.find(tags => tags.includes('dog'));
    expect(dog).toBeDefined();
    expect(dog).not.toContain('rating:e');
    expect(dog).toContain('rating:g');
  });

  it('ignores a result that is not a list of queries', async () => {
    const id = await install(api => api.on('feed:queries', () => 'nope'));
    const sent = [];
    await recommendations.getCuratedExploreFeed(async query => { sent.push(query.tags); return []; }, options());
    expect(sent[0].startsWith('cat')).toBe(true);
    expect(pluginHost.state.plugins.find(plugin => plugin.id === id).errorCount).toBe(1);
  });
});

describe('feed:request', () => {
  it('can rewrite tags but not the rating', async () => {
    await install(api => api.on('feed:request', tags => `${tags.replace(/rating:\S+/, '')} order:score rating:explicit -rating:g`));
    const sent = [];
    await recommendations.getCuratedExploreFeed(async query => { sent.push(query.tags); return []; }, options());
    const tags = sent[0].split(' ');
    expect(tags).toContain('order:score');
    expect(tags.filter(tag => tag.includes('rating'))).toEqual(['rating:g']);
  });
});

describe('feed:posts', () => {
  it('can drop posts, and posts it adds still pass the rating and blacklist gate', async () => {
    await install(api => api.on('feed:posts', posts => [
      ...posts.filter(p => p.id !== 1),
      post(90, 'cat', 'e'),
      post(91, 'cat spider'),
      post(92, 'cat bird'),
    ]));
    const feed = await recommendations.getCuratedExploreFeed(async () => [post(1, 'cat'), post(2, 'cat')], options({ blacklist: ['spider'] }));
    expect(feed.map(p => p.id).sort()).toEqual([2, 92]);
  });
});

describe('feed:score', () => {
  it('sends clamped multipliers to the worker, which ranks with them', async () => {
    await install(api => api.feed.scorePosts(p => (p.tag_string.includes('bird') ? 100 : p.tag_string.includes('mouse') ? 0.5 : 1)));
    const feed = await recommendations.getCuratedExploreFeed(async () => [post(1, 'cat mouse'), post(2, 'cat'), post(3, 'cat bird')], options());
    expect(feed.map(p => p.id)).toEqual([3, 2, 1]);
    const weights = Object.fromEntries(worker.assembled.map(p => [p.id, p._pluginWeight]));
    expect(weights).toEqual({ 1: 0.5, 2: undefined, 3: MAX_SCORE_WEIGHT });
  });

  it('multiplies the weights of several plugins', async () => {
    await install(api => api.feed.scorePosts(() => 2));
    await install(api => api.feed.scorePosts(() => 1.5));
    await recommendations.getCuratedExploreFeed(async () => [post(1, 'cat')], options());
    expect(worker.assembled[0]._pluginWeight).toBe(3);
  });
});

describe('feed:batch', () => {
  it('can reorder and drop posts but not add them', async () => {
    await install(api => api.on('feed:batch', feed => [post(99, 'cat'), ...[...feed].reverse().slice(0, 2)]));
    const feed = await recommendations.getCuratedExploreFeed(async () => [post(1, 'cat'), post(2, 'cat'), post(3, 'cat')], options());
    expect(feed.map(p => p.id)).toEqual([3, 2]);
  });
});

describe('events and invalidation', () => {
  it('tells plugins about interactions', async () => {
    const seen = [];
    await install(api => api.on('post:interaction', event => seen.push(event)));
    await recommendations.trackInteraction(5, 'like', 1, post(5, 'cat'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(seen).toEqual([expect.objectContaining({ postId: 5, type: 'like', value: 1, deepDive: false })]);
    expect(worker.interactions.at(-1).postId).toBe(5);
  });

  it('empties the candidate pool when a plugin invalidates the feed', async () => {
    let feedApi;
    await install(api => { feedApi = api.feed; });
    recommendations.restorePool([post(1, 'cat')]);
    feedApi.invalidate();
    expect(recommendations.candidatePool).toEqual([]);
  });
});

describe('worker ranking weight', () => {
  it('multiplies the blended score by the clamped plugin weight', async () => {
    const { RecommendationWorkerCore } = await import('../src/workers/recommendation.worker.js');
    const core = new RecommendationWorkerCore();
    const base = core.blendRankingScore(0.5, post(1, 'cat'));
    expect(core.blendRankingScore(0.5, { ...post(1, 'cat'), _pluginWeight: 2 })).toBeCloseTo(base * 2);
    expect(core.blendRankingScore(0.5, { ...post(1, 'cat'), _pluginWeight: 50 })).toBeCloseTo(base * MAX_SCORE_WEIGHT);
    expect(core.blendRankingScore(0.5, { ...post(1, 'cat'), _pluginWeight: -1 })).toBe(0);
    expect(core.blendRankingScore(0.5, { ...post(1, 'cat'), _pluginWeight: 'x' })).toBeCloseTo(base);
  });
});
