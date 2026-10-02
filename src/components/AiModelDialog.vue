<template>
  <Teleport to="body">
    <Transition name="ai-model-backdrop" appear>
      <div v-if="state.dialog" class="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm" aria-hidden="true"></div>
    </Transition>
    <Transition name="ai-model-popup" mode="out-in" appear>
    <div v-if="state.dialog" :key="dialogStep" class="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <section class="ai-model-panel w-full max-w-md bg-gray-900 text-white border border-gray-700 rounded-xl p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="ai-model-title">
        <h2 id="ai-model-title" class="text-xl font-bold mb-3">{{ title }}</h2>
        <template v-if="state.phase === 'prompt'">
          <p class="text-gray-300">Download a local AI model to add missing image tags and help personalize your feed?</p>
          <p class="text-sm text-gray-400 mt-3">Download: 468 MB (446 MiB). Allow at least 500 MB of storage and 1 GB of available memory while it runs. Images are analyzed on your device in the background.</p>
          <div class="flex justify-end gap-3 mt-5">
            <button class="px-4 py-2 rounded bg-gray-700" @click="tagger.decline(settings)">Decline</button>
            <button class="px-4 py-2 rounded bg-pink-600" @click="tagger.prepare(settings)">Accept &amp; download</button>
          </div>
        </template>
        <template v-else-if="state.phase === 'declined'">
          <p class="text-gray-300">You can enable AI tagging in Profile Settings → Content at any time.</p>
          <button class="mt-5 px-4 py-2 rounded bg-pink-600" @click="state.dialog = false">Got it</button>
        </template>
        <template v-else-if="state.phase === 'downloading' || state.phase === 'initializing'">
          <p class="text-gray-300">{{ state.phase === 'initializing' ? 'Checking and preparing the model…' : 'Downloading the image tag model…' }}</p>
          <progress class="w-full mt-4 accent-pink-600" :value="state.progress" max="1" aria-label="Model download progress"></progress>
          <p class="text-sm text-gray-400 mt-2" aria-live="polite">{{ Math.round(state.progress * 100) }}% · {{ Math.round(state.loaded / 1000000) }} / 468 MB</p>
          <p class="text-sm text-gray-400 mt-2">You can keep browsing while this finishes.</p>
          <div class="flex gap-3 mt-5">
            <button class="px-4 py-2 rounded bg-gray-700" @click="tagger.cancel()">Cancel</button>
            <button class="px-4 py-2 rounded bg-pink-600" @click="state.dialog = false">Continue browsing</button>
          </div>
        </template>
        <template v-else-if="state.phase === 'failed'">
          <p class="text-gray-300" role="alert">{{ state.error }}</p>
          <div class="flex gap-3 mt-5">
            <button class="px-4 py-2 rounded bg-gray-700" @click="state.dialog = false">Close</button>
            <button class="px-4 py-2 rounded bg-pink-600" @click="tagger.prepare(settings)">Retry download</button>
          </div>
        </template>
        <template v-else>
          <p class="text-gray-300">AI tagging is ready. It will enrich images in the background as you browse.</p>
          <button class="mt-5 px-4 py-2 rounded bg-pink-600" @click="state.dialog = false">Done</button>
        </template>
      </section>
    </div>
    </Transition>
  </Teleport>
</template>
<script setup>
import { computed } from 'vue';
import tagger, { aiTaggerState as state } from '../services/AiTaggerService.js';
import { useSettingsStore } from '../stores/settings.js';
const settings = useSettingsStore();
const dialogStep = computed(() => ['downloading', 'initializing'].includes(state.phase) ? 'setup' : state.phase);
const title = computed(() => state.phase === 'downloading' || state.phase === 'initializing' ? 'Setting up AI tagging' : 'AI image tagging');
</script>
<style scoped>
.ai-model-popup-enter-active,
.ai-model-popup-leave-active,
.ai-model-backdrop-enter-active,
.ai-model-backdrop-leave-active {
  transition: opacity 0.28s ease;
}
.ai-model-popup-enter-active .ai-model-panel,
.ai-model-popup-leave-active .ai-model-panel {
  transition: transform 0.28s ease;
}
.ai-model-popup-enter-from,
.ai-model-popup-leave-to,
.ai-model-backdrop-enter-from,
.ai-model-backdrop-leave-to {
  opacity: 0;
}
.ai-model-popup-enter-from .ai-model-panel,
.ai-model-popup-leave-to .ai-model-panel {
  transform: translateY(calc(-50vh - 100%));
}
@media (prefers-reduced-motion: reduce) {
  .ai-model-popup-enter-active,
  .ai-model-popup-leave-active,
  .ai-model-backdrop-enter-active,
  .ai-model-backdrop-leave-active,
  .ai-model-popup-enter-active .ai-model-panel,
  .ai-model-popup-leave-active .ai-model-panel {
    transition-duration: 0.01ms;
  }
}
</style>
