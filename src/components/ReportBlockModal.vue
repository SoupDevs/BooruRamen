<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-80 backdrop-blur-sm">
    <div class="bg-gray-800 rounded-lg max-w-sm w-full p-6 shadow-xl border border-gray-700">
      <h3 class="text-xl font-bold mb-2">Report/Block</h3>
      <p class="text-gray-300 text-sm mb-4">
        Select what to report. Blocked content will no longer appear in your feed.
      </p>

      <div class="space-y-2 mb-6">
        <!-- Post -->
        <button
          class="w-full flex items-center gap-3 p-3 bg-gray-900 hover:bg-gray-700 rounded-lg transition-colors text-left"
          @click="selectedPost = !selectedPost"
        >
          <span
            class="w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors"
            :class="selectedPost ? 'bg-red-600 border-red-600' : 'border-gray-600'"
          >
            <Check v-if="selectedPost" class="w-3 h-3 text-white" />
          </span>
          <span class="text-sm">
            This post
            <span class="text-gray-500">(#{{ post.id }})</span>
          </span>
        </button>

        <!-- Artists -->
        <button
          v-for="artist in artists"
          :key="artist"
          class="w-full flex items-center gap-3 p-3 bg-gray-900 hover:bg-gray-700 rounded-lg transition-colors text-left"
          @click="toggleArtist(artist)"
        >
          <span
            class="w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors"
            :class="selectedArtists[artist] ? 'bg-red-600 border-red-600' : 'border-gray-600'"
          >
            <Check v-if="selectedArtists[artist]" class="w-3 h-3 text-white" />
          </span>
          <span class="text-sm break-all">
            Artist: <span class="text-pink-400">{{ artist }}</span>
          </span>
        </button>

        <!-- Uploader -->
        <button
          v-if="uploaderName"
          class="w-full flex items-center gap-3 p-3 bg-gray-900 hover:bg-gray-700 rounded-lg transition-colors text-left"
          @click="selectedUploader = !selectedUploader"
        >
          <span
            class="w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors"
            :class="selectedUploader ? 'bg-red-600 border-red-600' : 'border-gray-600'"
          >
            <Check v-if="selectedUploader" class="w-3 h-3 text-white" />
          </span>
          <span class="text-sm break-all">
            Uploader: <span class="text-pink-400">{{ uploaderName }}</span>
          </span>
        </button>

        <!-- All of the above -->
        <button
          class="w-full flex items-center gap-3 p-3 bg-gray-900 hover:bg-gray-700 rounded-lg transition-colors text-left border-t border-gray-700"
          @click="toggleAll"
        >
          <span
            class="w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors"
            :class="allSelected ? 'bg-red-600 border-red-600' : 'border-gray-600'"
          >
            <Check v-if="allSelected" class="w-3 h-3 text-white" />
          </span>
          <span class="text-sm font-medium">All of the above</span>
        </button>
      </div>

      <div class="flex gap-3">
        <button
          @click="$emit('close')"
          class="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white font-medium transition"
        >
          Cancel
        </button>
        <button
          @click="submit"
          :disabled="!anySelected || submitting"
          class="flex-1 px-4 py-2 rounded text-white font-medium transition"
          :class="anySelected && !submitting ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-600 opacity-50 cursor-not-allowed'"
        >
          {{ submitting ? 'Reporting...' : 'Report/Block' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { Check } from 'lucide-vue-next';
import ReportService from '../services/ReportService';

export default {
  name: 'ReportBlockModal',
  components: { Check },
  props: {
    post: {
      type: Object,
      required: true,
    },
  },
  emits: ['close', 'reported'],
  data() {
    return {
      selectedPost: false,
      selectedArtists: {},
      selectedUploader: false,
      submitting: false,
    };
  },
  computed: {
    artists() {
      return ReportService.getArtistTags(this.post);
    },
    uploaderName() {
      const name = ReportService.getUploaderName(this.post);
      return name && name !== 'Unknown' ? name : '';
    },
    allSelected() {
      return this.selectedPost
        && this.artists.every(a => this.selectedArtists[a])
        && (!this.uploaderName || this.selectedUploader);
    },
    anySelected() {
      return this.selectedPost
        || this.selectedUploader
        || this.artists.some(a => this.selectedArtists[a]);
    },
  },
  methods: {
    toggleArtist(artist) {
      this.selectedArtists[artist] = !this.selectedArtists[artist];
    },
    toggleAll() {
      const target = !this.allSelected;
      this.selectedPost = target;
      this.artists.forEach(a => { this.selectedArtists[a] = target; });
      if (this.uploaderName) this.selectedUploader = target;
    },
    async submit() {
      if (!this.anySelected || this.submitting) return;
      this.submitting = true;
      try {
        const tasks = [];
        if (this.selectedPost) {
          tasks.push(ReportService.reportPost(this.post));
        }
        this.artists.forEach(artist => {
          if (this.selectedArtists[artist]) {
            tasks.push(ReportService.reportArtist(artist));
          }
        });
        if (this.selectedUploader && this.uploaderName) {
          tasks.push(ReportService.reportUploader(this.uploaderName));
        }
        await Promise.all(tasks);
        this.$emit('reported');
      } catch (error) {
        console.error('[ReportBlockModal] Failed to save report:', error);
      } finally {
        this.submitting = false;
      }
    },
  },
};
</script>
