import { describe, expect, it } from 'vitest';
import { GlobalTagGraph, TREND_HALF_LIFE_MS } from '../src/services/GlobalTagGraph.js';

const post = (tags, query = '') => ({ tag_string: tags, _searchCriteria: query });
const repeat = (n, make) => Array.from({ length: n }, (_, i) => make(i));

describe('global tag graph', () => {
  it('learns IDF from the candidate stream', () => {
    const graph = new GlobalTagGraph();
    graph.observe(repeat(100, i => post(`common tag${i % 20}`)));
    expect(graph.idf('common')).toBeLessThan(0.1);
    expect(graph.idf('tag3')).toBeGreaterThan(graph.idf('common'));
    expect(graph.idf('never_seen')).toBe(1);
  });
  it('finds unfamiliar neighbours of the user’s interests', () => {
    const graph = new GlobalTagGraph();
    const interests = new Set(['witch']);
    graph.observe([
      ...repeat(30, () => post('witch hat broom')),
      ...repeat(10, () => post('witch familiar')),
      ...repeat(60, i => post(`hat other${i}`)),
    ], { interests });
    const adjacent = graph.adjacentTags([{ tag: 'witch', score: 1 }], tag => (tag === 'broom' ? 50 : 0), new Set(['witch']));
    const names = adjacent.map(item => item.tag);
    expect(names).toContain('familiar');
    // hat is everywhere, so co-occurring with it says little.
    expect(names.indexOf('familiar')).toBeLessThan(names.indexOf('hat') === -1 ? Infinity : names.indexOf('hat'));
    // Already well known to the user: ranked below the unfamiliar neighbour.
    expect(names.indexOf('familiar')).toBeLessThan(names.indexOf('broom'));
  });
  it('surfaces trends near the user’s taste and lets them fade', () => {
    let now = 0;
    const graph = new GlobalTagGraph(null, () => now);
    graph.observe(repeat(200, i => post(`base${i % 40}`)));
    graph.observe([
      ...repeat(15, () => post('new_show cat', 'order:rank')),
      ...repeat(15, () => post('other_show dog', 'order:rank')),
    ], { isTrending: p => p._searchCriteria.includes('order:rank') });
    const trends = graph.personalTrends(tag => (tag === 'new_show' ? 0.8 : 0)).map(item => item.tag);
    expect(trends).toEqual(['new_show']);
    now += 10 * TREND_HALF_LIFE_MS;
    graph.observe(repeat(5, i => post(`base${i}`)));
    expect(graph.trendLift('new_show')).toBe(0);
  });
  it('round-trips through a snapshot', () => {
    const graph = new GlobalTagGraph();
    graph.observe(repeat(60, () => post('witch hat')), { interests: new Set(['witch']) });
    const restored = new GlobalTagGraph(JSON.parse(JSON.stringify(graph.toSnapshot())));
    expect(restored.idf('hat')).toBeCloseTo(graph.idf('hat'), 6);
    expect(restored.neighbors.get('witch').get('hat')).toBe(60);
  });
});
