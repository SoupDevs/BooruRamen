<template>
  <div>
    <div class="flex items-center justify-between gap-3">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <label class="text-sm font-medium" for="ai-tagging-enabled">AI Image Tagging</label>
        <span class="text-xs" :class="state.ready || state.downloaded ? 'text-green-400' : 'text-red-400'" role="status">{{ state.ready ? 'Model ready' : state.downloaded ? 'Model downloaded' : 'Model not ready' }}</span>
      </div>
      <button id="ai-tagging-enabled" type="button" role="switch" aria-label="AI Image Tagging" :aria-checked="settings.aiTaggingEnabled" :disabled="state.removing"
        class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full disabled:opacity-50"
        :class="settings.aiTaggingEnabled ? 'bg-pink-600' : 'bg-gray-600'" @click="toggle(!settings.aiTaggingEnabled)">
        <span class="inline-block h-4 w-4 transform rounded-full bg-white transition" :class="settings.aiTaggingEnabled ? 'translate-x-6' : 'translate-x-1'"></span>
      </button>
    </div>
    <p class="text-xs text-gray-400 mt-2">Add missing tags locally in the background. Requires a 468 MB model download.</p>
    <div class="flex flex-wrap items-end gap-3 mt-2">
      <button v-if="!state.ready && (!state.downloaded || downloading)" :disabled="state.removing || downloading" :aria-busy="downloading"
        class="inline-flex items-center gap-2 rounded-md bg-pink-600 enabled:hover:bg-pink-700 text-white px-3 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed" @click="tagger.showPrompt()">
        <span v-if="downloading" aria-hidden="true" class="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin motion-reduce:animate-none"></span>
        {{ downloading ? 'Downloading model...' : 'Download Model' }}
      </button>
      <button v-if="state.cached || state.ready" :disabled="state.removing" class="rounded-md bg-pink-600 hover:bg-pink-700 text-white px-3 py-1.5 text-sm disabled:opacity-50" @click="tagger.uninstall(settings)">{{ state.removing ? 'Uninstalling…' : 'Uninstall model' }}</button>
      <div v-if="downloading" class="ml-auto w-36 text-right">
        <p class="text-xs text-gray-400" aria-live="polite">{{ Math.round(state.progress * 100) }}%</p>
        <progress class="block w-full h-2 mt-1 accent-pink-600" :value="state.progress" max="1" aria-label="Model download progress"></progress>
      </div>
    </div>
    <p v-if="state.phase === 'failed'" class="text-xs text-gray-400 mt-2">{{ state.error }}</p>
  </div>
</template>
<script setup>
import { computed, watch } from 'vue';
import { useSettingsStore } from '../stores/settings.js';
import tagger, { aiTaggerState as state } from '../services/AiTaggerService.js';
const settings = useSettingsStore();
const downloading = computed(() => ['downloading', 'initializing'].includes(state.phase));
function toggle(enabled) {
  if (!enabled) { settings.updateSettings({ aiTaggingEnabled: false }); tagger.stop(); }
  else if (state.ready) settings.updateSettings({ aiTaggingEnabled: true });
  else if (state.downloaded) tagger.prepare(settings, false);
  else tagger.showPrompt();
}
watch(() => settings.aiTaggingEnabled, enabled => { if (!enabled && state.ready) tagger.stop(); });
</script>
