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

// Two taps count as a double tap when they land close together in both time
// and space. Anything looser starts eating taps meant for the media itself
// (pausing a clip, giving up on a slow post).
const DOUBLE_TAP_WINDOW_MS = 300;
const DOUBLE_TAP_SLOP_PX = 48;

/**
 * Double-tap-to-like for full-screen post media.
 *
 * The detector rides on click rather than pointerdown: a drag or a scroll
 * never produces a click, so a tap that turns into a swipe can't be mistaken
 * for a double tap. On a video the two clicks of a double tap each hit the
 * element's own handler, toggling playback off and straight back on, so the
 * clip ends up exactly as it was and the gesture only has to ask for the like.
 *
 * Hosts must:
 *   - call onMediaTap(post, event) from a click handler covering the media,
 *   - listen for 'post-like-request' and apply the like,
 *   - render mediaBurst(post) as the burst overlay (PostActionBurst).
 */
export const postGestureMixin = {
  computed: {
    ...mapState(useSettingsStore, ['doubleTapToLike']),
    ...mapState(useEffectsStore, ['bursts'])
  },
  methods: {
    /** Burst queued for this post, or null when there is nothing to play. */
    mediaBurst(post) {
      return this.bursts[postKey(post)] || null;
    },

    onMediaTap(post, event) {
      if (!this.doubleTapToLike || !post || !event) {
        this._lastMediaTap = null;
        return;
      }

      const key = postKey(post);
      const now = Date.now();
      const previous = this._lastMediaTap;

      if (
        previous &&
        previous.key === key &&
        now - previous.time <= DOUBLE_TAP_WINDOW_MS &&
        Math.abs(event.clientX - previous.x) <= DOUBLE_TAP_SLOP_PX &&
        Math.abs(event.clientY - previous.y) <= DOUBLE_TAP_SLOP_PX
      ) {
        this._lastMediaTap = null;
        this.$emit('post-like-request', post);
        return;
      }

      this._lastMediaTap = { key, time: now, x: event.clientX, y: event.clientY };
    }
  }
};