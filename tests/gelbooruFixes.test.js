import { describe, it, expect, vi, afterEach } from 'vitest';
import { GelbooruAdapter } from '../src/services/BooruAdapters.js';
import BooruService from '../src/services/BooruService.js';
import { gelbooruTagCache } from '../src/services/GelbooruTagCache.js';
import * as http from '../src/services/httpClient.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const at = (iso) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };
const idBound = (term) => Number(term.match(/id:[<>](\d+)/)[1]);

describe('Gelbooru age: translation', () => {
  const gelbooru = new GelbooruAdapter('https://gelbooru.com', {});

  it('keeps age filters in years past the ID table instead of dropping them', () => {
    at('2026-10-19T12:00:00Z');
    for (const age of [['<', '1', 'd'], ['<', '1', 'w'], ['<', '1', 'mo'], ['>', '3', 'mo']]) {
      expect(gelbooru.translateAgeToId(...age)).toMatch(/^id:[<>]\d+$/);
    }
    const day = idBound(gelbooru.translateAgeToId('<', '1', 'd'));
    const month = idBound(gelbooru.translateAgeToId('<', '1', 'mo'));
    expect(day).toBeGreaterThan(month);
    expect(month).toBeGreaterThan(11229486);
  });

  it('produces bounds that never decrease across the year rollover', () => {
    at('2026-01-02T12:00:00Z');
    const justAfter = idBound(gelbooru.translateAgeToId('<', '1', 'd'));
    at('2025-12-31T12:00:00Z');
    const justBefore = idBound(gelbooru.translateAgeToId('<', '1', 'd'));
    expect(justAfter).toBeGreaterThan(justBefore);
  });

  it('leaves dates before 2025 unchanged', () => {
    at('2024-06-15T12:00:00Z');
    // 2023-06-15: 166 days into 2023, interpolated between the 2023 and 2024 anchors
    const expected = 8084028 + Math.floor((9425769 - 8084028) * (Math.floor((new Date(2023, 5, 15, 12) - new Date(2023, 0, 1)) / 86400000) / 365));
    expect(gelbooru.translateAgeToId('<', '1', 'y')).toBe(`id:>${expected}`);
  });

  it('drops the age term for other Gelbooru-engine sites', () => {
    at('2026-10-19T12:00:00Z');
    expect(new GelbooruAdapter('https://safebooru.org', {}).translateAgeToId('<', '1', 'mo')).toBe('');
    at('2025-03-01T12:00:00Z');
    expect(new GelbooruAdapter('https://custom-gelbooru.example', {}).translateAgeToId('<', '1', 'mo')).toBe('');
  });
});

describe('Gelbooru tag categories', () => {
  it('requests the absolute API URL and does not cache failures as general', async () => {
    const adapter = new GelbooruAdapter('https://gelbooru.com/', {});
    adapter.throttle = async () => {};
    const fetchSpy = vi.spyOn(http, 'httpFetch').mockResolvedValue({ ok: false, status: 401 });
    vi.spyOn(gelbooruTagCache, 'setCategory');

    await adapter.fetchTagCategories(['uncached_tag_a']);

    // Vitest runs with import.meta.env.DEV, which maps gelbooru.com to the dev proxy;
    // outside dev toDevProxiedUrl leaves the absolute gelbooru.com URL untouched.
    expect(fetchSpy.mock.calls[0][0]).toMatch(/^\/api\/gelbooru\/index\.php\?page=dapi&s=tag/);
    expect(gelbooruTagCache.setCategory).not.toHaveBeenCalled();
    expect(gelbooruTagCache.getCategory('uncached_tag_a')).toBeNull();

    // Within the cooldown the failed tag is not requested again
    await adapter.fetchTagCategories(['uncached_tag_a']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('multi-source merge shuffle', () => {
  it('is a uniform permutation of the deduplicated posts', async () => {
    const posts = (source) => Array.from({ length: 5 }, (_, i) => ({ id: i, md5: `${source}${i}` }));
    BooruService.adapters = [
      { baseUrl: 'a', getPosts: async () => posts('a') },
      { baseUrl: 'b', getPosts: async () => posts('b') },
    ];
    BooruService.applyTagOverrides = async (tags) => tags;
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const firstCounts = new Map();
    const runs = 4000;
    for (let r = 0; r < runs; r++) {
      const merged = await BooruService.fetchPosts({ tags: '' });
      expect(merged.map(p => p.md5).sort()).toEqual([...posts('a'), ...posts('b')].map(p => p.md5).sort());
      firstCounts.set(merged[0].md5, (firstCounts.get(merged[0].md5) ?? 0) + 1);
    }
    // 10 posts: each should lead ~400 times; the old comparator sort led with a0 ~2x as often
    for (const count of firstCounts.values()) expect(count).toBeGreaterThan(300);
    for (const count of firstCounts.values()) expect(count).toBeLessThan(500);
  });
});
