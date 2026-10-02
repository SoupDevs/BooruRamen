import { describe, it, expect } from 'vitest';
import { SessionInterest, MAX_SESSION_WEIGHT, SESSION_IDLE_MS, SESSION_HALF_LIFE_MS, interactionSignal } from '../src/services/SessionInterest.js';

const post = (id, tag, extra = {}) => ({ id, source: 'source', tag_string: tag, file_ext: 'jpg', ...extra });

describe('session interests', () => {
  it('adapts rankings immediately without replacing a strong profile preference', () => {
    const session = new SessionInterest();
    expect(session.blend(0.6, post(0, 'landscape'))).toBe(0.6);
    for (let id = 1; id < 15; id++) session.record(post(id, 'landscape'), 'like', 1);
    expect(session.blend(0.5, post(20, 'landscape'))).toBeGreaterThan(session.blend(0.5, post(21, 'portrait')));
    expect(session.weight).toBeLessThanOrEqual(MAX_SESSION_WEIGHT);
    expect(session.blend(0.9, post(20, 'portrait'))).toBeGreaterThan(session.blend(0.1, post(21, 'landscape')));
  });
  it('fades, expires after inactivity, and does not reconstruct a session from history', () => {
    let now = 0;
    const session = new SessionInterest(() => now);
    session.record(post(1, 'landscape'), 'like', 1);
    const weight = session.weight;
    now += SESSION_HALF_LIFE_MS;
    expect(session.weight).toBeLessThan(weight);
    now = SESSION_IDLE_MS;
    expect(session.weight).toBe(0);
    expect(session.affinities()).toEqual({});
    expect(new SessionInterest().weight).toBe(0);
  });
  it('caps durable topic evidence within a session but allows growth across sessions', () => {
    const session = new SessionInterest();
    let total = 0;
    for (let id = 0; id < 500; id++) total += session.record(post(id, 'landscape'), 'favorite', 1) * 2;
    expect(total).toBeLessThanOrEqual(2.000001);
    expect(total).toBeGreaterThan(1);
    session.reset();
    expect(session.record(post(501, 'landscape'), 'favorite', 1)).toBe(0.35);
  });
  it('ignores repeated posts, undo events and avoided tags; handles negative feedback', () => {
    const session = new SessionInterest();
    const target = post(1, 'landscape solo');
    session.record(target, 'dislike', 1, ['solo']);
    const before = session.weight;
    expect(session.record(target, 'dislike', 1)).toBe(0);
    expect(session.record(target, 'like', 0)).toBe(0);
    expect(session.weight).toBeCloseTo(before, 4);
    expect(session.affinities().solo).toBeUndefined();
    expect(session.score(target)).toBeLessThan(session.score(post(2, 'portrait')));
    expect(interactionSignal('timeSpent', 3600000)).toBe(1);
  });
  it('uses visual composition when tags alone cannot distinguish posts', () => {
    const session = new SessionInterest();
    const bright = { composition: new Array(32).fill(1) };
    const dark = { composition: new Array(32).fill(0) };
    session.record(post(1, 'landscape', { imageAnalysis: bright }), 'favorite', 1);
    expect(session.score(post(2, 'landscape', { imageAnalysis: bright })))
      .toBeGreaterThan(session.score(post(3, 'landscape', { imageAnalysis: dark })));
  });
});
