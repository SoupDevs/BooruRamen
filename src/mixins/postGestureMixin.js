/*
 * BooruRamen - A personalized booru browser
 * Copyright (C) 2025 SoupDevs
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { mapState } from 'pinia';
import { useSettingsStore } from '../stores/settings';
import { useEffectsStore } from '../stores/effects';
import { postKey } from '../services/postKey';

// A single tap waits this long before acting, giving a second tap the chance
// to turn it into a double tap (like/unlike instead of pause/play). Anything
// looser starts eating taps meant for the media itself (pausing a clip,
// giving up on a slow post).
const SINGLE_TAP_DELAY_MS = 200;
const DOUBLE_TAP_SLOP_PX = 48;

// Swipe / hold gestures (swipe right to favorite, swipe left to dislike,
// hold to seek). Each gesture has its own settings switch; there is no
// master mode gating them.
const SWIPE_MIN_PX = 64;      // horizontal travel before a drag counts as a swipe
const AXIS_SLOP_PX = 12;      // movement that picks the gesture axis / kills the hold
const HOLD_MS = 1000;         // press duration before hold-to-seek arms
const TAP_SUPPRESS_MS = 500;  // window where a gesture swallows its trailing click

/**
 * Post gestures: double-tap-to-like plus swipe/hold gestures (swipe right to
 * favorite, swipe left to dislike, hold a video for a second to scrub).
 *
 * Tap handling rides on click (a drag or a scroll never produces one). A
 * single tap is held back for SINGLE_TAP_DELAY_MS before it is acted on: if
 * a second tap lands inside that window the pair is a double tap
 * (like/unlike) and the pending action is dropped; otherwise the single tap
 * calls onMediaSingleTap (video: toggle playback) or onMediaImageTap
 * (stills: hosts may reveal chrome).
 *
 * The swipe/hold detectors ride on pointer events on the media row:
 *   - vertical movement is a scroll and cancels everything,
 *   - horizontal movement arms a swipe (and cancels the pending hold),
 *   - a still 1s press on a video arms hold-to-seek, which pauses the clip
 *     and scrubs it with the finger until release.
 * Either gesture swallows the click that follows it, so a swipe never lands
 * as a tap and a scrub never toggles playback on release.
 *
 * Swipe/hold detectors run whenever their own switch is on (double-tap is
 * governed by its switch alone, as before); there is no master mode.
 *
 * Hosts must:
 *   - call onMediaTap(post, event) from a click handler covering the media,
 *   - implement onMediaSingleTap(event) to toggle playback and
 *     onMediaImageTap(event) for stills (both default to no-ops),
 *   - forward onMediaPointerDown/Move/Up/Cancel from pointer handlers on the
 *     same element,
 *   - listen for 'post-like-request', 'post-favorite-request',
 *     'post-dislike-request' and 'seek-gesture',
 *   - render mediaBurst(post) as the burst overlay (PostActionBurst).
 */
