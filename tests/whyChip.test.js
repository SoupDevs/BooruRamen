import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deepDive = vi.hoisted(() => ({ generation: 0, active: false }));
const storage = vi.hoisted(() => ({
  storeInteraction: async () => true, loadAppSettings: async () => ({}), getPreferences: async () => ({}),
  getProfileSnapshot: async () => null, getInteractions: async () => [], storeProfileSnapshot: async () => {},
  getViewedPosts: async () => ({}),
}));
vi.mock('../src/services/RecommendationSystem', () => ({ default: {}, deepDiveState: deepDive }));
vi.mock('../src/services/StorageService', () => ({ default: storage }));
vi.mock('../src/services/ImageAnalysisCache.js', () => ({ hydrateImageAnalysis: async () => {} }));
vi.mock('../src/services/ReportService', () => ({ default: {} }));
vi.mock('../src/services/BooruService', () => ({ default: {} }));
vi.mock('../src/services/TagSuggestionService', () => ({ default: { ingestTags() {} } }));
vi.mock('../src/services/ImageAnalysisService.js', () => ({ default: { enqueue() {}, subscribe() {} } }));
vi.mock('../src/stores/settings', () => ({ useSettingsStore: () => ({}) }));
vi.mock('../src/stores/player', () => ({ usePlayerStore: () => ({}) }));
vi.mock('../src/stores/interactions', () => ({ useInteractionsStore: () => ({}) }));

import { whyChipText } from '../src/services/WhyChip.js';
import { RecommendationWorkerCore } from '../src/workers/recommendation.worker.js';
const { default: FeedView } = await import('../src/views/FeedView.vue');

const post = (id, extra = {}) => ({ id, source: 's', tag_string: 'witch familiar', tag_string_general: 'witch familiar', ...extra });

beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('why-this-post text', () => {
  const liked = (tag, category = 'general') => ({ liked: { tag, category } });

  it('names the liked tag behind an exploration or wildcard pick', () => {
    expect(whyChipText(post(1, { _strategy: 'wildcard', _reason: liked('genshin_impact', 'copyright') }))).toBe('Because you liked Genshin Impact');
    expect(whyChipText(post(1, { _strategy: 'anchor', _explore: true, _reason: liked('witch_hat') }))).toBe('Because you liked witch hat');
  });

  it('names the interest an adjacent pick neighbours', () => {
    expect(whyChipText(post(1, { _strategy: 'adjacent', _reason: { tag: 'familiar', via: 'blue_archive', viaCategory: 'copyright' } }))).toBe('Because you liked Blue Archive');
    expect(whyChipText(post(1, { _strategy: 'adjacent', _reason: { tag: 'familiar', ...liked('witch') } }))).toBe('Because you liked witch');
    expect(whyChipText(post(1, { _strategy: 'adjacent', _reason: { tag: 'familiar' } }))).toBe('New for you: familiar');
  });

  it('describes trending picks', () => {
    const trending = post(1, { _strategy: 'trending', _reason: { tag: 'genshin_impact', personal: true }, tag_string_copyright: 'genshin_impact' });
    expect(whyChipText({ ...trending, _reason: { ...trending._reason, ...liked('genshin_impact', 'copyright') } })).toBe('Trending, because you liked Genshin Impact');
    expect(whyChipText(trending)).toBe('Trending in Genshin Impact');
  });

  it('falls back to what the post is about, or nothing', () => {
    expect(whyChipText(post(1, { _strategy: 'wildcard', tag_string_copyright: 'blue_archive' }))).toBe('New for you: Blue Archive');
    expect(whyChipText(post(1, { _strategy: 'wildcard' }))).toBeNull();
    expect(whyChipText(post(1, { _explore: true }))).toBeNull();
  });

  it('gives exploit picks no chip', () => {
    for (const strategy of ['anchor', 'pivot', 'reach', 'fallback', 'deepDive']) expect(whyChipText(post(1, { _strategy: strategy, _reason: liked('witch') }))).toBeNull();
  });

  it('never names a blacklisted, avoided, meta or metatag tag', () => {
    const adjacent = reason => post(1, { _strategy: 'adjacent', _reason: reason, tag_string_meta: 'highres' });
    expect(whyChipText(adjacent({ tag: 'familiar', via: 'spider' }), { blacklist: ['spider'] })).toBe('New for you: familiar');
    expect(whyChipText(adjacent({ tag: 'spider', via: 'web' }), { blacklist: ['spider'], avoided: ['web'] })).toBeNull();
    expect(whyChipText(adjacent({ tag: 'highres', ...liked('highres') }))).toBeNull();
    expect(whyChipText(post(1, { _strategy: 'trending', _reason: { tag: 'order:rank' } }))).toBe('Trending now');
  });
});

