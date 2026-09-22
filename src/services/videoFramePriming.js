/*
 * BooruRamen - A personalized booru browser
 * Copyright (C) 2025 SoupDevs
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

/**
 * videoFramePriming.js
 *
 * Getting a clip's first frame decoded before the post carrying it reaches the
 * viewport.
 *
 * `preload` is a hint, and engines are free to ignore a change to it made after
 * the element was created. Phones do exactly that: the clip is never fetched,
 * so a post scrolling into view has no frame to show and arrives as a black
 * box until playback starts. A desktop connection hides this (the fetch
 * finishes within the scroll anyway), which is why it reads as a mobile-only
 * bug.
 *
 * Calling load() starts the fetch explicitly, whether or not the hint was
 * honoured, so the first frame is there as a stand-in before it is needed.
 */

/** Posts ahead of the watched one that should already have a decoded frame. */
export const VIDEO_FRAME_RUNWAY_AHEAD = 2;
/** Posts behind it that keep one, so a flick back is not black either. */
export const VIDEO_FRAME_RUNWAY_BEHIND = 1;

/**
 * Start loading a clip so its first frame can be drawn as a stand-in.
 * Returns true when a fetch was kicked off.
 *
 * Skips elements that already have a frame (readyState >= HAVE_CURRENT_DATA)
 * and ones already fetching. Never call it for the post being watched:
 * load() would restart that playback.
 */
export function primeVideoFrame(video) {
  if (!video || video._framePrimePending) return false;
  if (video.readyState >= 2) return false;
  if (video.networkState === 2 /* NETWORK_LOADING */) return false;

  video.preload = 'auto';
  video._framePrimePending = true;
  const release = () => { video._framePrimePending = false; };
  video.addEventListener('loadeddata', release, { once: true });
  video.addEventListener('error', release, { once: true });
  try {
    video.load();
  } catch (e) {
    video._framePrimePending = false;
    return false;
  }
  return true;
}

/**
 * Prime every clip within the runway around `currentIndex`.
 *
 * @param {Array} posts          posts in view order
 * @param {number} currentIndex  index of the post being watched
 * @param {Function} videoFor    (post, index) => HTMLVideoElement | null
 * @param {Function} [isPlaying] (post, index) => true for the playing post
 * @returns {number} how many fetches were started
 */
export function primeNeighbouringFrames(posts, currentIndex, videoFor, isPlaying) {
  if (!Array.isArray(posts) || currentIndex < 0) return 0;
  let started = 0;
  const from = Math.max(0, currentIndex - VIDEO_FRAME_RUNWAY_BEHIND);
  const to = Math.min(posts.length - 1, currentIndex + VIDEO_FRAME_RUNWAY_AHEAD);
  for (let index = from; index <= to; index++) {
    if (index === currentIndex) continue;
    const post = posts[index];
    if (!post) continue;
    if (isPlaying && isPlaying(post, index)) continue;
    const video = videoFor(post, index);
    if (video && primeVideoFrame(video)) started++;
  }
  return started;
}

/**
 * Draw what a video is showing into a stand-in canvas.
 *
 * `loadeddata` only means the data arrived - drawing then can capture an
 * all-black picture, which is the very artefact the stand-in exists to hide.
 * Prefer drawOnPresentedFrame(): this is the primitive it and the playback
 * handlers share.
 *
 * @returns {boolean} true when the canvas was drawn into
 */
export function captureStandInFrame(video, canvas) {
  if (!video || !canvas || !video.videoWidth) return false;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  try {
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return true;
  } catch (e) {
    // Exotic sources can refuse the draw; callers keep their other layer up.
    return false;
  }
}

/**
 * Draw the first frame now, and refine it if a presented frame is reported.
 *
 * For a stand-in that is the only layer on screen (the feed's canvas): the
 * element it stands in for is `opacity-0` until playback, and the compositor
 * does not present frames for an invisible element - so waiting for one leaves
 * the post showing nothing at all. Paint the decoded frame straight away
 * instead, and replace it when an actually-presented frame comes along.
 */
export function drawFirstFrameNow(video, canvas, onDrawn) {
  const drawn = captureStandInFrame(video, canvas);
  if (drawn && onDrawn) onDrawn();
  if (video && typeof video.requestVideoFrameCallback === 'function' && !video._standInCapture) {
    video._standInCapture = video.requestVideoFrameCallback(() => {
      video._standInCapture = null;
      const refined = captureStandInFrame(video, canvas);
      if (refined && onDrawn) onDrawn();
    });
  }
  return drawn;
}

/**
 * Draw the first frame a video has actually presented.
 *
 * Waits for the compositor to hand the element a frame where the engine can
 * report that (requestVideoFrameCallback); otherwise draws straight away.
 */
export function drawOnPresentedFrame(video, canvas, onDrawn) {
  const draw = () => {
    if (captureStandInFrame(video, canvas) && onDrawn) onDrawn();
  };
  if (video && typeof video.requestVideoFrameCallback === 'function') {
    if (!video._standInCapture) {
      video._standInCapture = video.requestVideoFrameCallback(() => {
        video._standInCapture = null;
        draw();
      });
    }
    return;
  }
  draw();
}
