/**
 * WatchTimer.js
 * Measures how long the user actually engaged with the current post.
 *
 * Wall-clock time between post changes overstates interest: a phone left on
 * the table, a backgrounded app or an unattended still image would all read
 * as the strongest possible "watched it" signal. Time only counts while the
 * app is visible and focused, and while the user is either active or a
 * video is playing (watching a clip is passive, staring at an image is not).
 */

// An image with no input for this long is no longer being looked at.
export const IDLE_MS = 20 * 1000;
// Faster than this the post only passed through the viewport mid-fling.
export const MIN_IMPRESSION_MS = 300;

export class WatchTimer {
  constructor(clock = Date.now) {
    this.clock = clock;
    this.hidden = false;
    this.playing = false;
    this.reset();
  }

  reset() {
    this.active = false;
    this.elapsed = 0;
    this.segmentStart = null;
    this.lastActivity = null;
    this.context = null;
  }

  // Count time since the last settle under the state that held during it.
  settle() {
    const now = this.clock();
    if (this.active && !this.hidden && this.segmentStart !== null) {
      const end = this.playing ? now : Math.min(now, this.lastActivity + IDLE_MS);
      if (end > this.segmentStart) this.elapsed += end - this.segmentStart;
    }
    this.segmentStart = now;
    return now;
  }

  start(context = null) {
    this.reset();
    const now = this.clock();
    this.active = true;
    this.context = context;
    this.segmentStart = now;
    this.lastActivity = now;
    // A new post starts paused until its video reports playback.
    this.playing = false;
  }

  activity() {
    if (!this.active) return;
    this.lastActivity = this.settle();
  }

  setPlaying(playing) {
    if (this.playing === !!playing) return;
    this.settle();
    this.playing = !!playing;
    // Pausing counts as interaction: the idle window starts from here.
    if (this.active) this.lastActivity = this.clock();
  }

  setHidden(hidden) {
    if (this.hidden === !!hidden) return;
    this.settle();
    this.hidden = !!hidden;
    // Returning to the app is itself activity.
    if (!this.hidden && this.active) this.lastActivity = this.clock();
  }

  /** Ends the measurement. Returns { ms, context } or null if not running. */
  stop() {
    if (!this.active) return null;
    this.settle();
    const result = { ms: Math.round(this.elapsed), context: this.context };
    this.reset();
    return result;
  }
}
