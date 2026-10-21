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

import { whyChipText, SOMETHING_DIFFERENT } from '../src/services/WhyChip.js';
import { RecommendationWorkerCore } from '../src/workers/recommendation.worker.js';
const { default: FeedView } = await import('../src/views/FeedView.vue');

const post = (id, extra = {}) => ({ id, source: 's', tag_string: 'witch familiar', tag_string_general: 'witch familiar', ...extra });

beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('why-this-post text', () => {
  it('names the interest an adjacent pick is close to', () => {
    expect(whyChipText(post(1, { _strategy: 'adjacent', _reason: { tag: 'familiar', via: 'witch_hat' } }))).toBe('New for you: close to witch hat');
    expect(whyChipText(post(1, { _strategy: 'adjacent', _reason: { tag: 'familiar' } }))).toBe('New for you: familiar');
  });

  it('describes trending picks, with series names capitalised', () => {
    const trending = post(1, { _strategy: 'trending', _reason: { tag: 'genshin_impact', personal: true }, tag_string_copyright: 'genshin_impact' });
    expect(whyChipText(trending)).toBe('Trending near Genshin Impact');
    expect(whyChipText({ ...trending, _reason: { tag: 'genshin_impact', personal: false } })).toBe('Hot right now in Genshin Impact');
  });

  it('calls wildcard and exploration picks something different', () => {
    expect(whyChipText(post(1, { _strategy: 'wildcard' }))).toBe(SOMETHING_DIFFERENT);
    expect(whyChipText(post(1, { _strategy: 'anchor', _explore: true }))).toBe(SOMETHING_DIFFERENT);
  });

  it('gives exploit picks no chip', () => {
    for (const strategy of ['anchor', 'pivot', 'reach', 'fallback', 'deepDive']) expect(whyChipText(post(1, { _strategy: strategy }))).toBeNull();
  });

  it('never names a blacklisted, avoided, meta or metatag tag', () => {
    const adjacent = reason => post(1, { _strategy: 'adjacent', _reason: reason, tag_string_meta: 'highres' });
    expect(whyChipText(adjacent({ tag: 'familiar', via: 'spider' }), { blacklist: ['spider'] })).toBe('New for you: familiar');
    expect(whyChipText(adjacent({ tag: 'spider', via: 'web' }), { blacklist: ['spider'], avoided: ['web'] })).toBe(SOMETHING_DIFFERENT);
    expect(whyChipText(adjacent({ tag: 'highres' }))).toBe(SOMETHING_DIFFERENT);
    expect(whyChipText(post(1, { _strategy: 'trending', _reason: { tag: 'order:rank' } }))).toBe(SOMETHING_DIFFERENT);
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
    expect(queries.find(q => q.type === 'adjacent').reason).toEqual({ tag: 'familiar', via: 'witch' });
    expect(queries.find(q => q.type === 'trending').reason).toEqual({ tag: 'witch', personal: false });
  });
});

describe('feed chip', () => {
  function feed(settings = {}) {
    const vm = { ...FeedView.data.call({}), $route: { query: {} }, blacklistTags: [], avoidedTags: [], showWhyChips: true, focusMode: false, whyChipShown: new Set(), ...settings };
    for (const [name, fn] of Object.entries(FeedView.methods)) if (typeof fn === 'function') vm[name] = fn.bind(vm);
    return vm;
  }
  const discovery = post(1, { _strategy: 'wildcard' });

  it('shows once per post and fades on its own', () => {
    vi.useFakeTimers();
    const vm = feed();
    vm.showWhyChip(discovery);
    expect(vm.whyChip).toEqual({ key: 's|1', text: SOMETHING_DIFFERENT });
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
});
