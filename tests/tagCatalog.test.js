import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { db } from '../src/services/db.js';
import { TagSuggestionService } from '../src/services/TagSuggestionService.js';
import { rankTags } from '../src/services/tagMatching.js';
import { hydrateImageAnalysis } from '../src/services/ImageAnalysisCache.js';
import { analysisKey } from '../src/services/contentIdentity.js';

vi.mock('../src/services/GelbooruTagCache.js', () => ({ gelbooruTagCache: { init() {} } }));
vi.mock('../src/services/httpClient.js', () => ({ httpFetch: vi.fn() }));
import { httpFetch } from '../src/services/httpClient.js';
import { DanbooruAdapter, GelbooruAdapter, MoebooruAdapter } from '../src/services/BooruAdapters.js';

afterEach(() => vi.clearAllMocks());
function suggestions() { const service = new TagSuggestionService(); service.startCatalog = vi.fn(); return service; }

describe('source membership', () => {
  it('merges shared tags once and immediately removes disabled-source-only tags', () => {
    const service = suggestions();
    service.ingestTags('shared cat cat_a', 'https://a/'); service.ingestTags('shared cat cat_b', 'https://b');
    service.setSources([{ url: 'https://a' }, { url: 'https://b' }], []);
    expect(service.suggest('cat', { limit: 20 })).toEqual(['cat', 'cat_a', 'cat_b']);
    service.setSources([{ url: 'https://b' }], []);
    expect(service.suggest('cat', { limit: 20 })).toEqual(['cat', 'cat_b']);
    expect(service.suggest('shared')).toEqual(['shared']);
    service.ingestTags('cat_unscoped'); expect(service.suggest('cat', { limit: 20 })).not.toContain('cat_unscoped');
  });
  it('drops stale remote answers when enabled sources change during a request', async () => {
    let finish;
    const service = suggestions(); service.request = vi.fn().mockResolvedValue([]);
    service.setSources([{ url: 'https://a' }], [{ baseUrl: 'https://a', searchTags: () => new Promise(resolve => { finish = resolve; }) }]);
    const pending = service.remoteSuggest('cat');
    service.setSources([{ url: 'https://b' }], []); finish(['cat_a']);
    expect(await pending).toEqual([]); expect(service.suggest('cat')).toEqual([]);
  });
  it('keeps ordered-character matching and excludes selected tags', () => {
    expect(rankTags(['shark_tail', 'cat_tail', 'shark_tail'], 'shtail', 10)).toEqual(['shark_tail']);
    expect(rankTags(['cat', 'cat_tail'], 'cat', 10, ['cat'])).toEqual(['cat_tail']);
  });
});

describe('catalog APIs', () => {
  it('walks Danbooru by ID cursor and does not mistake an API limit for the end', async () => {
    httpFetch.mockResolvedValue({ ok: true, json: async () => [{ id: 20, name: 'cat' }, { id: 19, name: 'dog' }] });
    const adapter = new DanbooruAdapter('https://a');
    const page = await adapter.getTagPage();
    expect(page.done).toBe(false); expect(page.nextCursor).toBe(19);
    await adapter.getTagPage(page.nextCursor);
    expect(decodeURIComponent(httpFetch.mock.calls[1][0])).toContain('page=b19');
  });
  it('uses Gelbooru pid and Moebooru page numbering, retaining credentials', async () => {
    httpFetch.mockResolvedValue({ ok: true, json: async () => ({ tag: [{ id: 1, name: 'cat' }] }) });
    const gel = new GelbooruAdapter('https://a', { userId: 'test', apiKey: 'test' }); gel.throttle = async () => {};
    expect((await gel.getTagPage()).nextCursor).toBe(1);
    expect(httpFetch.mock.calls[0][0]).toContain('pid=0'); expect(httpFetch.mock.calls[0][0]).toContain('user_id=test');
    httpFetch.mockResolvedValue({ ok: true, json: async () => [{ id: 1, name: 'cat' }] });
    const moe = new MoebooruAdapter('https://b');
    expect((await moe.getTagPage()).nextCursor).toBe(2);
    expect(httpFetch.mock.calls[1][0]).toContain('page=1');
  });
  it('only marks valid empty pages complete; malformed or failed responses stay errors', async () => {
    const adapter = new DanbooruAdapter('https://a');
    httpFetch.mockResolvedValue({ ok: true, json: async () => [] }); expect((await adapter.getTagPage()).done).toBe(true);
    httpFetch.mockResolvedValue({ ok: true, json: async () => ({ error: 'auth required' }) }); await expect(adapter.getTagPage()).rejects.toThrow('catalog');
    httpFetch.mockResolvedValue({ ok: false, status: 429 }); await expect(adapter.getTagPage()).rejects.toThrow('429');
  });
});

describe('persistent analysis', () => {
  it('shares cached data across boorus and can disable inferred tags without deleting source data', async () => {
    const a = { id: 1, source: 'a', md5: 'a'.repeat(32) }, b = { ...a, id: 7, source: 'b' };
    await db.imageAnalysis.put({ key: analysisKey(a), analysis: { version: 1, composition: Array(32).fill(0.5), aiTags: [{ name: 'cat', confidence: 0.9, category: 0 }] } });
    await hydrateImageAnalysis([b], { includeAi: false }); expect(b.imageAnalysis.aiTags).toEqual([]);
    await hydrateImageAnalysis([b]); expect(b.imageAnalysis.aiTags[0].name).toBe('cat');
    expect(db.verno).toBe(4);
  });
});
