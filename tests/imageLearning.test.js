import { describe, it, expect, vi } from 'vitest';
import { contentKeys, excludeDuplicateContent } from '../src/services/contentIdentity.js';
import { extractImageFeatures, learningPost } from '../src/services/imageFeatures.js';
import { rgbaToBgr, parseTagLabels, selectAiTags } from '../src/services/wdTagger.js';

vi.mock('../src/services/StorageService', () => ({ default: { getProfileSnapshot: async () => null } }));
vi.mock('../src/services/TagEmbedding', () => ({ default: {
  getAverageEmbedding: () => new Float32Array(32).fill(0.1),
  getPostEmbedding: () => new Float32Array(32).fill(0.1),
} }));
import { MLScorer } from '../src/services/MLScorer.js';

const md5 = 'a'.repeat(32);
const post = (id, source, extra = {}) => ({ id, source, file_ext: 'jpg', tag_string: 'landscape', ...extra });
function pixels(bright) {
  return Uint8ClampedArray.from({ length: 32 * 32 * 4 }, (_, i) => i % 4 === 3 ? 255 : bright);
}

describe('content identity', () => {
  it('deduplicates same-source and cross-source copies, including history', () => {
    const original = post(1, 'a', { md5 });
    const copy = post(2, 'b', { md5: md5.toUpperCase() });
    const sameIdOtherImage = post(1, 'b', { md5: 'b'.repeat(32) });
    expect(excludeDuplicateContent([original, copy, sameIdOtherImage])).toEqual([original, sameIdOtherImage]);
    expect(excludeDuplicateContent([copy], new Set(contentKeys(original)))).toEqual([]);
  });
  it('matches computed MD5 to a booru hash and never deduplicates by perceptual hash', () => {
    const original = post(1, 'a', { md5 });
    const computed = post(2, 'b', { imageAnalysis: { md5 } });
    expect(excludeDuplicateContent([original, computed])).toEqual([original]);
    const pair = [post(1, 'a'), post(2, 'b')].map(p => ({ ...p, imageAnalysis: { perceptualHash: '0'.repeat(16) } }));
    expect(excludeDuplicateContent(pair)).toHaveLength(2);
  });
});

describe('visual learning', () => {
  it('encodes composition even for identical tags and identical perceptual hashes', () => {
    const dark = extractImageFeatures(pixels(0)), light = extractImageFeatures(pixels(255));
    expect(dark.perceptualHash).toEqual(light.perceptualHash);
    expect(dark.composition[24]).toBe(0); expect(light.composition[24]).toBeCloseTo(1);
    const scorer = new MLScorer();
    const a = scorer.extractFeatures(post(1, 'a', { imageAnalysis: dark }), {}, {});
    const b = scorer.extractFeatures(post(2, 'a', { imageAnalysis: light }), {}, {});
    expect(a.length).toBe(179); expect(a[178]).toBe(1);
    expect(Array.from(a.slice(0, 82))).toEqual(Array.from(b.slice(0, 82)));
    expect(Array.from(a.slice(82))).not.toEqual(Array.from(b.slice(82)));
    expect(scorer.extractFeatures(post(3, 'a'), {}, {})[178]).toBe(0);
  });
  it('migrates an 82-input model without changing tag predictions', () => {
    const scorer = new MLScorer(), snapshot = scorer.toSnapshot();
    snapshot.weights1 = snapshot.weights1.slice(0, 82);
    snapshot.featureMeans = snapshot.featureMeans.slice(0, 82);
    snapshot.featureStds = snapshot.featureStds.slice(0, 82);
    snapshot.interactionCount = 35;
    scorer.loadFromSnapshot(snapshot);
    const plain = post(1, 'a'), visual = { ...plain, imageAnalysis: extractImageFeatures(pixels(255)) };
    expect(scorer.weights1).toHaveLength(179); expect(scorer.interactionCount).toBe(35);
    expect(scorer.forward(scorer.extractFeatures(plain, {}, {}))).toBe(scorer.forward(scorer.extractFeatures(visual, {}, {})));
  });
  it('updates already-recorded training features when background work finishes, without adding fake interactions', () => {
    const scorer = new MLScorer(), p = post(1, 'a');
    scorer.addTrainingSample(p, 'like', 1, {}, {});
    expect(scorer.replayBuffer[0].features[178]).toBe(0);
    scorer.refreshPostFeatures({ ...p, imageAnalysis: extractImageFeatures(pixels(255)) }, {}, {});
    expect(scorer.replayBuffer[0].features[178]).toBe(1);
    expect(scorer.interactionCount).toBe(1);
  });
  it('uses confident inferred tags for learning while preserving source tags and ratings', () => {
    const p = post(1, 'a', { rating: 'g', imageAnalysis: { aiTags: [
      { name: 'sunset', confidence: 0.9, category: 0 },
      { name: 'uncertain', confidence: 0.1, category: 0 },
      { name: 'explicit', confidence: 0.99, category: 9 },
    ] } });
    expect(learningPost(p).tag_string).toBe('landscape sunset');
    expect(p.tag_string).toBe('landscape'); expect(learningPost(p).rating).toBe('g');
  });
});

describe('WD model input and vocabulary', () => {
  it('uses NHWC BGR values in 0..255 rather than normalizing or swapping tensor dimensions', () => {
    expect(Array.from(rgbaToBgr([1, 2, 3, 255, 10, 20, 30, 255]))).toEqual([3, 2, 1, 30, 20, 10]);
  });
  it('parses quoted tags and applies separate category thresholds', () => {
    const labels = parseTagLabels('tag_id,name,category\n1,"tag,with,commas",0\n2,character,4\n3,explicit,9\n');
    expect(selectAiTags(labels, [0.6, 0.6, 0.99]).map(tag => tag.name)).toEqual(['tag,with,commas']);
    expect(() => selectAiTags(labels, [0.8])).toThrow('do not match');
  });
});
