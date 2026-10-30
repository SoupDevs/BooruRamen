import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StorageService from '../src/services/StorageService.js';
import BooruService from '../src/services/BooruService.js';
import { applyNeverInclude, sanitizeNeverInclude, withoutNeverIncluded } from '../src/services/overrideRules.js';

const post = (id, rating) => ({ id, rating, tag_string: 'a' });

describe('override rules', () => {
  it('keeps only known options, once each', () => {
    expect(sanitizeNeverInclude(['Explicit', 'e', 'bogus', 'q'])).toEqual(['explicit', 'questionable']);
    expect(sanitizeNeverInclude(undefined)).toEqual([]);
  });

  it('drops excluded posts by code or name and keeps unclassified ones', () => {
    const posts = [post(1, 'g'), post(2, 'q'), post(3, 'explicit'), post(4, undefined)];
    expect(applyNeverInclude(posts, ['questionable', 'explicit']).map(p => p.id)).toEqual([1, 4]);
    expect(applyNeverInclude(posts, [])).toBe(posts);
  });

  it('narrows a list of options', () => {
    expect(withoutNeverIncluded(['general', 's'], ['sensitive'])).toEqual(['general']);
    expect(withoutNeverIncluded(['general'], ['general'])).toEqual([]);
  });
});

describe('override rules on fetch', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('filters every fetch through BooruService', async () => {
    vi.spyOn(StorageService, 'loadAppSettings').mockResolvedValue({ settings: { overrideNeverInclude: ['explicit'] } });
    vi.spyOn(BooruService, 'applyTagOverrides').mockImplementation(async tags => tags);
    const adapters = BooruService.adapters;
    BooruService.adapters = [{ getPosts: async () => [post(1, 'g'), post(2, 'e')] }];
    try {
      const posts = await BooruService.getPosts({ tags: 'cat' });
      expect(posts.map(p => p.id)).toEqual([1]);
    } finally {
      BooruService.adapters = adapters;
    }
  });
});
