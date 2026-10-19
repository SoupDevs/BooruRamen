import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/StorageService', () => ({ default: {} }));
vi.mock('../src/services/BooruService', () => ({ default: { getTagLimit: () => 2 } }));
vi.mock('../src/services/ProfileService', () => ({ getActiveProfileDbName: () => 'test' }));
vi.mock('../src/services/ImageAnalysisService.js', () => ({ default: { subscribe() {} } }));
vi.mock('../src/services/ImageAnalysisCache.js', () => ({ hydrateImageAnalysis: async () => {} }));
vi.mock('../src/stores/settings.js', () => ({ useSettingsStore: () => ({ aiTaggingEnabled: false }) }));

// Two strategies that become the same request once the whitelist takes the
// first tag slot and the second tag is trimmed off by the 2-tag limit.
globalThis.Worker = class {
  postMessage({ id, type, payload }) {
    const result = type === 'generateMultiStrategyQueries'
      ? [{ tags: 'cat', type: 'anchor' }, { tags: 'cat dog', type: 'explore' }, { tags: 'fox', type: 'trend' }]
      : type === 'assembleFeed' ? { feed: payload.posts, rest: [] }
      : true;
    queueMicrotask(() => this.onmessage({ data: { id, type: 'success', result } }));
  }
};

const { default: recommendations } = await import('../src/services/RecommendationSystem.js');

describe('query dedupe', () => {
  it('sends each distinct API request once per batch', async () => {
    recommendations.resetExploreSession();
    const sent = [];
    let next = 1;
    const fetch = async (query) => {
      sent.push(`${query.tags}|${query.page}`);
      return Array.from({ length: 5 }, () => ({ id: next++, source: 's', tag_string: 'meme cat fox' }));
    };
    await recommendations.getCuratedExploreFeed(fetch, { whitelist: ['meme'], blacklist: [], selectedRatings: ['general'], wantsImages: true, wantsVideos: true });
    expect(sent.map(request => request.split(' ').slice(0, 2).join(' '))).toEqual(['meme cat', 'meme fox']);
    expect(sent.every(request => request.endsWith('|1'))).toBe(true);
  });
});
