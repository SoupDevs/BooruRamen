import { describe, it, expect } from 'vitest';
import { DeepDiveInterest } from '../src/services/DeepDiveInterest.js';
const post = (id, tags, extra = {}) => ({ id, source: 'source', tag_string: tags, file_ext: 'jpg', ...extra });

describe('Deep Dive similarity', () => {
  it('makes anchor similarity dominate a conflicting profile and keeps its anchor fixed', () => {
    const dive = new DeepDiveInterest();
    const anchor = post(1, 'landscape mountain');
    dive.start(anchor);
    anchor.tag_string = 'portrait';
    expect(dive.blend(0.01, post(2, 'landscape mountain'), [])).toBeGreaterThan(dive.blend(0.99, post(3, 'portrait'), []));
    expect(dive.anchor.tag_string).toBe('landscape mountain');
    dive.end();
    expect(dive.blend(0.77, post(3, 'portrait'), [])).toBe(0.77);
  });
  it('uses image composition to distinguish candidates with the same tags', () => {
    const dive = new DeepDiveInterest();
    dive.start(post(1, 'landscape', { imageAnalysis: { composition: new Array(32).fill(0.9) } }));
    expect(dive.similarity(post(2, 'landscape', { imageAnalysis: { composition: new Array(32).fill(0.9) } })))
      .toBeGreaterThan(dive.similarity(post(3, 'landscape', { imageAnalysis: { composition: new Array(32).fill(0.1) } })));
  });
  it('queries anchor tags instead of profile interests, excluding noise and metadata', () => {
    const dive = new DeepDiveInterest();
    dive.start(post(1, 'landscape mountain solo highres character', { tag_string_character: 'character', tag_string_meta: 'highres' }));
    const queries = dive.queries(['solo']);
    expect(queries[0].tags).toContain('character');
    expect(queries.every(query => query.type === 'deepDive' && !query.tags.includes('solo') && !query.tags.includes('highres'))).toBe(true);
    dive.refresh(post(1, 'other', { source: 'other-source' }));
    expect(dive.anchor.tag_string).toContain('landscape');
  });
  it('limits a long dive to a small lasting contribution', () => {
    const dive = new DeepDiveInterest(); dive.start(post(1, 'landscape'));
    let total = 0;
    for (let id = 2; id < 500; id++) total += dive.profileWeight(post(id, 'landscape'), 'favorite', 1, []) * 2;
    expect(total).toBeLessThanOrEqual(0.200001);
    expect(total).toBeGreaterThan(0);
  });
});
