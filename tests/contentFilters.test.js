import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/StorageService', () => ({ default: {} }));
vi.mock('../src/services/BooruService', () => ({ default: { getTagLimit: () => 2 } }));
vi.mock('../src/services/ProfileService', () => ({ getActiveProfileDbName: () => 'test' }));
vi.mock('../src/services/ImageAnalysisService.js', () => ({ default: { subscribe() {} } }));
vi.mock('../src/services/ImageAnalysisCache.js', () => ({ hydrateImageAnalysis: async () => {} }));
vi.mock('../src/stores/settings.js', () => ({ useSettingsStore: () => ({ aiTaggingEnabled: false }) }));

// Minimal stand-in for the recommendation worker: one strategy query, and
// feed assembly that returns every candidate it is given.
const strategies = vi.hoisted(() => ({ queries: [{ tags: '1girl', type: 'anchor' }] }));
globalThis.Worker = class {
  postMessage({ id, type, payload }) {
    const result = type === 'generateMultiStrategyQueries' ? strategies.queries
      : type === 'assembleFeed' ? { feed: payload.posts, rest: [] }
      : true;
    queueMicrotask(() => this.onmessage({ data: { id, type: 'success', result } }));
  }
};

const { default: recommendations } = await import('../src/services/RecommendationSystem.js');

const post = (id, tags, rating = 'g') => ({ id, source: 'src', tag_string: tags, rating });
const options = (extra = {}) => ({ whitelist: [], blacklist: [], selectedRatings: ['general'], wantsImages: true, wantsVideos: true, ...extra });

describe('content filters', () => {
  it('drops blacklisted posts even when the query fits the tag limit', async () => {
    recommendations.resetExploreSession();
    const sent = [];
    const fetch = async (query) => { sent.push(query.tags); return [post(1, '1girl spider'), post(2, '1girl cat')]; };
    const feed = await recommendations.getCuratedExploreFeed(fetch, options({ blacklist: ['spider'] }));
    expect(feed.map(p => p.id)).toEqual([2]);
    // The blacklist never takes one of the source's search-tag slots.
    expect(sent[0]).not.toContain('spider');
  });

  it('keeps two positive tags in the query alongside a local blacklist', async () => {
    recommendations.resetExploreSession();
    strategies.queries = [{ tags: 'cat', type: 'anchor' }];
    const sent = [];
    const fetch = async (query) => { sent.push(query.tags); return [post(3, 'meme cat'), post(4, 'meme cat spider')]; };
    const feed = await recommendations.getCuratedExploreFeed(fetch, options({ whitelist: ['meme'], blacklist: ['spider'] }));
    expect(sent[0].split(' ').slice(0, 2)).toEqual(['meme', 'cat']);
    expect(feed.map(p => p.id)).toEqual([3]);
  });

  it('matches blacklist tags regardless of case', () => {
    expect(recommendations.applyContentFilters([post(5, 'Spider cat')], { blacklist: ['spider'] })).toEqual([]);
  });

  it('drops posts whose rating was not asked for', () => {
    const posts = [post(6, 'a', 'g'), post(7, 'a', 's'), post(8, 'a', 'e'), post(9, 'a', undefined)];
    const kept = recommendations.applyContentFilters(posts, { selectedRatings: ['general'] });
    expect(kept.map(p => p.id)).toEqual([6, 9]);
  });
});
