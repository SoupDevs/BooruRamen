import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../src/services/RecommendationSystem', () => ({
  default: { trackInteraction: async () => true },
  deepDiveState: { active: false },
}));
import { createPinia, setActivePinia } from 'pinia';
import StorageService from '../src/services/StorageService.js';
import { useInteractionsStore } from '../src/stores/interactions.js';

const danbooru = { id: 123, source: 'https://danbooru.donmai.us', tag_string: 'a' };
const gelbooru = { id: 123, source: 'https://gelbooru.com', tag_string: 'b' };

beforeEach(() => setActivePinia(createPinia()));

describe('like state per booru', () => {
  it('keeps the same post ID on two boorus apart in storage', async () => {
    await StorageService.storeInteraction({ postId: 123, type: 'like', value: 1, metadata: { post: danbooru } });
    const forGelbooru = await StorageService.getPostInteractions(123, gelbooru.source);
    const forDanbooru = await StorageService.getPostInteractions(123, danbooru.source);
    expect(forGelbooru.some(i => i.type === 'like' && i.value > 0)).toBe(false);
    expect(forDanbooru.some(i => i.type === 'like' && i.value > 0)).toBe(true);
  });

  it('keeps the same post ID on two boorus apart in the store', async () => {
    const store = useInteractionsStore();
    await store.logInteraction({ postId: 123, type: 'favorite', value: 1, metadata: { post: danbooru } });
    await store.logInteraction({ postId: 123, type: 'favorite', value: 0, metadata: { post: gelbooru } });
    expect(store.getPostStatus(danbooru).favorited).toBe(true);
    expect(store.getPostStatus(gelbooru).favorited).toBe(false);
  });
});
