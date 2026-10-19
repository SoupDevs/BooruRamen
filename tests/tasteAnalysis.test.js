import { describe, expect, it } from 'vitest';
import { analyzeTaste, layoutGraph } from '../src/services/TasteAnalysis.js';
import { describeTaste, joinList, tagLabel, tagEvidence } from '../src/services/TasteNarrative.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-19T21:00:00').getTime();
let nextId = 0;
const post = ({ artist = 'someone', copyright = '', character = '', general = 'scenery', ext = 'jpg' } = {}) => ({
  id: ++nextId, source: 'src', file_ext: ext,
  tag_string: [artist, copyright, character, general].filter(Boolean).join(' '),
  tag_string_artist: artist, tag_string_copyright: copyright, tag_string_character: character, tag_string_general: general,
});
const view = (p, ms, at, extra = {}) => ({ type: 'timeSpent', value: ms, timestamp: at, metadata: { post: p, ...extra } });
const act = (p, type, at) => ({ type, value: 1, timestamp: at, metadata: { post: p } });

function history() {
  const events = [];
  const at = i => NOW - 20 * DAY + i * 60 * 1000;
  let i = 0;
  // A loved series/artist: long looks, likes, a download.
  for (let n = 0; n < 12; n++) {
    const p = post({ artist: 'g7jay', copyright: 'zenless_zone_zero', character: 'wise_(zenless_zone_zero)', general: 'chibi meme' });
    if (n % 3 === 0) events.push(act(p, 'like', at(i)));
    if (n === 4) events.push(act(p, 'download', at(i)));
    events.push(view(p, 15000, at(i++), { engagement: 0.8 }));
  }
  // Skipped consistently.
  for (let n = 0; n < 10; n++) events.push(view(post({ artist: `x${n}`, general: 'comic' }), 600, at(i++), { engagement: 0.1 }));
  // Neutral filler.
  for (let n = 0; n < 15; n++) events.push(view(post({ artist: `f${n}`, general: 'scenery' }), 3000, at(i++), { engagement: 0.35 }));
  // New this week.
  for (let n = 0; n < 4; n++) events.push(view(post({ copyright: 'new_show', general: 'witch' }), 20000, NOW - 2 * DAY + n * 60000, { engagement: 0.85 }));
  // Deep Dive activity is excluded.
  events.push(view(post({ copyright: 'dive_only' }), 60000, NOW - DAY, { deepDive: true, engagement: 0.9 }));
  return events;
}

describe('taste analysis', () => {
  const analysis = analyzeTaste(history(), { now: NOW });
  it('ranks what the user responds to, with evidence', () => {
    expect(analysis.topByCategory.copyright[0].tag).toBe('zenless_zone_zero');
    expect(analysis.topByCategory.artist[0].tag).toBe('g7jay');
    const g7 = analysis.tags.get('g7jay');
    expect(g7.actions.like).toBe(4);
    expect(g7.actions.download).toBe(1);
    expect(tagEvidence(g7)).toMatch(/^Liked 4 · saved 1 · engaged with 12 of 12$/);
    expect(analysis.avoidedTags.map(entry => entry.tag)).toContain('comic');
    expect(analysis.tags.has('dive_only')).toBe(false);
  });
  it('notices new interests and engagement style', () => {
    expect(analysis.newInterests.map(entry => entry.tag)).toContain('new_show');
    expect(analysis.engagement.silentShare).toBeGreaterThan(0.5);
    expect(analysis.engagement.actions.download).toBe(1);
  });
  it('links tags enjoyed together', () => {
    const { nodes, edges } = analysis.graph;
    const index = tag => nodes.findIndex(node => node.tag === tag);
    expect(edges.some(edge => [edge.source, edge.target].includes(index('g7jay')) && [edge.source, edge.target].includes(index('zenless_zone_zero')))).toBe(true);
    const laid = layoutGraph(analysis.graph);
    expect(laid.every(node => node.x >= 0.08 && node.x <= 0.92 && node.y >= 0.06 && node.y <= 0.88)).toBe(true);
    expect(layoutGraph(analysis.graph)).toEqual(laid); // deterministic
  });
});

describe('taste narrative', () => {
  it('reads as plain sentences grounded in the numbers', () => {
    const { ready, sections } = describeTaste(analyzeTaste(history(), { now: NOW }));
    expect(ready).toBe(true);
    const text = sections.map(section => section.sentences.join(' ')).join('\n');
    expect(text).toContain('You mostly come here for Zenless Zone Zero');
    expect(text).toContain('Wise (Zenless Zone Zero)');
    expect(text).toMatch(/you engage with 100% of g7jay's posts/);
    expect(text).toContain('You reliably pass on');
    expect(text).toMatch(/New this week: [^.]*New Show/);
    expect(text).toContain("You've saved 1 post. The feed treats that as a stronger signal than a like.");
    expect(text).not.toMatch(/undefined|NaN|null/);
  });
  it('waits for enough data before telling a story', () => {
    const { ready, sections } = describeTaste(analyzeTaste([view(post(), 5000, NOW)], { now: NOW }));
    expect(ready).toBe(false);
    expect(sections[0].sentences[0]).toContain('1 post');
  });
  it('formats names and lists naturally', () => {
    expect(tagLabel({ tag: 'wise_(zenless_zone_zero)', category: 'character' })).toBe('Wise (Zenless Zone Zero)');
    expect(tagLabel({ tag: 'g7jay', category: 'artist' })).toBe('g7jay');
    expect(joinList(['a', 'b', 'c'])).toBe('a, b and c');
  });
});
