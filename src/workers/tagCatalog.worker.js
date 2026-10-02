import { db } from '../services/db.js';
import { rankTags } from '../services/tagMatching.js';

const catalogs = new Map();
const loads = new Map();
async function load(source) {
  if (catalogs.has(source)) return catalogs.get(source);
  if (!loads.has(source)) loads.set(source, (async () => {
    const rows = await db.sourceTags.where('source').equals(source).toArray();
    const tags = new Set(rows.map(row => row.name)); catalogs.set(source, tags); return tags;
  })().finally(() => loads.delete(source)));
  return loads.get(source);
}

self.onmessage = async ({ data: { id, type, payload } }) => {
  try {
    let result;
    if (type === 'load') {
      const tags = await load(payload.source);
      result = { count: tags.size, state: await db.tagCatalogState.get(payload.source) };
    } else if (type === 'page') {
      const tags = await load(payload.source);
      const rows = payload.tags.map(tag => ({ source: payload.source, name: tag.name }));
      await db.transaction('rw', db.sourceTags, db.tagCatalogState, async () => {
        await db.sourceTags.bulkPut(rows);
        await db.tagCatalogState.put({ source: payload.source, ...payload.state });
      });
      rows.forEach(row => tags.add(row.name));
      result = { count: tags.size };
    } else if (type === 'search') {
      const lists = await Promise.all(payload.sources.map(load));
      const all = function* () { for (const tags of lists) yield* tags; };
      result = rankTags(all(), payload.query, payload.limit, payload.exclude || []);
    } else throw new Error('Unknown tag catalog request.');
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
