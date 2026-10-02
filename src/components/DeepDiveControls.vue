<template>
  <section v-if="post || state.active" class="mb-4">
    <div class="flex items-center justify-between gap-2 text-sm">
      <div class="flex items-center gap-2">
        <span class="font-medium">Deep Dive</span>
        <span v-if="state.active" class="text-xs text-pink-300" role="status">Active</span>
      </div>
      <div class="flex items-center gap-2">
        <button v-if="post && (!state.active || state.anchorKey !== postKey(post))" :disabled="state.busy" class="rounded-md border border-pink-600 bg-pink-600 hover:bg-pink-700 text-white px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400 disabled:opacity-50" :aria-label="state.active ? 'Deep Dive from this post' : 'Start Deep Dive'" @click="start">
          {{ state.busy ? 'Starting…' : state.active ? 'Dive here' : 'Start' }}
        </button>
        <button v-if="state.active" :disabled="state.busy" class="rounded-md border border-pink-600 bg-pink-600 hover:bg-pink-700 text-white px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400 disabled:opacity-50" aria-label="End Deep Dive" @click="recommendations.setDeepDive(null)">End</button>
      </div>
    </div>
    <p v-if="state.error" class="mt-2 text-xs text-red-300" role="alert">{{ state.error }}</p>
  </section>
</template>
<script setup>
/* global defineProps, defineEmits */
import { useRouter } from 'vue-router';
import recommendations, { deepDiveState as state } from '../services/RecommendationSystem.js';
import { postKey } from '../services/postKey.js';
const props = defineProps({ post: { type: Object, default: null } });
const emit = defineEmits(['started']);
const router = useRouter();
async function start() {
  if (!await recommendations.setDeepDive(props.post)) return;
  if (router.currentRoute.value.name !== 'Home') await router.push({ name: 'Home' });
  emit('started');
}
</script>
