import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/StorageService', () => ({ default: {} }));
vi.mock('../src/services/BooruService', () => ({ default: { getTagLimit: () => 2 } }));
vi.mock('../src/services/ProfileService', () => ({ getActiveProfileDbName: () => 'test' }));
vi.mock('../src/services/ImageAnalysisService.js', () => ({ default: { subscribe() {} } }));
vi.mock('../src/services/ImageAnalysisCache.js', () => ({ hydrateImageAnalysis: async () => {} }));
vi.mock('../src/stores/settings.js', () => ({ useSettingsStore: () => ({ aiTaggingEnabled: false }) }));

let strategies = [];
globalThis.Worker = class {
  postMessage({ id, type, payload }) {
    const result = type === 'generateMultiStrategyQueries' ? strategies
      : type === 'assembleFeed' ? { feed: payload.posts.slice(0, payload.options.maxTotal), rest: payload.posts.slice(payload.options.maxTotal) }
      : true;
    queueMicrotask(() => this.onmessage({ data: { id, type: 'success', result } }));
  }
};

const { default: recommendations, settleEarly, BATCH_SOFT_DEADLINE_MS } = await import('../src/services/RecommendationSystem.js');
const { httpFetch } = await import('../src/services/httpClient.js');

const posts = (first, count, tags = 'cat') => Array.from({ length: count }, (_, i) => ({ id: first + i, source: 's', rating: 'g', tag_string: tags }));
const options = { maxTotal: 5, whitelist: [], blacklist: ['spider'], selectedRatings: ['general'], wantsImages: true, wantsVideos: true };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

afterEach(() => { vi.useRealTimers(); });

describe('settleEarly', () => {
  it('returns at the deadline once the settled results are enough', async () => {
    vi.useFakeTimers();
    const slow = deferred();
    let settled = null;
    settleEarly([Promise.resolve([1, 2]), slow.promise], { deadlineMs: 100, ready: arrived => arrived.flat().length >= 2 }).then(value => { settled = value; });
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(60);
    expect(settled.done).toEqual([true, false]);
  });

  it('keeps waiting past the deadline while the results are not enough', async () => {
    vi.useFakeTimers();
    const slow = deferred();
    let settled = null;
    settleEarly([Promise.resolve([]), slow.promise], { deadlineMs: 100, ready: arrived => arrived.flat().length >= 2 }).then(value => { settled = value; });
    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toBeNull();
    slow.resolve([1, 2]);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled.done).toEqual([true, true]);
  });
});

describe('feed batches with a slow query', () => {
  it('does not wait for a stalled strategy and pools its posts when they arrive', async () => {
    vi.useFakeTimers();
    recommendations.resetExploreSession();
    strategies = [{ tags: 'cat', type: 'anchor' }, { tags: 'dog', type: 'pivot' }];
    const slow = deferred();
    const fetch = query => query.tags.startsWith('dog') ? slow.promise : Promise.resolve(posts(1, 8));
    let feed = null;
    recommendations.getCuratedExploreFeed(fetch, options).then(value => { feed = value; });
    await vi.advanceTimersByTimeAsync(BATCH_SOFT_DEADLINE_MS + 10);
    expect(feed.map(post => post.id)).toEqual([1, 2, 3, 4, 5]);

    // The stalled request answers later: its allowed posts wait in the pool.
    slow.resolve([...posts(100, 3, 'dog'), ...posts(200, 1, 'dog spider')]);
    await vi.advanceTimersByTimeAsync(0);
    const pooled = recommendations.candidatePool.map(post => post.id);
    expect(pooled).toEqual(expect.arrayContaining([6, 7, 8, 100, 101, 102]));
    expect(pooled).not.toContain(200);
  });

  it('drops late posts once the session has been reset', async () => {
    vi.useFakeTimers();
    recommendations.resetExploreSession();
    strategies = [{ tags: 'cat', type: 'anchor' }, { tags: 'dog', type: 'pivot' }];
    const slow = deferred();
    const fetch = query => query.tags.startsWith('dog') ? slow.promise : Promise.resolve(posts(1, 8));
    recommendations.getCuratedExploreFeed(fetch, options);
    await vi.advanceTimersByTimeAsync(BATCH_SOFT_DEADLINE_MS + 10);
    recommendations.resetExploreSession();
    slow.resolve(posts(100, 3, 'dog'));
    await vi.advanceTimersByTimeAsync(0);
    expect(recommendations.candidatePool).toEqual([]);
  });

  it('waits for every strategy while the batch would come back short', async () => {
    vi.useFakeTimers();
    recommendations.resetExploreSession();
    strategies = [{ tags: 'cat', type: 'anchor' }, { tags: 'dog', type: 'pivot' }];
    const slow = deferred();
    const fetch = query => query.tags.startsWith('dog') ? slow.promise : Promise.resolve(posts(1, 2));
    let feed = null;
    recommendations.getCuratedExploreFeed(fetch, options).then(value => { feed = value; });
    await vi.advanceTimersByTimeAsync(BATCH_SOFT_DEADLINE_MS * 2);
    expect(feed).toBeNull();
    slow.resolve(posts(100, 5, 'dog'));
    await vi.advanceTimersByTimeAsync(0);
    expect(feed).toHaveLength(5);
  });

  it('sends the fallback queries together', async () => {
    recommendations.resetExploreSession();
    strategies = [{ tags: 'cat', type: 'anchor' }];
    let inFlight = 0, peak = 0;
    const fetch = async query => {
      if (query.tags.startsWith('cat')) return [];
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
      return posts(query.tags.includes('rank') ? 1 : query.tags.includes('favcount') ? 10 : 20, 2);
    };
    const feed = await recommendations.getCuratedExploreFeed(fetch, options);
    expect(peak).toBe(3);
    expect(feed).toHaveLength(5);
  });
});

describe('httpFetch timeout', () => {
  it('aborts a request that runs past timeoutMs', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    });
    try {
      await expect(httpFetch('https://booru.test/posts.json', { timeoutMs: 20 })).rejects.toBeTruthy();
    } finally {
      globalThis.fetch = original;
    }
  });
});
