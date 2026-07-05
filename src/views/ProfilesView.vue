<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div class="p-4 text-white h-full overflow-y-auto">
    <!-- Header with back button and centered title -->
    <div class="relative flex items-center justify-center mb-6">
      <router-link
        to="/profile"
        class="absolute left-0 text-pink-500 hover:text-pink-400 flex items-center gap-1"
      >
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        <span class="text-sm">Profile</span>
      </router-link>
      <h1 class="text-xl font-bold">Profiles</h1>
    </div>

    <div class="max-w-2xl mx-auto space-y-2">
      <p class="text-xs text-gray-500 text-center mb-4">
        Each profile keeps its own recommendations, history, likes, favorites and settings.
        Tap a profile to switch to it. Long press a profile to delete it.
      </p>

      <div
        v-for="profile in profiles"
        :key="profile.id"
        class="flex items-center gap-2"
      >
        <button
          class="flex-1 min-w-0 flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors group select-none"
          :class="{ 'ring-1 ring-pink-500/60': profile.id === activeProfileId }"
          @pointerdown="startLongPress(profile, $event)"
          @pointerup="cancelLongPress"
          @pointerleave="cancelLongPress"
          @pointercancel="cancelLongPress"
          @contextmenu.prevent
          @click="onProfileClick(profile)"
        >
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-10 h-10 rounded-full bg-pink-600/20 flex items-center justify-center flex-shrink-0">
              <User class="w-5 h-5 text-pink-400" />
            </div>
            <div class="text-left min-w-0">
              <div class="font-medium truncate">{{ profile.name }}</div>
              <div class="text-xs text-gray-400">
                {{ profile.id === activeProfileId ? 'Active profile' : `Created ${formatDate(profile.createdAt)}` }}
              </div>
            </div>
          </div>
          <Check
            v-if="profile.id === activeProfileId"
            class="w-5 h-5 text-pink-400 flex-shrink-0"
          />
        </button>

        <!-- Delete button, revealed by long press -->
        <transition name="delete-reveal">
          <button
            v-if="deleteRevealedId === profile.id"
            @click="askDelete(profile)"
            class="w-12 h-12 flex-shrink-0 flex items-center justify-center bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
            aria-label="Delete profile"
          >
            <Trash2 class="w-5 h-5 text-white" />
          </button>
        </transition>
      </div>

      <!-- Create new profile -->
      <div v-if="creating" class="flex items-center gap-2 p-2 bg-gray-800 rounded-lg">
        <input
          ref="nameInput"
          v-model="newProfileName"
          @keyup.enter="createNewProfile"
          @keyup.esc="creating = false"
          type="text"
          maxlength="40"
          placeholder="Profile name"
          class="flex-1 min-w-0 bg-gray-900 border border-gray-700 focus:border-pink-500 rounded px-3 py-2 text-sm outline-none"
        />
        <button
          @click="createNewProfile"
          class="px-4 py-2 bg-pink-600 hover:bg-pink-700 rounded text-sm font-medium transition"
        >
          Create
        </button>
        <button
          @click="creating = false"
          class="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition"
        >
          Cancel
        </button>
      </div>
      <button
        v-else
        @click="openCreate"
        class="w-full flex items-center justify-center gap-2 p-4 border border-dashed border-gray-600 hover:border-pink-500 hover:text-pink-400 text-gray-400 rounded-lg transition-colors"
      >
        <Plus class="w-5 h-5" />
        <span class="font-medium">New Profile</span>
      </button>
    </div>

    <!-- Delete confirmation splash -->
    <div
      v-if="confirmTarget"
      class="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black bg-opacity-80 backdrop-blur-sm"
    >
      <div class="bg-gray-800 rounded-lg max-w-sm w-full p-6 shadow-xl border border-gray-700">
        <div class="flex items-start gap-3 mb-2">
          <div class="w-8 h-8 rounded-full bg-red-600/20 flex items-center justify-center flex-shrink-0">
            <AlertTriangle class="w-5 h-5 text-red-400" />
          </div>
          <h3 class="text-xl font-bold">Delete "{{ confirmTarget.name }}"?</h3>
        </div>
        <p class="text-gray-300 mb-2">
          This permanently deletes the profile and everything it contains — its
          recommendations, history, likes, favorites, reports and settings.
        </p>
        <p class="text-red-400 text-sm font-medium mb-6">This action is irreversible.</p>
        <div class="flex gap-3">
          <button
            @click="confirmTarget = null"
            :disabled="deleting"
            class="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white font-medium transition"
          >
            Cancel
          </button>
          <button
            @click="performDelete"
            :disabled="deleting"
            class="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded text-white font-medium transition"
          >
            {{ deleting ? 'Deleting…' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Switching overlay: shown briefly until the reload lands -->
    <div
      v-if="switching"
      class="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-sm"
    >
      <div class="flex items-center gap-3 text-gray-200">
        <RefreshCw class="w-6 h-6 text-pink-400 animate-spin" />
        <span class="font-medium">Switching profile…</span>
      </div>
    </div>
  </div>
</template>

<script>
import { User, Check, Plus, Trash2, AlertTriangle, RefreshCw } from 'lucide-vue-next';
import { getProfiles, getActiveProfile, createProfile, switchProfile, deleteProfile } from '../services/ProfileService';

const LONG_PRESS_MS = 500;

export default {
  name: 'ProfilesView',
  components: { User, Check, Plus, Trash2, AlertTriangle, RefreshCw },
  data() {
    return {
      profiles: [],
      activeProfileId: null,
      creating: false,
      newProfileName: '',
      deleteRevealedId: null,
      confirmTarget: null,
      deleting: false,
      switching: false,
      longPressTimer: null,
      suppressNextClick: false,
    };
  },
  created() {
    this.refresh();
  },
  beforeUnmount() {
    clearTimeout(this.longPressTimer);
  },
  methods: {
    refresh() {
      this.profiles = getProfiles();
      this.activeProfileId = getActiveProfile().id;
    },
    formatDate(timestamp) {
      if (!timestamp) return 'unknown';
      return new Date(timestamp).toLocaleDateString();
    },
    startLongPress(profile) {
      clearTimeout(this.longPressTimer);
      // The last remaining profile can't be deleted, so don't reveal a
      // delete button for it
      if (this.profiles.length <= 1) return;
      this.longPressTimer = setTimeout(() => {
        this.deleteRevealedId = profile.id;
        this.suppressNextClick = true;
        if (navigator.vibrate) navigator.vibrate(10);
      }, LONG_PRESS_MS);
    },
    cancelLongPress() {
      clearTimeout(this.longPressTimer);
    },
    onProfileClick(profile) {
      // The click that ends a long press must not switch profiles
      if (this.suppressNextClick) {
        this.suppressNextClick = false;
        return;
      }
      // A tap while a delete button is revealed just dismisses it
      if (this.deleteRevealedId) {
        this.deleteRevealedId = null;
        return;
      }
      if (profile.id === this.activeProfileId) return;
      this.switching = true;
      switchProfile(profile.id);
    },
    openCreate() {
      this.creating = true;
      this.newProfileName = '';
      this.$nextTick(() => this.$refs.nameInput && this.$refs.nameInput.focus());
    },
    createNewProfile() {
      createProfile(this.newProfileName);
      this.creating = false;
      this.newProfileName = '';
      this.refresh();
    },
    askDelete(profile) {
      this.confirmTarget = profile;
    },
    async performDelete() {
      if (!this.confirmTarget || this.deleting) return;
      this.deleting = true;
      try {
        // Deleting the active profile switches to another one and reloads
        // the app; for other profiles we just refresh the list.
        await deleteProfile(this.confirmTarget.id);
      } finally {
        this.deleting = false;
        this.confirmTarget = null;
        this.deleteRevealedId = null;
        this.refresh();
      }
    },
  },
};
</script>

<style scoped>
.delete-reveal-enter-active,
.delete-reveal-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.delete-reveal-enter-from,
.delete-reveal-leave-to {
  opacity: 0;
  transform: translateX(0.5rem) scale(0.5);
}
</style>
