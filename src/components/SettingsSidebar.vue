<template>
  <div 
    class="absolute top-0 right-0 w-80 h-full bg-transparent backdrop-blur-sm border-l border-gray-700 overflow-y-auto z-50 transition-transform duration-300 ease-in-out"
    :style="{ transform: show ? 'translateX(0)' : 'translateX(100%)' }"
  >
  <div class="p-4" style="padding-top: calc(1rem + env(safe-area-inset-top, 0)); padding-bottom: calc(5rem + env(safe-area-inset-bottom, 0));">
      <h2 class="text-xl font-bold mb-4">Settings</h2>
      
      <!-- Auto-scroll toggle -->
      <div class="mb-4">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium">Auto-scroll</label>
          <button 
            @click="autoScroll = !autoScroll" 
            class="relative inline-flex h-6 w-11 items-center rounded-full"
            :class="autoScroll ? 'bg-pink-600' : 'bg-gray-600'"
          >
            <span 
              class="inline-block h-4 w-4 transform rounded-full bg-white transition"
              :class="autoScroll ? 'translate-x-6' : 'translate-x-1'"
            ></span>
          </button>
        </div>
        <div class="mt-2">
          <label class="text-sm text-gray-400 block mb-1">Seconds between scrolls</label>
          <input 
            v-model.number="autoScrollSeconds" 
            type="number" 
            min="1" 
            max="60"
            class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-pink-600"
          />
        </div>
        <div class="mt-2" :class="{ 'opacity-50 pointer-events-none': !autoScroll }">
          <div class="flex items-center justify-between">
            <label class="text-sm text-gray-400">Wait for video to finish</label>
            <button 
              @click="autoScrollWaitForVideo = !autoScrollWaitForVideo" 
              class="relative inline-flex h-6 w-11 items-center rounded-full"
              :class="autoScrollWaitForVideo ? 'bg-pink-600' : 'bg-gray-600'"
            >
              <span 
                class="inline-block h-4 w-4 transform rounded-full bg-white transition"
                :class="autoScrollWaitForVideo ? 'translate-x-6' : 'translate-x-1'"
              ></span>
            </button>
          </div>
        </div>
      </div>

      <!-- Disable scroll animation toggle -->
      <div class="mb-4">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium">Disable scroll animation</label>
          <button 
            @click="disableScrollAnimation = !disableScrollAnimation" 
            class="relative inline-flex h-6 w-11 items-center rounded-full"
            :class="disableScrollAnimation ? 'bg-pink-600' : 'bg-gray-600'"
          >
            <span 
              class="inline-block h-4 w-4 transform rounded-full bg-white transition"
              :class="disableScrollAnimation ? 'translate-x-6' : 'translate-x-1'"
            ></span>
          </button>
        </div>
      </div>
      
      <!-- Autoplay videos toggle -->
      <div class="mb-4">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium">Autoplay Videos</label>
          <button 
            @click="autoplayVideos = !autoplayVideos" 
            class="relative inline-flex h-6 w-11 items-center rounded-full"
            :class="autoplayVideos ? 'bg-pink-600' : 'bg-gray-600'"
          >
            <span 
              class="inline-block h-4 w-4 transform rounded-full bg-white transition"
              :class="autoplayVideos ? 'translate-x-6' : 'translate-x-1'"
            ></span>
          </button>
        </div>
      </div>
      
      <!-- Loop videos toggle -->
      <div class="mb-4">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium">Loop Videos</label>
          <button 
            @click="loopVideos = !loopVideos" 
            class="relative inline-flex h-6 w-11 items-center rounded-full"
            :class="loopVideos ? 'bg-pink-600' : 'bg-gray-600'"
          >
            <span 
              class="inline-block h-4 w-4 transform rounded-full bg-white transition"
              :class="loopVideos ? 'translate-x-6' : 'translate-x-1'"
            ></span>
          </button>
        </div>
      </div>
      
      <!-- Focus mode toggle -->
      <div class="mb-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <label class="text-sm font-medium">Focus mode</label>
          </div>
          <button 
            @click="focusMode = !focusMode" 
            class="relative inline-flex h-6 w-11 items-center rounded-full shrink-0"
            :class="focusMode ? 'bg-pink-600' : 'bg-gray-600'"
            data-focus-mode-toggle
          >
            <span 
              class="inline-block h-4 w-4 transform rounded-full bg-white transition"
              :class="focusMode ? 'translate-x-6' : 'translate-x-1'"
            ></span>
          </button>
        </div>
      </div>
      
      <!-- Default muted toggle -->
      <div class="mb-4">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium">Start Videos Muted</label>
          <button 
            @click="defaultMuted = !defaultMuted; $emit('save-player-preferences')" 
            class="relative inline-flex h-6 w-11 items-center rounded-full"
            :class="defaultMuted ? 'bg-pink-600' : 'bg-gray-600'"
          >
            <span 
              class="inline-block h-4 w-4 transform rounded-full bg-white transition"
              :class="defaultMuted ? 'translate-x-6' : 'translate-x-1'"
            ></span>
          </button>
        </div>
      </div>
      
      <!-- Media type selection -->
      <div class="mb-4">
        <label class="text-sm font-medium block mb-2">Media Type</label>
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="text-sm">Images</label>
            <button 
              @click="mediaType.images = !mediaType.images" 
              class="relative inline-flex h-6 w-11 items-center rounded-full"
              :class="mediaType.images ? 'bg-pink-600' : 'bg-gray-600'"
            >
              <span 
                class="inline-block h-4 w-4 transform rounded-full bg-white transition"
                :class="mediaType.images ? 'translate-x-6' : 'translate-x-1'"
              ></span>
            </button>
          </div>
          <div class="flex items-center justify-between">
            <label class="text-sm">Videos</label>
            <button 
              @click="mediaType.videos = !mediaType.videos" 
              class="relative inline-flex h-6 w-11 items-center rounded-full"
              :class="mediaType.videos ? 'bg-pink-600' : 'bg-gray-600'"
            >
              <span 
                class="inline-block h-4 w-4 transform rounded-full bg-white transition"
                :class="mediaType.videos ? 'translate-x-6' : 'translate-x-1'"
              ></span>
            </button>
          </div>
        </div>
      </div>
      
      <!-- Tag management -->
      <div class="mb-4">
        <label class="text-sm font-medium block mb-2">Whitelist Tags</label>
        <div class="relative flex mb-2">
          <input 
            v-model="newWhitelistTag" 
            @input="onTagInput('whitelist')"
            @focus="onTagFocus('whitelist')"
            @keydown.enter.prevent="onTagEnter('whitelist')"
            @keydown.down.prevent="moveSuggestion('whitelist', 1)"
            @keydown.up.prevent="moveSuggestion('whitelist', -1)"
            @keydown.esc="closeSuggestions('whitelist')"
            @blur="closeSuggestions('whitelist')"
            type="text" 
            placeholder="Add tag..." 
            autocomplete="off"
            data-tag-input="whitelist"
            class="flex-1 bg-gray-700 border border-gray-600 rounded-l px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-pink-600"
          />
          <button 
            @click="handleAddWhitelist" 
            class="bg-pink-600 px-3 py-1.5 rounded-r text-sm"
          >
            Add
          </button>
          <ul
            v-if="suggest.whitelist.open && suggest.whitelist.items.length > 0"
            class="absolute left-0 right-0 top-full mt-1 z-30 max-h-56 overflow-y-auto rounded border border-gray-700 bg-gray-900 shadow-lg"
            data-tag-suggestions="whitelist"
          >
            <li
              v-for="(option, index) in suggest.whitelist.items"
              :key="option"
              class="px-3 py-1.5 text-sm cursor-pointer flex items-center justify-between gap-2"
              :class="index === suggest.whitelist.active ? 'bg-pink-600 text-white' : 'text-gray-200 hover:bg-gray-800'"
              :data-tag-suggestion="option"
              @pointerdown.prevent="pickSuggestion('whitelist', option)"
              @mouseenter="suggest.whitelist.active = index"
            >
              <span class="truncate">{{ option }}</span>
              <span v-if="suggest.whitelist.remote.has(option)" class="text-[10px] opacity-60 shrink-0">live</span>
            </li>
          </ul>
        </div>
        <div class="flex flex-wrap gap-2 mt-2">
          <div 
            v-for="(tag, index) in whitelistTags" 
            :key="index"
            class="bg-gray-700 px-2 py-1 rounded text-xs flex items-center"
          >
            {{ tag }}
            <button @click="removeWhitelistTag(index)" class="ml-1.5 text-gray-400 hover:text-white">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        </div>
      </div>
      
      <div class="mb-4">
        <label class="text-sm font-medium block mb-2">Blacklist Tags</label>
        <div class="relative flex mb-2">
          <input 
            v-model="newBlacklistTag" 
            @input="onTagInput('blacklist')"
            @focus="onTagFocus('blacklist')"
            @keydown.enter.prevent="onTagEnter('blacklist')"
            @keydown.down.prevent="moveSuggestion('blacklist', 1)"
            @keydown.up.prevent="moveSuggestion('blacklist', -1)"
            @keydown.esc="closeSuggestions('blacklist')"
            @blur="closeSuggestions('blacklist')"
            type="text" 
            placeholder="Add tag..." 
            autocomplete="off"
            data-tag-input="blacklist"
            class="flex-1 bg-gray-700 border border-gray-600 rounded-l px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-pink-600"
          />
          <button 
            @click="handleAddBlacklist" 
            class="bg-pink-600 px-3 py-1.5 rounded-r text-sm"
          >
            Add
          </button>
          <ul
            v-if="suggest.blacklist.open && suggest.blacklist.items.length > 0"
            class="absolute left-0 right-0 top-full mt-1 z-30 max-h-56 overflow-y-auto rounded border border-gray-700 bg-gray-900 shadow-lg"
            data-tag-suggestions="blacklist"
          >
            <li
              v-for="(option, index) in suggest.blacklist.items"
              :key="option"
              class="px-3 py-1.5 text-sm cursor-pointer flex items-center justify-between gap-2"
              :class="index === suggest.blacklist.active ? 'bg-pink-600 text-white' : 'text-gray-200 hover:bg-gray-800'"
              :data-tag-suggestion="option"
              @pointerdown.prevent="pickSuggestion('blacklist', option)"
              @mouseenter="suggest.blacklist.active = index"
            >
              <span class="truncate">{{ option }}</span>
              <span v-if="suggest.blacklist.remote.has(option)" class="text-[10px] opacity-60 shrink-0">live</span>
            </li>
          </ul>
        </div>
        <div class="flex flex-wrap gap-2 mt-2">
          <div 
            v-for="(tag, index) in blacklistTags" 
            :key="index"
            class="bg-gray-700 px-2 py-1 rounded text-xs flex items-center"
          >
            {{ tag }}
            <button @click="removeBlacklistTag(index)" class="ml-1.5 text-gray-400 hover:text-white">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        </div>
      </div>
      
      <!-- Recommendations section -->
      
      <button 
        @click="$emit('apply-settings')" 
        class="w-full bg-pink-600 hover:bg-pink-700 text-white py-2 rounded-md mt-4"
      >
        Apply Settings
      </button>
    </div>
  </div>