export const postGestureMixin = {
  computed: {
    ...mapState(useSettingsStore, [
      'doubleTapToLike',
      'swipeRightToFavorite',
      'swipeLeftToDislike',
      'holdToSeek',
    ]),
    ...mapState(useEffectsStore, ['bursts'])
  },
  methods: {
    /** Burst queued for this post, or null when there is nothing to play. */
    mediaBurst(post) {
      return this.bursts[postKey(post)] || null;
    },

    onMediaTap(post, event) {
      if (!post || !event) return;
      if (this.isTapSuppressed()) {
        // A swipe or a seek just ran on this pointer sequence.
        this._clearSingleTap();
        this._lastMediaTap = null;
        return;
      }

      const key = postKey(post);
      const now = Date.now();
      const previous = this._lastMediaTap;

      // Second tap while the first one is still pending (same post, same
      // spot): cancel the pending pause/play and treat the pair as a double
      // tap — like/unlike.
      const isDoubleTap =
        this.doubleTapToLike &&
        this._singleTapTimer !== null &&
        this._singleTapTimer !== undefined &&
        previous &&
        previous.key === key &&
        now - previous.time <= SINGLE_TAP_DELAY_MS + 50 &&
        Math.abs(event.clientX - previous.x) <= DOUBLE_TAP_SLOP_PX &&
        Math.abs(event.clientY - previous.y) <= DOUBLE_TAP_SLOP_PX;

      if (isDoubleTap) {
        this._clearSingleTap();
        this._lastMediaTap = null;
        this.$emit('post-like-request', post);
        return;
      }

      this._lastMediaTap = { key, time: now, x: event.clientX, y: event.clientY };

      // The same deferral serves both kinds of media: on a video the single
      // tap toggles playback, on a still image the host may reveal chrome —
      // and either way a second tap inside the window wins as a like.
      const runSingleTap = () => {
        if (this.isTapSuppressed()) return;
        if (this._tapTargetsVideo(event)) {
          this.onMediaSingleTap(event);
        } else {
          this.onMediaImageTap(event);
        }
      };

      // Double-tap switched off: nothing to disambiguate, act now.
      if (!this.doubleTapToLike) {
        runSingleTap();
        return;
      }

      this._clearSingleTap();
      this._singleTapTimer = setTimeout(runSingleTap, SINGLE_TAP_DELAY_MS);
    },

    /**
     * Deferred single tap landed on a video. A no-op here; hosts override it
     * to toggle playback (they own the media element).
     */
    onMediaSingleTap() {},

    /**
     * Deferred single tap landed on a still image. A no-op here; hosts
     * override it (focus mode uses it to reveal the chrome).
     */
    onMediaImageTap() {},

    /** True when the tap landed on (or inside) a video element. */
    _tapTargetsVideo(event) {
      const target = event.target;
      return !!target && (target.tagName === 'VIDEO'
        || (typeof target.closest === 'function' && !!target.closest('video')));
    },

    _clearSingleTap() {
      if (this._singleTapTimer !== null && this._singleTapTimer !== undefined) {
        clearTimeout(this._singleTapTimer);
        this._singleTapTimer = null;
      }
    },

    // --- swipe / hold gestures ---------------------------------------------

    onMediaPointerDown(post, event) {
      if (!post) return;
      // No gesture armed: leave the pointer alone so scrolling stays native.
      if (!this.swipeRightToFavorite && !this.swipeLeftToDislike && !this.holdToSeek) return;
      if (event.button !== undefined && event.button !== 0) return;

      // Deliberately NO setPointerCapture here: capturing on every press
      // retargets the trailing click to the row instead of the <video>
      // underneath, which kills tap-to-pause. Capture happens only once a
      // gesture commits (axis locks to a swipe, or hold-to-seek starts) —
      // a plain tap never captures, so its click lands where it should.
      this._gesture = {
        post,
        pointerId: event.pointerId,
        el: event.currentTarget,
        captured: false,
        x0: event.clientX,
        y0: event.clientY,
        x: event.clientX,
        y: event.clientY,
        axis: null,
        seeking: false,
        video: null,
        wasPlaying: false,
        startTime: 0,
        width: 1,
        holdTimer: setTimeout(() => this._startHoldSeek(), HOLD_MS),
      };
    },

    /** Keep the move/up stream coming once a gesture is committed. */
    _captureGesturePointer() {
      const g = this._gesture;
      if (!g || g.captured) return;
      const el = g.el;
      if (el && g.pointerId !== undefined && typeof el.setPointerCapture === 'function') {
        try {
          el.setPointerCapture(g.pointerId);
          g.captured = true;
        } catch (e) {
          // Capture is a nicety; gestures still work without it.
        }
      }
    },

    onMediaPointerMove(event) {
      const g = this._gesture;
      if (!g) return;
      g.x = event.clientX;
      g.y = event.clientY;

      const dx = g.x - g.x0;
      const dy = g.y - g.y0;

      if (g.seeking) {
        this._updateHoldSeek(dx);
        return;
      }

      if (g.axis === null && (Math.abs(dx) > AXIS_SLOP_PX || Math.abs(dy) > AXIS_SLOP_PX)) {
        g.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      }

      if (g.axis === 'y') {
        // A scroll: nothing to gesture, drop the hold timer too.
        this._cancelGesture(g);
      } else if (g.axis === 'x') {
        // A swipe in progress can no longer become a hold.
        clearTimeout(g.holdTimer);
        g.holdTimer = null;
        // Committed to horizontal: now it is safe to capture the pointer.
        this._captureGesturePointer();
      }
    },

    onMediaPointerUp() {
      const g = this._gesture;
      if (!g) return;
      this._gesture = null;
      if (g.holdTimer) clearTimeout(g.holdTimer);

      if (g.seeking) {
        this._endHoldSeek(g);
        return;
      }
      if (g.axis !== 'x') return;

      const dx = g.x - g.x0;
      if (Math.abs(dx) < SWIPE_MIN_PX) return;

      this._suppressTaps();
      if (dx > 0) {
        if (this.swipeRightToFavorite) this.$emit('post-favorite-request', g.post);
      } else if (this.swipeLeftToDislike) {
        this.$emit('post-dislike-request', g.post);
      }
    },

    onMediaPointerCancel() {
      const g = this._gesture;
      if (!g) return;
      this._gesture = null;
      if (g.holdTimer) clearTimeout(g.holdTimer);
      if (g.seeking) this._endHoldSeek(g);
    },

    _cancelGesture(g) {
      if (g.holdTimer) clearTimeout(g.holdTimer);
      g.holdTimer = null;
      this._gesture = null;
    },

    /** A still 1s press on a playing/buffered clip: pause and start scrubbing. */
    _startHoldSeek() {
      const g = this._gesture;
      if (!g || g.seeking || !this.holdToSeek) return;

      const video = this._gestureVideo(g.post);
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;

      // Committed to holding: capture so the scrub survives the finger
      // leaving the row.
      this._captureGesturePointer();

      g.seeking = true;
      g.video = video;
      g.startTime = video.currentTime;
      g.wasPlaying = !video.paused && !video.ended;
      g.width = video.getBoundingClientRect().width || window.innerWidth || 1;

      video.pause();
      this.$emit('seek-gesture', { active: true, video });
    },

    /** Dragging right moves forward, dragging left moves back. */
    _updateHoldSeek(dx) {
      const g = this._gesture;
      if (!g || !g.seeking || !g.video) return;
      const duration = g.video.duration;
      if (!duration) return;
      const target = g.startTime + (dx / g.width) * duration;
      g.video.currentTime = Math.max(0, Math.min(duration, target));
    },

    _endHoldSeek(g) {
      this.$emit('seek-gesture', { active: false, video: g.video });
      // Swallow the click this press would otherwise produce.
      this._suppressTaps();
      if (g.wasPlaying && g.video) {
        const playResult = g.video.play();
        if (playResult && typeof playResult.catch === 'function') playResult.catch(() => {});
      }
    },

    _gestureVideo(post) {
      // FeedView keeps live <video> elements keyed by post; the viewer does
      // not, so hold-to-seek is a feed gesture only.
      if (!post || !this.videoElements) return null;
      return this.videoElements[postKey(post)] || null;
    },

    _suppressTaps() {
      this._suppressMediaTapUntil = Date.now() + TAP_SUPPRESS_MS;
    },

    /** True while the click produced by swipe/seek must be ignored. */
    isTapSuppressed() {
      return !!this._suppressMediaTapUntil && Date.now() < this._suppressMediaTapUntil;
    },
  },

  beforeUnmount() {
    // A pending single tap must not fire into an unmounted view.
    this._clearSingleTap();
  },
};
