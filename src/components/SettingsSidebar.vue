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
      
      <!-- Rating selection -->
      <div class="mb-4">
        <label class="text-sm font-medium block mb-2">Rating</label>
        <div class="space-y-2">
          <div v-for="rating in ['general', 'sensitive', 'questionable', 'explicit']" :key="rating" class="flex items-center justify-between">
            <label class="text-sm capitalize">{{ rating }}</label>
            <button 
              @click="toggleRatingAction(rating)" 
              class="relative inline-flex h-6 w-11 items-center rounded-full"
              :class="ratings.includes(rating) ? 'bg-pink-600' : 'bg-gray-600'"
            >
              <span 
                class="inline-block h-4 w-4 transform rounded-full bg-white transition"
                :class="ratings.includes(rating) ? 'translate-x-6' : 'translate-x-1'"
              ></span>
            </button>
          </div>
        </div>
      </div>
      
      <!-- Tag management -->
      <div class="mb-4">
        <label class="text-sm font-medium block mb-2">Whitelist Tags</label>
        <div class="flex mb-2">
          <input 
            v-model="newWhitelistTag" 
            @keyup.enter="handleAddWhitelist"
            type="text" 
            placeholder="Add tag..." 
            class="flex-1 bg-gray-700 border border-gray-600 rounded-l px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-pink-600"
          />
          <button 
            @click="handleAddWhitelist" 
            class="bg-pink-600 px-3 py-1.5 rounded-r text-sm"
          >
            Add
          </button>
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
        <div class="flex mb-2">
          <input 
            v-model="newBlacklistTag" 
            @keyup.enter="handleAddBlacklist"
            type="text" 
            placeholder="Add tag..." 
            class="flex-1 bg-gray-700 border border-gray-600 rounded-l px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-pink-600"
          />
          <button 
            @click="handleAddBlacklist" 
            class="bg-pink-600 px-3 py-1.5 rounded-r text-sm"
          >
            Add
          </button>
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

export default {
  name: 'SettingsSidebar',
  props: {
    show: Boolean,
  },
  data() {
    return {
      newWhitelistTag: '',
      newBlacklistTag: '',
    };
  },
  computed: {
    ...mapWritableState(useSettingsStore, [
      'autoScroll', 'autoScrollSeconds', 'autoScrollWaitForVideo', 'disableScrollAnimation', 'autoplayVideos',
      'mediaType', 'ratings', 'whitelistTags', 'blacklistTags'
    ]),
    ...mapWritableState(usePlayerStore, ['defaultMuted']),
  },
  methods: {
    ...mapActions(useSettingsStore, [
      'toggleRating', 'addWhitelistTag', 'removeWhitelistTag',
      'addBlacklistTag', 'removeBlacklistTag'
    ]),
    toggleRatingAction(rating) {
      this.toggleRating(rating);
    },
    handleAddWhitelist() {
      if (this.newWhitelistTag) {
        this.addWhitelistTag(this.newWhitelistTag);
        this.newWhitelistTag = '';
      }
    },
    handleAddBlacklist() {
      if (this.newBlacklistTag) {
        this.addBlacklistTag(this.newBlacklistTag);
        this.newBlacklistTag = '';
      }
    }
  }
}
</script>
