<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <!-- Wrapper mirrors the feed's media box (relative, h-full, flex-centered)
       so the absolutely positioned upgrade stages always land exactly on top
       of the in-flow image, whichever ancestor flex alignment is in effect. -->
  <div class="relative h-full max-w-full flex items-center justify-center">
    <!-- In-flow stage defines layout as soon as the smallest available image
         lands: the low-res preview normally, the full image when no preview
         exists (or the preview 404s). h-full forces it to scale to the feed's
         fit-box (max-* alone never upscales a small thumbnail), so the tiny
         preview and the multi-MB original share one pixel-identical box and
         every stage renders aligned. Keeps the caller's sizing classes. -->
    <BooruImage
      :src="inFlowStage.src"
      :alt="alt"
      :class="{ 'h-full': true }"
      v-bind="$attrs"
      @load="onInFlowLoad"
      @error="onInFlowError"
    />
    <!-- Upgrade stages stack on top of each other in order, each fading in
         when it finishes: preview -> sample (~850px) -> original. Booru resizes
         preserve aspect ratio, so every stage renders pixel-aligned over the
         previous one. A stage that fails is dropped and the one below stays. -->
    <BooruImage
      v-if="sampleStage"
      :src="sampleStage.src"
      alt=""
      class="absolute inset-0 w-full h-full object-contain pointer-events-none transition-opacity duration-200"
      :class="{ 'opacity-0': !sampleLoaded || fullLoaded }"
      @load="sampleLoaded = true"
      @error="sampleErrored = true"
    />
    <BooruImage
      v-if="fullStage"
      :src="fullStage.src"
      alt=""
      class="absolute inset-0 w-full h-full object-contain pointer-events-none transition-opacity duration-200"
      :class="{ 'opacity-0': !fullLoaded }"
      @load="fullLoaded = true"
      @error="onFullOverlayError"
    />
  </div>
</template>

<script>
import BooruImage from './BooruImage.vue';

export default {
  name: 'ProgressiveImage',
  components: {
    BooruImage,
  },
  inheritAttrs: false,
  emits: ['load', 'error'],
  props: {
    src: {
      type: String,
      default: '',
    },
    // Small thumbnail (~150-180px) shown immediately.
    previewSrc: {
      type: String,
      default: '',
    },
    // Medium sample (~850px) shown while the original downloads.
    sampleSrc: {
      type: String,
      default: '',
    },
    alt: {
      type: String,
      default: '',
    },
  },
  data() {
    return {
      previewErrored: false,
      sampleErrored: false,
      fullErrored: false,
      sampleLoaded: false,
      fullLoaded: false,
    };
  },
  computed: {
    inFlowStage() {
      if (this.previewSrc && !this.previewErrored) {
        return { kind: 'preview', src: this.previewSrc };
      }
      return { kind: 'full', src: this.src };
    },
    previewInFlow() {
      return this.inFlowStage.kind === 'preview';
    },
    sampleStage() {
      const sample = this.sampleSrc || '';
      if (!sample || this.sampleErrored) return null;
      if (sample === this.inFlowStage.src) return null;
      // Sample identical to the original adds nothing — the full overlay
      // (or the in-flow image) already covers it.
      if (sample === this.src) return null;
      return { src: sample };
    },
    fullStage() {
      const full = this.src || '';
      // Only an overlay when the full image is not already the in-flow element.
      if (!this.previewInFlow || !full || full === this.inFlowStage.src) return null;
      if (this.fullErrored) return null;
      return { src: full };
    },
  },
  methods: {
    onInFlowLoad(event) {
      // The in-flow element *is* the full image (no preview, or a preview
      // identical to src for tiny posts): layout is final, nothing to fade.
      if (this.inFlowStage.src === this.src) {
        this.fullLoaded = true;
        this.$emit('load', event);
      }
    },
    onInFlowError(event) {
      if (this.inFlowStage.kind === 'preview') {
        // Drop the preview; the full image (already downloading as an
        // overlay) takes over in-flow and lands from cache. Only escalate
        // if the full image already failed too.
        this.previewErrored = true;
        if (this.fullErrored) this.$emit('error', event);
        return;
      }
      this.$emit('error', event);
    },
    onFullOverlayError() {
      // Keep the preview on screen — a blurry image beats a blank frame —
      // but let the caller log it.
      this.fullErrored = true;
      this.$emit('error');
    },
  },
};
</script>
