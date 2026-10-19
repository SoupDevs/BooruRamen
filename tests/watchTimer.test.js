import { describe, it, expect } from 'vitest';
import { WatchTimer, IDLE_MS } from '../src/services/WatchTimer.js';

describe('watch timer', () => {
  it('counts an attended image fully', () => {
    let now = 0;
    const timer = new WatchTimer(() => now);
    timer.start({ deepDive: true });
    now = 5000;
    expect(timer.stop()).toEqual({ ms: 5000, context: { deepDive: true } });
  });
  it('stops counting an image left without input', () => {
    let now = 0;
    const timer = new WatchTimer(() => now);
    timer.start();
    now = 10 * 60 * 1000;
    expect(timer.stop().ms).toBe(IDLE_MS);
  });
  it('extends the idle window on activity', () => {
    let now = 0;
    const timer = new WatchTimer(() => now);
    timer.start();
    now = IDLE_MS - 1000; timer.activity();
    now = 10 * 60 * 1000;
    expect(timer.stop().ms).toBe(2 * IDLE_MS - 1000);
  });
  it('counts a playing video without input', () => {
    let now = 0;
    const timer = new WatchTimer(() => now);
    timer.start(); timer.setPlaying(true);
    now = 90 * 1000;
    expect(timer.stop().ms).toBe(90 * 1000);
  });
  it('excludes time while the app is hidden, even with a video playing', () => {
    let now = 0;
    const timer = new WatchTimer(() => now);
    timer.start(); timer.setPlaying(true);
    now = 3000; timer.setHidden(true);
    now = 60 * 60 * 1000; timer.setHidden(false);
    now += 2000;
    expect(timer.stop().ms).toBe(5000);
  });
  it('treats a paused video like an image', () => {
    let now = 0;
    const timer = new WatchTimer(() => now);
    timer.start(); timer.setPlaying(true);
    now = 4000; timer.setPlaying(false);
    now = 10 * 60 * 1000;
    expect(timer.stop().ms).toBe(4000 + IDLE_MS);
  });
  it('starts each post paused and returns null once stopped', () => {
    let now = 0;
    const timer = new WatchTimer(() => now);
    timer.start(); timer.setPlaying(true);
    timer.start();
    now = 10 * 60 * 1000;
    expect(timer.stop().ms).toBe(IDLE_MS);
    expect(timer.stop()).toBeNull();
  });
});