</template>

<script>
import { mapState, mapWritableState, mapActions } from 'pinia';
import { useSettingsStore } from '../stores/settings';
import { usePlayerStore } from '../stores/player';
import tagSuggestion from '../services/TagSuggestionService';

export default {
  name: 'SettingsSidebar',
  props: {
    show: Boolean,
  },
  data() {
    return {
      newWhitelistTag: '',
      newBlacklistTag: '',
      // Per-field dropdown state. `items` is filled synchronously from the
      // local index on every keystroke; `remote` tags from the enabled
      // sources arrive a beat later and are merged in.
      suggest: {
        whitelist: { open: false, items: [], active: -1, remote: new Set(), remoteTimer: null, query: '' },
        blacklist: { open: false, items: [], active: -1, remote: new Set(), remoteTimer: null, query: '' },
      },
    };
  },
  computed: {
    ...mapWritableState(useSettingsStore, [
      'autoScroll', 'autoScrollSeconds', 'autoScrollWaitForVideo', 'disableScrollAnimation', 'autoplayVideos', 'loopVideos',
      'mediaType', 'whitelistTags', 'blacklistTags', 'focusMode'
    ]),
    ...mapWritableState(usePlayerStore, ['defaultMuted']),
  },
  mounted() {
    // Warm the local index (tag cache + view history) before the first
    // keystroke so the very first dropdown is already fast.
    tagSuggestion.prime();
  },
  methods: {
    ...mapActions(useSettingsStore, [
      'addWhitelistTag', 'removeWhitelistTag',
      'addBlacklistTag', 'removeBlacklistTag'
    ]),
    handleAddWhitelist() {
      this.commitTag('whitelist', this.newWhitelistTag);
    },
    handleAddBlacklist() {
      this.commitTag('blacklist', this.newBlacklistTag);
    },
    /** Add a tag to the list the field belongs to and reset the field. */
    commitTag(which, value) {
      const tag = String(value == null ? '' : value).trim();
      if (tag) {
        if (which === 'whitelist') this.addWhitelistTag(tag);
        else this.addBlacklistTag(tag);
      }
      if (which === 'whitelist') this.newWhitelistTag = '';
      else this.newBlacklistTag = '';
      this.closeSuggestions(which);
    },
    tagInputValue(which) {
      return which === 'whitelist' ? this.newWhitelistTag : this.newBlacklistTag;
    },
    excludeTags(which) {
      return which === 'whitelist' ? this.whitelistTags : this.blacklistTags;
    },
    onTagFocus(which) {
      tagSuggestion.prime();
      const raw = this.tagInputValue(which);
      if (raw && raw.trim()) this.refreshSuggestions(which, raw);
    },
    onTagInput(which) {
      this.refreshSuggestions(which, this.tagInputValue(which));
    },
    /**
     * Rank the local index immediately, then merge remote tags from the
     * enabled sources once they land. An answer for an older query is dropped
     * so typing fast never shows stale suggestions.
     */
    async refreshSuggestions(which, raw) {
      const state = this.suggest[which];
      const query = String(raw == null ? '' : raw).trim().toLowerCase();
      state.query = query;
      clearTimeout(state.remoteTimer);

      if (!query) {
        state.items = [];
        state.active = -1;
        state.open = false;
        return;
      }

      const exclude = this.excludeTags(which);
      const local = tagSuggestion.suggest(query, { limit: 10, exclude });
      state.items = local;
      state.remote = new Set();
      state.active = local.length > 0 ? 0 : -1;
      state.open = local.length > 0;

      state.remoteTimer = setTimeout(async () => {
        tagSuggestion.markRemoteQuery(query);
        const remote = await tagSuggestion.remoteSuggest(query, 10);
        if (state.query !== query || !tagSuggestion.isRemoteQueryCurrent(query)) return;
        const excludeNow = this.excludeTags(which);
        const known = new Set(state.items);
        const fresh = remote.filter((tag) => tag && !known.has(tag) && !excludeNow.includes(tag));
        if (fresh.length === 0) return;
        const remoteSet = new Set([...remote, ...state.remote]);
        state.items = [...state.items, ...fresh].slice(0, 12);
        state.remote = new Set(state.items.filter((tag) => remoteSet.has(tag)));
        state.open = true;
        if (state.active < 0) state.active = 0;
      }, 150);
    },
    closeSuggestions(which) {
      const state = this.suggest[which];
      state.open = false;
      state.active = -1;
      clearTimeout(state.remoteTimer);
    },
    moveSuggestion(which, step) {
      const state = this.suggest[which];
      if (!state.open || state.items.length === 0) return;
      state.active = Math.max(0, Math.min(state.items.length - 1, state.active + step));
    },
    onTagEnter(which) {
      const state = this.suggest[which];
      if (state.open && state.active >= 0 && state.items[state.active]) {
        this.pickSuggestion(which, state.items[state.active]);
        return;
      }
      this.commitTag(which, this.tagInputValue(which));
    },
    /** A tap on a suggestion adds it straight to that list. */
    pickSuggestion(which, tag) {
      this.commitTag(which, tag);
    }
  }
}
</script>
