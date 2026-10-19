import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DanbooruAdapter } from '../src/services/BooruAdapters.js';
import BooruService from '../src/services/BooruService.js';

afterEach(() => vi.restoreAllMocks());

const ugoira = () => ({
  id: 1, file_ext: 'zip', source: 'https://www.pixiv.net/artworks/1',
  file_url: 'https://cdn.donmai.us/original/aa/bb/x.zip',
  large_file_url: 'https://cdn.donmai.us/sample/aa/bb/sample-x.webm',
});

describe('Danbooru ugoira', () => {
  it('plays the webm rendition and keeps the zip', () => {
    const post = new DanbooruAdapter().normalizePost(ugoira());
    expect(post.file_ext).toBe('webm');
    expect(post.file_url).toBe('https://cdn.donmai.us/sample/aa/bb/sample-x.webm');
    expect(post.ugoira_zip_url).toBe('https://cdn.donmai.us/original/aa/bb/x.zip');
  });

  it('leaves a zip without a webm rendition as a zip', () => {
    const post = new DanbooruAdapter().normalizePost({ ...ugoira(), large_file_url: 'https://cdn.donmai.us/sample/aa/bb/sample-x.jpg' });
    expect(post.file_ext).toBe('zip');
  });

  it('drops posts that still cannot be played', async () => {
    const original = BooruService.adapters;
    BooruService.adapters = [{ getPosts: async () => [{ id: 1, file_ext: 'zip' }, { id: 2, file_ext: 'webm' }, { id: 3, file_ext: 'swf' }] }];
    vi.spyOn(BooruService, 'applyTagOverrides').mockImplementation(async tags => tags);
    try {
      const posts = await BooruService.getPosts({ tags: '', page: 1, limit: 5 });
      expect(posts.map(p => p.id)).toEqual([2]);
    } finally { BooruService.adapters = original; }
  });
});