describe('liked reason at feed assembly', () => {
  it('picks the most-liked nameable tag, preferring series and characters', () => {
    const core = new RecommendationWorkerCore();
    core.avoidedTags = ['1girl'];
    core.tagCategories = { genshin_impact: 'copyright', highres: 'meta' };
    core.tagScores = { '1girl': 1, highres: 1, witch: 0.5, genshin_impact: 0.45, cat: 0.1 };
    const subject = { id: 1, tag_string: '1girl highres witch genshin_impact cat' };
    expect(core.likedReasonTag(subject)).toEqual({ tag: 'genshin_impact', category: 'copyright' });
    expect(core.likedReasonTag({ id: 2, tag_string: '1girl cat' })).toBeNull();
  });

  it('only explains discovery picks', () => {
    const core = new RecommendationWorkerCore();
    core.tagScores = { witch: 1 };
    core.tagCategories = {};
    core.scorePost = candidate => 1 - candidate.id * 0.01;
    core.postUncertainty = () => 0.5;
    const candidates = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, source: 's', tag_string: 'witch', _strategy: i === 1 ? 'wildcard' : 'anchor' }));
    const { feed } = core.assembleFeed(candidates, { maxTotal: 8 });
    for (const item of feed) {
      const discovery = item._explore || item._strategy === 'wildcard';
      expect(item._reason?.liked?.tag ?? null).toBe(discovery ? 'witch' : null);
    }
  });
});

describe('discovery queries carry their reason', () => {
  it('records which interest an adjacent tag came from', () => {
    const core = new RecommendationWorkerCore();
    core.tagScores = { witch: 1 };
    core.tagCategories = { witch: 'general' };
    core.banditExplorer = { selectTopK: () => [{ type: 'adjacent' }, { type: 'trending' }] };
    const make = (id, artist, tags) => ({ id, source: 's', tag_string: `${artist} ${tags}`, tag_string_artist: artist, tag_string_general: tags });
    core.observeCandidates([
      ...Array.from({ length: 30 }, (_, i) => make(100 + i, `w${i}`, 'witch familiar')),
      ...Array.from({ length: 60 }, (_, i) => make(i, `a${i}`, `filler${i}`)),
    ]);
    const queries = core.generateMultiStrategyQueries();
    expect(queries.find(q => q.type === 'adjacent').reason).toEqual({ tag: 'familiar', via: 'witch', viaCategory: 'general' });
    expect(queries.find(q => q.type === 'trending').reason).toEqual({ tag: 'witch', personal: false });
  });
});

describe('feed chip', () => {
  function feed(settings = {}) {
    const vm = { ...FeedView.data.call({}), $route: { query: {} }, blacklistTags: [], avoidedTags: [], showWhyChips: true, focusMode: false, whyChipShown: new Set(), ...settings };
    for (const [name, fn] of Object.entries(FeedView.methods)) if (typeof fn === 'function') vm[name] = fn.bind(vm);
    return vm;
  }
  const discovery = post(1, { _strategy: 'wildcard', _reason: { liked: { tag: 'witch', category: 'general' } } });

  it('shows once per post and fades on its own', () => {
    vi.useFakeTimers();
    const vm = feed();
    vm.showWhyChip(discovery);
    expect(vm.whyChip).toEqual({ key: 's|1', text: 'Because you liked witch' });
    vi.advanceTimersByTime(5000);
    expect(vm.whyChip).toBeNull();
    vm.showWhyChip(discovery);
    expect(vm.whyChip).toBeNull();
  });

  it('stays hidden when switched off, in focus mode and in Deep Dive', () => {
    expect((() => { const vm = feed({ showWhyChips: false }); vm.showWhyChip(discovery); return vm.whyChip; })()).toBeNull();
    expect((() => { const vm = feed({ focusMode: true }); vm.showWhyChip(discovery); return vm.whyChip; })()).toBeNull();
    deepDive.active = true;
    const vm = feed();
    vm.showWhyChip(discovery);
    expect(vm.whyChip).toBeNull();
    deepDive.active = false;
  });

  it('clears the previous chip when the user moves on', () => {
    const vm = feed();
    vm.showWhyChip(discovery);
    vm.showWhyChip(post(2, { _strategy: 'anchor' }));
    expect(vm.whyChip).toBeNull();
  });

  it('clears a chip on screen when focus mode turns on or chips are switched off', () => {
    for (const [watcher, value] of [['focusMode', true], ['showWhyChips', false]]) {
      const vm = feed();
      vm.showWhyChip(discovery);
      expect(vm.whyChip).not.toBeNull();
      FeedView.watch[watcher].call(vm, value);
      expect(vm.whyChip).toBeNull();
    }
  });
});
