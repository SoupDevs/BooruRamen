import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import StorageService from '../src/services/StorageService.js';
import { db } from '../src/services/db.js';

describe('Clear All Data', () => {
  it('empties every table, including image analysis and the tag catalog', async () => {
    await db.imageAnalysis.put({ key: 'post', updatedAt: 1 });
    await db.sourceTags.put({ source: 's', name: 'cat' });
    await db.tagCatalogState.put({ source: 's' });
    await db.interactions.add({ postId: 1, type: 'like', source: 's', timestamp: 1 });
    expect(await StorageService.clearAllData()).toBe(true);
    const counts = await Promise.all(db.tables.map(table => table.count()));
    expect(counts.every(count => count === 0)).toBe(true);
  });
});
