import 'fake-indexeddb/auto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { GelbooruAdapter, MoebooruAdapter, DanbooruAdapter, moebooruAgeDate } from '../src/services/BooruAdapters.js';
import BooruService from '../src/services/BooruService.js';
import { BanditExplorer } from '../src/services/BanditExplorer.js';
import * as http from '../src/services/httpClient.js';

afterEach(() => { vi.restoreAllMocks(); });

const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const sentTags = (spy) => new URLSearchParams(spy.mock.calls[0][0].split('?')[1]).get('tags');

describe('Gelbooru sort translation', () => {
  const gelbooru = () => {
    const adapter = new GelbooruAdapter('https://gelbooru.com', {});
    adapter.throttle = async () => {};
    return adapter;
  };

  it('maps hot orders to score and random to sort:random', async () => {
    const spy = vi.spyOn(http, 'httpFetch').mockResolvedValue(jsonResponse({ post: [] }));
    await gelbooru().getPosts({ tags: 'cat order:rank', page: 1, limit: 5, skipSort: true });
    expect(sentTags(spy)).toBe('cat sort:score:desc');
    spy.mockClear();
    await gelbooru().getPosts({ tags: 'cat order:random', page: 1, limit: 5, skipSort: true });
    expect(sentTags(spy)).toBe('cat sort:random');
  });

  it('leaves the order alone when the feed asks to skip the default sort', async () => {
    const spy = vi.spyOn(http, 'httpFetch').mockResolvedValue(jsonResponse({ post: [] }));
    await gelbooru().getPosts({ tags: 'cat', page: 1, limit: 5, sort: 'score', skipSort: true });
    expect(sentTags(spy)).toBe('cat');
  });

  it('throws on a failed request instead of reporting no posts', async () => {
    vi.spyOn(http, 'httpFetch').mockResolvedValue({ ok: false, status: 503 });
    await expect(gelbooru().getPosts({ tags: 'cat', page: 1, limit: 5 })).rejects.toThrow('503');
  });
});

describe('Moebooru translation', () => {
  it('computes calendar dates for age filters', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    expect(moebooruAgeDate('1', 'd', now)).toBe('2026-10-18');
    expect(moebooruAgeDate('2', 'w', now)).toBe('2026-10-05');
    expect(moebooruAgeDate('1', 'mo', now)).toBe('2026-09-19');
    expect(moebooruAgeDate('1', 'y', now)).toBe('2025-10-19');
    expect(moebooruAgeDate('1', 'h', now)).toBe('');
  });

  it('turns age: and hot orders into terms Moebooru understands', async () => {
    const spy = vi.spyOn(http, 'httpFetch').mockResolvedValue(jsonResponse([]));
    await new MoebooruAdapter('https://yande.re').getPosts({ tags: 'cat age:<1w order:rank', page: 1, limit: 5 });
    const tags = sentTags(spy);
    expect(tags).toMatch(/^cat date:>=\d{4}-\d{2}-\d{2} order:score$/);
  });

  it('throws on a failed request', async () => {
    vi.spyOn(http, 'httpFetch').mockRejectedValue(new Error('offline'));
    await expect(new MoebooruAdapter('https://yande.re').getPosts({ tags: 'cat', page: 1, limit: 5 })).rejects.toThrow('offline');
  });
});

describe('Danbooru errors', () => {
  it('throws on a failed request', async () => {
    vi.spyOn(http, 'httpFetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(new DanbooruAdapter().getPosts({ tags: 'cat', page: 1, limit: 5 })).rejects.toThrow();
  });
});

describe('multi-source fetching', () => {
  const withAdapters = (adapters) => {
    const original = BooruService.adapters;
    BooruService.adapters = adapters;
    vi.spyOn(BooruService, 'applyTagOverrides').mockImplementation(async tags => tags);
    return () => { BooruService.adapters = original; };
  };

  it('keeps the posts of sources that answered when another fails', async () => {
    const restore = withAdapters([
      { baseUrl: 'a', getPosts: async () => [{ id: 1, md5: 'x', source: 'a' }] },
      { baseUrl: 'b', getPosts: async () => { throw new Error('down'); } },
    ]);
    try {
      const posts = await BooruService.getPosts({ tags: 'cat', page: 1, limit: 5 });
      expect(posts.map(p => p.id)).toEqual([1]);
    } finally { restore(); }
  });

  it('throws when every source fails', async () => {
    const restore = withAdapters([
      { baseUrl: 'a', getPosts: async () => { throw new Error('down a'); } },
      { baseUrl: 'b', getPosts: async () => { throw new Error('down b'); } },
    ]);
    try {
      await expect(BooruService.getPosts({ tags: 'cat', page: 1, limit: 5 })).rejects.toThrow('down a');
    } finally { restore(); }
  });
});

describe('bandit stats', () => {
  it('averages the rewards in its history', () => {
    const bandit = new BanditExplorer();
    bandit.totalRewards = 100;
    bandit.rewardHistory = [{ reward: 1 }, { reward: 0 }];
    expect(bandit.getStats().avgReward).toBe(0.5);
  });
});
