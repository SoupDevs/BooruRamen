<template>
  <img
    v-bind="$attrs"
    :src="resolvedSrc"
    @load="$emit('load', $event)"
    @error="onError"
  >
</template>

<script>
import {
  getDisplayableMediaUrl,
  releaseDisplayableMediaUrl,
} from '../services/mediaUrl.js';
import { probeMediaBlock } from '../services/httpClient.js';

export default {
  name: 'BooruImage',
  inheritAttrs: false,
  emits: ['load', 'error'],
  props: {
    src: {
      type: String,
      default: '',
    },
  },
  data() {
    return {
      resolvedSrc: '',
      resolveGeneration: 0,
      disposed: false,
    };
  },
  watch: {
    src: {
      immediate: true,
      handler() {
        this.resolveSrc();
      },
    },
  },
  beforeUnmount() {
    this.disposed = true;
    this.resolveGeneration++;
    releaseDisplayableMediaUrl(this.resolvedSrc);
  },
  methods: {
    onError(event) {
      probeMediaBlock(this.resolvedSrc);
      this.$emit('error', event);
    },
    async resolveSrc() {
      const requestedSrc = this.src;
      const generation = ++this.resolveGeneration;
      releaseDisplayableMediaUrl(this.resolvedSrc);
      this.resolvedSrc = '';

      if (!requestedSrc) return;

      try {
        const resolvedSrc = await getDisplayableMediaUrl(requestedSrc);
        if (this.disposed || generation !== this.resolveGeneration) {
          releaseDisplayableMediaUrl(resolvedSrc);
          return;
        }
        this.resolvedSrc = resolvedSrc;
      } catch (error) {
        if (this.disposed || generation !== this.resolveGeneration) return;
        console.error('[BooruImage] Failed to load media:', requestedSrc, error);
        this.$emit('error', error);
      }
    },
  },
};
</script>
