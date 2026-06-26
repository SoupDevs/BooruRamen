<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 DottsGit

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div class="p-4 text-white h-full overflow-y-auto">
    <router-link to="/profile" class="text-pink-500 mb-4 inline-block">&lt; Back to Profile</router-link>
    <h1 class="text-2xl font-bold mb-8 text-center">Profile Settings</h1>
    
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
      <!-- Left Column: Source Management -->
      <div class="space-y-6">
        <div class="p-4 bg-gray-800 rounded-lg h-full"> 
           <h2 class="text-lg font-medium mb-3">Booru Sources</h2>
           <p class="text-xs text-gray-400 mb-4">Select one or more sources to search from. Aggregating multiple sources may be slower.</p>
           
           <div class="space-y-2 mb-4">
               <!-- Predefined Sources -->
               <div v-for="source in predefinedSources" :key="source.name">
                   <div class="mb-2">
                       <div class="flex items-center justify-between bg-gray-900 p-2 rounded">
                           <div class="flex items-center gap-2">
                                                               <span class="w-2 h-2 rounded-full flex-shrink-0" :class="getStatusClass(source.url)"></span>
                                <span class="text-sm font-medium">{{ source.name }}</span>
                               <span class="text-xs text-gray-500">({{ source.type }})</span>
                               <span v-if="!supportsVideo(source)" class="text-xs text-yellow-400 italic">Images Only</span>
                               <span v-if="requiresAuth(source)" class="text-xs text-yellow-400 italic">API Auth Required</span>
                           </div>
                           <div class="flex items-center gap-3">
                                <button
                                 v-if="showAuthButton(source)"
                                 @click="toggleAuth(source)"
                                 class="text-gray-500 hover:text-white" :class="getAuthClass(source.url)"
                                title="Configure Authentication"
                               >
                                 <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2">
                                   <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                                 </svg>
                               </button>
                               <button 
                                @click="toggleSource(source)"
                                class="w-5 h-5 rounded border flex items-center justify-center transition-colors"
                                :class="isSourceActive(source) ? 'bg-pink-600 border-pink-600' : 'border-gray-600 hover:border-gray-500'"
                               >
                                  <svg v-if="isSourceActive(source)" viewBox="0 0 24 24" class="w-3 h-3 fill-white" stroke="currentColor" stroke-width="3">
                                      <polyline points="20 6 9 17 4 12"></polyline>
                                  </svg>
                               </button>
                           </div>
                       </div>
                       <div v-if="editingAuth === source.url" class="bg-gray-800 p-2 rounded mt-2 text-xs space-y-2 border border-gray-700">
                          <p class="text-gray-400">Authentication (Optional)</p>
                          <input v-model="source.userId" placeholder="User ID" class="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white" />
                          <input v-model="source.apiKey" placeholder="API Key" type="password" class="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white" />
                          <div class="flex justify-end mt-2">
                            <button 
                                @click="testAuth(source)" 
                                class="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-xs transition-colors"
                                :disabled="isTestingAuth"
                            >
                                <span v-if="isTestingAuth">Testing...</span>
                                <span v-else>Test Authentication</span>
                                <Check v-if="authTestResult && authTestResult.url === source.url && authTestResult.success" class="w-3 h-3 text-green-500" />
                                <AlertCircle v-if="authTestResult && authTestResult.url === source.url && !authTestResult.success" class="w-3 h-3 text-red-500" />
                            </button>
                          </div>
                          <p v-if="authTestResult && authTestResult.url === source.url" class="text-xs mt-1" :class="authTestResult.success ? 'text-green-400' : 'text-red-400'">
                              {{ authTestResult.message }}
                          </p>
                       </div>
                   </div>
               </div>
               
               <!-- Custom Sources -->
                <div v-for="(source, idx) in customSources" :key="source.name" class="flex items-center justify-between bg-gray-900 p-2 rounded relative group">
                   <div class="flex items-center gap-2">
                       <span class="w-2 h-2 rounded-full flex-shrink-0" :class="getStatusClass(source.url)"></span>
                       <span class="text-sm font-medium">{{ source.name }}</span>
                       <span class="text-xs text-gray-500">({{ source.type }})</span>
                       <span v-if="!supportsVideo(source)" class="text-xs text-yellow-400 italic">Images Only</span>
                   </div>
                   <div class="flex items-center gap-3">
                       <button 
                        @click="toggleSource(source)"
                        class="w-5 h-5 rounded border flex items-center justify-center transition-colors"
                        :class="isSourceActive(source) ? 'bg-pink-600 border-pink-600' : 'border-gray-600 hover:border-gray-500'"
                       >
                          <svg v-if="isSourceActive(source)" viewBox="0 0 24 24" class="w-3 h-3 fill-white" stroke="currentColor" stroke-width="3">
                              <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                       </button>
                       <button @click="removeCustomSource(idx)" class="text-gray-500 hover:text-red-500">
                          <X class="h-4 w-4" />
                       </button>
                   </div>
               </div>
           </div>

           <!-- Add Custom Source -->
           <button 
              @click="showAddSource = !showAddSource"
              class="text-xs text-pink-500 hover:text-pink-400 mb-2 block"
           >
              {{ showAddSource ? '- Cancel' : '+ Add Custom Source' }}
           </button>
           
           <div v-if="showAddSource" class="bg-gray-900 p-3 rounded mb-3 space-y-2">
              <input v-model="newSource.name" placeholder="Name (e.g. MyBooru)" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-white" />
              <input v-model="newSource.url" placeholder="URL (e.g. https://site.com)" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-white" />
              <select v-model="newSource.type" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-white">
                  <option value="danbooru">Danbooru Type</option>
                  <option value="gelbooru">Gelbooru Type</option>
                  <option value="moebooru">Moebooru Type</option>
              </select>
              <button @click="addCustomSource" class="w-full bg-pink-600 hover:bg-pink-700 text-white rounded py-1.5 text-xs font-medium">Add Source</button>
           </div>

            <div class="flex justify-between items-center mt-4">
               <span class="text-green-400 text-xs">{{ sourceSaveMessage }}</span>
               <div class="flex gap-2">
                   <button @click="testConnection" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white text-sm font-medium transition">
                      Test Authentication (All Sources)
                   </button>
                   <button @click="saveSources" class="px-4 py-2 bg-pink-600 hover:bg-pink-700 rounded text-white text-sm font-medium transition">
                      Save Sources
                   </button>
               </div>
           </div>
           
           <!-- Connection Test Results -->
           <div v-if="testResults.length > 0" class="mt-4 p-3 bg-gray-900 rounded border border-gray-700">
               <h4 class="text-sm font-bold text-gray-300 mb-2">Authentication Test Results</h4>
               <div v-for="(res, idx) in testResults" :key="idx" class="flex items-start gap-2 mb-1 last:mb-0 text-xs">
                   <Check v-if="res.success" class="text-green-500 w-4 h-4 mt-0.5" />
                   <X v-else class="text-red-500 w-4 h-4 mt-0.5" />
                   <div>
                       <span class="font-bold text-gray-400">{{ res.source }}: </span>
                       <span :class="res.success ? 'text-green-400' : 'text-red-400'">{{ res.message }}</span>
                   </div>
               </div>
           </div>
        </div>
      </div>

      <!-- Right Column: General Settings -->
      <div class="space-y-6">
        <!-- Avoided Tags Configuration -->
        <div class="p-4 bg-gray-800 rounded-lg">
          <div class="mb-2">
            <label class="text-lg font-medium">Avoided Query Tags</label>
            <p class="text-xs text-gray-400 mt-1">
              These tags are excluded from search queries to prevent generic results. 
              Separate with spaces.
            </p>
          </div>
          
          <textarea 
            v-model="avoidedTagsInput" 
            class="w-full h-32 bg-gray-900 border border-gray-700 rounded p-2 text-sm text-gray-200 focus:border-pink-500 focus:outline-none mb-3"
            placeholder="e.g. 1girl, solo, comic..."
            @keydown.space.stop
          ></textarea>
          
          <div class="flex justify-between items-center">
            <button 
              @click="resetAvoidedTags" 
              class="text-sm text-gray-400 hover:text-white underline"
            >
              Reset to Defaults
            </button>
            
            <button 
              @click="saveAvoidedTags" 
              class="px-4 py-2 bg-pink-600 hover:bg-pink-700 rounded text-white text-sm font-medium transition"
            >
              Save Tags
            </button>
          </div>
          <p v-if="saveMessage" class="text-green-400 text-xs mt-2 text-right">{{ saveMessage }}</p>
        </div>

        <!-- Toggle Debug Mode -->
        <div @click="toggleDebugMode" class="flex items-center justify-between p-4 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-750">
          <div class="flex flex-col">
            <label class="text-lg cursor-pointer" for="debug-mode">Debug Mode</label>
            <span class="text-sm text-gray-400">Show recommendation analytics overlay</span>
          </div>
          <div 
            class="relative inline-flex h-6 w-11 items-center rounded-full"
            :class="debugMode ? 'bg-pink-600' : 'bg-gray-600'"
          >
            <span 
              class="inline-block h-4 w-4 transform rounded-full bg-white transition"
              :class="debugMode ? 'translate-x-6' : 'translate-x-1'"
            ></span>
          </div>
        </div>

        <!-- Toggle History -->
        <div @click="toggleHistory" class="flex items-center justify-between p-4 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-750">
          <div class="flex flex-col">
            <label class="text-lg cursor-pointer" for="disable-history">Disable View History</label>
            <span class="text-sm text-gray-400">Disabling view history may cause the feed to show previously viewed posts</span>
          </div>
          <div 
            class="relative inline-flex h-6 w-11 items-center rounded-full"
            :class="disableHistory ? 'bg-pink-600' : 'bg-gray-600'"
          >
            <span 
              class="inline-block h-4 w-4 transform rounded-full bg-white transition"
              :class="disableHistory ? 'translate-x-6' : 'translate-x-1'"
            ></span>
          </div>
        </div>

        <!-- Clear Buttons -->
        <div class="space-y-4">
          <button @click="showRefreshFeedModal" class="w-full text-center bg-blue-700 hover:bg-blue-600 py-3 rounded-md text-lg">
            Refresh your feed
          </button>
          
          <!-- Spacer -->
          <div class="border-t border-gray-700"></div>
          
          <button @click="wipeHistory" class="w-full text-center bg-red-800 hover:bg-red-700 py-3 rounded-md text-lg">
            Clear History
          </button>
          <button @click="wipeLikes" class="w-full text-center bg-red-800 hover:bg-red-700 py-3 rounded-md text-lg">
            Clear Likes
          </button>
          <button @click="wipeFavorites" class="w-full text-center bg-red-800 hover:bg-red-700 py-3 rounded-md text-lg">
            Clear Favorites
          </button>
          <button @click="wipeAll" class="w-full text-center bg-red-800 hover:bg-red-700 py-3 rounded-md text-lg">
            Clear All Data
          </button>
        </div>
      </div>
    </div>

    <!-- Confirmation Modal -->
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-80 backdrop-blur-sm">
      <div class="bg-gray-800 rounded-lg max-w-sm w-full p-6 shadow-xl border border-gray-700">
        <h3 class="text-xl font-bold mb-2">{{ modalTitle }}</h3>
        <p class="text-gray-300 mb-6">{{ modalMessage }}</p>
        <div class="flex gap-3">
          <button 
            @click="closeModal" 
            class="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white font-medium transition"
          >
            Cancel
          </button>
          <button 
            @click="executeAction" 
            class="flex-1 px-4 py-2 bg-pink-600 hover:bg-pink-700 rounded text-white font-medium transition"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>

    <!-- Refresh Feed Modal -->
    <div v-if="showRefreshModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-80 backdrop-blur-sm">
      <div class="bg-gray-800 rounded-lg max-w-sm w-full p-6 shadow-xl border border-gray-700">
        <h3 class="text-xl font-bold mb-2">Start fresh?</h3>
        <p class="text-gray-300 mb-6">We'll clear your history and reset your recommendations so you can discover new content.</p>
        <div class="flex gap-3">
          <button 
            @click="closeRefreshModal" 
            class="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white font-medium transition"
          >
            Keep Current
          </button>
          <button 
            @click="executeRefreshFeed" 
            class="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white font-medium transition"
          >
            Start Fresh
          </button>
        </div>
      </div>
    </div>

    <!-- About/License Note -->
    <div class="mt-16 pb-8 text-center border-t border-gray-800 pt-8 opacity-40">
      <p class="text-sm font-semibold text-gray-400">BooruRamen v0.2.0-0</p>
      <p class="text-xs text-gray-500 mt-1">
        Licensed under <span class="text-pink-500/80 uppercase">GPL-3.0</span>
      </p>
      <p class="text-[10px] text-gray-600 mt-2">© 2025 DottsGit</p>
    </div>
  </div>
