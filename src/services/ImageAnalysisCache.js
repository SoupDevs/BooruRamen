import { db } from './db.js';
import { analysisKey } from './contentIdentity.js';
import { IMAGE_ANALYSIS_VERSION } from './imageFeatures.js';

export async function hydrateImageAnalysis(posts, { includeAi = true } = {}) {
  if (!posts?.length) return posts;
  try {
    const entries = await db.imageAnalysis.bulkGet(posts.map(analysisKey));
    posts.forEach((post, i) => {
      const analysis = entries[i]?.analysis || post.imageAnalysis;
      if (analysis?.version === IMAGE_ANALYSIS_VERSION) post.imageAnalysis = includeAi ? analysis : { ...analysis, aiTags: [] };
    });
  } catch (error) { console.warn('[ImageAnalysis] Cache unavailable:', error); }
  return posts;
}