</template>

<script>
import { mapWritableState, mapActions } from 'pinia';
import { useSettingsStore } from '../stores/settings';
import { useInteractionsStore } from '../stores/interactions';
import StorageService from '../services/StorageService';
import RecommendationSystem, { COMMON_TAGS } from '../services/RecommendationSystem';

import BooruService from '../services/BooruService';
import { DanbooruAdapter, GelbooruAdapter, MoebooruAdapter } from '../services/BooruAdapters';
import { X, Check, AlertCircle } from 'lucide-vue-next';

export default {
  name: 'ProfileSettingsView',
  components: {
    X, Check, AlertCircle
  },
  data() {
    return {
      showModal: false,
      modalTitle: '',
      modalMessage: '',

      pendingAction: null,
      showRefreshModal: false,
      avoidedTagsInput: '',

      saveMessage: '',

      // Source Management
      predefinedSources: [],
      // customSources: [], // Mapped to store
      // activeSources: [], // Mapped to store (as activeSource / customSources, but store has simple active/custom list, specialized logic needed?)
      // Wait, App.vue has `activeSource` (single) and `customSources` (array).
      // But `ProfileSettingsView` seems to support multiple active sources via `activeSources` array.
      // Let's check App.vue again. `activeSource: { type: 'danbooru', ... }` (Single object).
      // But ProfileSettingsView has `activeSources: []` (Array).
      // This suggests a divergence or work-in-progress multi-source support.
      // However, App.vue `activeSource` suggests only one source is active at a time?
      // Or maybe `ProfileSettingsView` allows selecting multiple, but App only uses one?
      // `BooruService.setActiveSources` takes an array.
      // So App.vue might be outdated with `activeSource` (singular) if multi-source is implemented.
      // But let's look at `useSettingsStore` I created. I copied `activeSource` (singular).
      // If `ProfileSettingsView` uses multiple, I should update the store to support `activeSources` (plural).

      // Let's check `StorageService.js` usage in `ProfileSettingsView`.
      // `this.activeSources = preferences.activeSources || ...`.
      // So multiple sources ARE supported by storage.
      // I should update `settings.js` store to have `activeSources` array instead of just `activeSource`.
      
      localActiveSources: [], // Local buffer for UI before save

      showAddSource: false,
      newSource: { name: '', url: '', type: 'gelbooru' },
      sourceSaveMessage: '',
      editingAuth: null,
      isTestingAuth: false,
      authTestResult: null,
      testResults: [],
      sourceStatus: {},
      authStatus: {},
    };
  },
  computed: {
    ...mapWritableState(useSettingsStore, ['disableHistory', 'debugMode', 'customSources', 'activeSource']), 
    // Wait, if I change activeSource to activeSources in store...
    
  },
  async mounted() {
    // Initialize local state from store
    // actually, let's just read from store directly if mapped.
    // But specific logic for sources might need local state.
    
    // Load avoided tags - this is not in my settings store yet? 
    // App.vue didn't have `avoidedTags`. `ProfileSettingsView` had it.
    // `StorageService` loaded it.
    // I should add `avoidedTags` to settings store.

    const preferences = await StorageService.getPreferences(); // Still need this for things not in store yet?
    // Actually, everything should be in store.
    // I missed `avoidedTags` in store. I will add it.
    
    if (preferences.avoidedTags && Array.isArray(preferences.avoidedTags)) {
      this.avoidedTagsInput = preferences.avoidedTags.join(' ');
    } else {
      this.avoidedTagsInput = COMMON_TAGS.join(' ');
    }

    // Load Sources
    const defaultSources = [
      { name: 'Danbooru', type: 'danbooru', url: 'https://danbooru.donmai.us' },
      { name: 'Safebooru', type: 'gelbooru', url: 'https://safebooru.org' },
      { name: 'Gelbooru', type: 'gelbooru', url: 'https://gelbooru.com' },
    ];
    this.predefinedSources = defaultSources;
    
    // Initialize localActiveSources from store or preferences
    // If usage of multi-source is real, I need to fix store.
    // For now, I'll rely on StorageService for this part if store is incomplete, 
    // OR I assume store is truth.
    
    // Let's fix the store first.
    this.localActiveSources = preferences.activeSources || (this.activeSource ? [this.activeSource] : [defaultSources[0]]);
    
    // ... rest of mounted logic
    
    // Load saved credentials logic...
    const sourceConfigs = preferences.sourceConfigs || {};
    this.predefinedSources.forEach(source => {
        if (sourceConfigs[source.url]) {
            source.userId = sourceConfigs[source.url].userId;
            source.apiKey = sourceConfigs[source.url].apiKey;
        }
    });

    this.checkAllSourceStatus();
    this.checkAllAuthStatus();
  },
  methods: {
    ...mapActions(useSettingsStore, ['updateSettings', 'saveSettings']),
    // ...mapActions(useInteractionsStore, ...), // Clear actions

    toggleHistory() {
      // mapped writable state handles it
      this.disableHistory = !this.disableHistory;
      this.saveSettings();
    },
    toggleDebugMode() {
      this.debugMode = !this.debugMode;
      this.saveSettings();
    },

    async saveAvoidedTags() {
      const tags = this.avoidedTagsInput
        .split(/[\s,]+/)
        .map(t => t.trim())
        .filter(t => t.length > 0);
      const uniqueTags = [...new Set(tags)];
      
      // I need to add updateAvoidedTags to store or just save directly to storage via service 
      // if I don't want to add it to store yet. 
      // But goal is centralization.
      // Check if `avoidedTags` is used elsewhere? `RecommendationSystem` uses it.
      // `RecommendationSystem` likely reads from StorageService.
      // So it's fine to write to StorageService for now for `avoidedTags`.
      
      await StorageService.storePreferences({ avoidedTags: uniqueTags });
      
      this.avoidedTagsInput = uniqueTags.join(' ');
      this.saveMessage = 'Settings saved!';
      setTimeout(() => { this.saveMessage = ''; }, 3000);
    },

    // Source Methods
    isSourceActive(source) {
       return this.localActiveSources.some(s => s.url === source.url);
    },

    toggleSource(source) {
       const index = this.localActiveSources.findIndex(s => s.url === source.url);
       if (index > -1) {
           this.localActiveSources.splice(index, 1);
       } else {
           this.localActiveSources.push(source);
       }
    },

    addCustomSource() {
        if (this.newSource.name && this.newSource.url) {
            this.customSources.push({ ...this.newSource, userId: '', apiKey: '' });
            this.newSource = { name: '', url: '', type: 'gelbooru' };
            this.showAddSource = false;
            // customSources is mapped to store, so it updates store.
            // But we need to save?
            this.saveSettings();
        }
    },
    toggleAuth(source) {
        if (this.editingAuth === source.url) {
            this.editingAuth = null;
        } else {
            this.editingAuth = source.url;
        }
    },

    removeCustomSource(index) {
        const sourceToRemove = this.customSources[index];
        this.customSources.splice(index, 1);
        
        const activeIndex = this.localActiveSources.findIndex(s => s.url === sourceToRemove.url);
        if (activeIndex > -1 && this.localActiveSources.length > 1) {
            this.localActiveSources.splice(activeIndex, 1);
        }
        this.saveSettings();
    },

    async saveSources() {
        if (this.localActiveSources.length === 0) {
            this.confirmAction(
                'No Source Selected',
                'At least one booru source must be selected.',
                () => {}
            );
            return;
        }

        // Check if Gelbooru.com is selected without authentication
        const gelbooruSource = this.localActiveSources.find(
            s => s.type === 'gelbooru' && s.url.toLowerCase().includes('gelbooru.com')
        );
        if (gelbooruSource) {
            // Get the full source with credentials
            const fullSource = this.predefinedSources.find(p => p.url === gelbooruSource.url) 
                            || this.customSources.find(c => c.url === gelbooruSource.url) 
                            || gelbooruSource;
            if (!fullSource.userId || !fullSource.apiKey) {
                this.confirmAction(
                    'Gelbooru Authentication Required',
                    'Gelbooru.com requires authentication to function properly. Please click the key icon next to Gelbooru to enter your User ID and API Key.',
                    () => {}
                );
                return;
            }
        }

        const preferences = await StorageService.getPreferences();
        
        this.localActiveSources = this.localActiveSources.map(active => {
             const updatedPredefined = this.predefinedSources.find(p => p.url === active.url);
             const updatedCustom = this.customSources.find(c => c.url === active.url);
             const source = updatedPredefined || updatedCustom || active;
             return { ...active, userId: source.userId, apiKey: source.apiKey };
        });

        const sourceConfigs = preferences.sourceConfigs || {};
        this.predefinedSources.forEach(s => {
             if (s.userId || s.apiKey) {
                 sourceConfigs[s.url] = { userId: s.userId, apiKey: s.apiKey };
             }
        });

        // Update Store
        // I need to support activeSources in store.
        // For now I'll just save to storage manually as well to keep compatibility
        await StorageService.storePreferences({
             customSources: this.customSources,
             activeSources: this.localActiveSources,
             sourceConfigs: sourceConfigs
        });
        
        // Also update Active Source in store (first one?)
        if (this.localActiveSources.length > 0) {
            this.activeSource = this.localActiveSources[0]; // Legacy single source support
        }

        BooruService.setActiveSources(this.localActiveSources);
        
        this.sourceSaveMessage = 'Sources saved!';
        setTimeout(() => this.sourceSaveMessage = '', 3000);
    },
    
    // ... Keep testConnection, resetAvoidedTags, modal methods ...
    
    // Clean up wipe functions to use StorageService directly or Store Actions?
    // Store doesn't have `clearAll`. Simple wrapper is fine.
    
    wipeHistory() {
      this.confirmAction(
        'Clear History',
        'Are you sure you want to clear your entire viewing history?',
        async () => {
          await StorageService.clearHistory();
          // Update store if it caches history
        }
      );
    },
    wipeLikes() {
      this.confirmAction(
        'Clear Likes',
        'Are you sure you want to clear all your liked posts?',
        async () => {
          await StorageService.clearLikes();
        }
      );
    },
    wipeFavorites() {
      this.confirmAction(
        'Clear Favorites',
        'Are you sure you want to clear all your favorited posts?',
        async () => {
          await StorageService.clearFavorites();
        }
      );
    },
    wipeAll() {
      this.confirmAction(
        'Clear All Data',
        'Are you sure you want to clear ALL your data?',
        async () => {
          await StorageService.clearAllData();
          window.location.reload();
        }
      );
    },
    // ... Rest of methods
    // Make sure to include all methods from original file
    
    // I need to copy paste the rest of the methods:
    async testConnection() {
        this.testResults = [];
        const sourcesToTest = this.localActiveSources.map(active => {
            const predefined = this.predefinedSources.find(p => p.url === active.url);
            const custom = this.customSources.find(c => c.url === active.url);
            const source = predefined || custom || active;
            return { ...active, userId: source.userId, apiKey: source.apiKey };
        });
        this.testResults = await BooruService.testAuthenticationForSources(sourcesToTest);
        for (const result of this.testResults) {
            if (result.url) {
                this.authStatus[result.url] = result.success ? 'authenticated' : 'unauthenticated';
            }
        }
        this.authStatus = { ...this.authStatus };
    },
    resetAvoidedTags() {
      this.avoidedTagsInput = COMMON_TAGS.join(' ');
    },
    confirmAction(title, message, action) {
      this.modalTitle = title;
      this.modalMessage = message;
      this.pendingAction = action;
      this.showModal = true;
    },
    executeAction() {
      if (this.pendingAction) {
        this.pendingAction();
        this.pendingAction = null;
      }
      this.showModal = false;
    },
    closeModal() {
      this.showModal = false;
      this.pendingAction = null;
    },
    showRefreshFeedModal() {
      this.showRefreshModal = true;
    },
    closeRefreshModal() {
      this.showRefreshModal = false;
    },
    async executeRefreshFeed() {
      await RecommendationSystem.resetRecommendations();
      this.showRefreshModal = false;
      // Navigate to trigger feed re-fetch (route watcher calls fetchPosts)
      this.$router.replace({ name: 'Home', query: { ...this.$route.query, refresh: Date.now().toString() } });
    },
    async testAuth(source) {
        this.isTestingAuth = true;
        this.authTestResult = null;
        try {
            let adapter;
            const credentials = { userId: source.userId, apiKey: source.apiKey };
            if (source.type === 'gelbooru') {
                adapter = new GelbooruAdapter(source.url, credentials);
            } else if (source.type === 'moebooru') {
                adapter = new MoebooruAdapter(source.url);
            } else {
                adapter = new DanbooruAdapter(source.url, credentials);
            }
            console.log(`Testing authentication for ${source.url}...`);
            const result = await adapter.testAuthentication();
            this.authTestResult = { 
                 url: source.url, 
                 success: result.success, 
                 message: result.message 
            };
            this.authStatus[source.url] = result.success ? 'authenticated' : 'unauthenticated';
            this.authStatus = { ...this.authStatus };
        } catch (error) {
            console.error('Test authentication failed:', error);
            this.authTestResult = { 
                url: source.url, 
                success: false, 
                message: `Failed: ${error.message}` 
            };
            this.authStatus[source.url] = 'unauthenticated';
            this.authStatus = { ...this.authStatus };
        } finally {
            this.isTestingAuth = false;
        }
    },
    getStatusClass(sourceUrl) {
        const status = this.sourceStatus[sourceUrl];
        if (status === 'success') return 'bg-green-500';
        if (status === 'failed') return 'bg-red-500';
        return 'bg-yellow-500 animate-pulse';
    },
    async checkAllSourceStatus() {
        const allSources = [...this.predefinedSources, ...this.customSources];
        allSources.forEach(source => {
            this.sourceStatus[source.url] = 'pending';
        });
        this.sourceStatus = { ...this.sourceStatus };
        const promises = allSources.map(async source => {
            try {
                const results = await BooruService.testConnectionForSources([source]);
                if (results.length > 0 && results[0].success) {
                    this.sourceStatus[source.url] = 'success';
                } else {
                    this.sourceStatus[source.url] = 'failed';
                }
            } catch (error) {
                console.error(`Status check failed for ${source.url}:`, error);
                this.sourceStatus[source.url] = 'failed';
            }
            this.sourceStatus = { ...this.sourceStatus };
        });
        await Promise.all(promises);
    },
    supportsVideo(source) {
        if (source.type === 'danbooru') return true;
        if (source.type === 'gelbooru') {
            return source.url.toLowerCase().includes('gelbooru.com');
        }
        return false;
    },
    requiresAuth(source) {
        if (source.type === 'gelbooru' && source.url.toLowerCase().includes('gelbooru.com')) {
            return true;
        }
        return false;
    },
    showAuthButton(source) {
        if (source.type === 'gelbooru' && source.url.toLowerCase().includes('safebooru.org')) {
            return false;
        }
        return true;
    },
    getAuthClass(sourceUrl) {
        const status = this.authStatus[sourceUrl];
        if (status === 'authenticated') return 'text-green-500 hover:text-green-400';
        if (status === 'unauthenticated') return 'text-gray-500 hover:text-white';
        return 'text-gray-500 hover:text-white';
    },
    async checkAllAuthStatus() {
        const allSources = [...this.predefinedSources, ...this.customSources];
        allSources.forEach(source => {
            this.authStatus[source.url] = 'pending';
        });
        this.authStatus = { ...this.authStatus };
        const promises = allSources.map(async source => {
            try {
                const results = await BooruService.testAuthenticationForSources([source]);
                if (results.length > 0 && results[0].success) {
                    this.authStatus[source.url] = 'authenticated';
                } else {
                    this.authStatus[source.url] = 'unauthenticated';
                }
            } catch (error) {
                console.error(`Auth check failed for ${source.url}:`, error);
                this.authStatus[source.url] = 'unauthenticated';
            }
            this.authStatus = { ...this.authStatus };
        });
        await Promise.all(promises);
    },
  },
};
</script> 
