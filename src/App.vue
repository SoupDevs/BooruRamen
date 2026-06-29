<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 DottsGit

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div class="min-h-screen bg-black text-white">
    <div class="h-screen relative overflow-hidden">
    
      <!-- Post details sidebar -->
      <PostDetailsSidebar :show="showPostDetails" :post="currentPost" />
      
      <button 
        v-if="currentPost"
        @click="togglePostDetails" 
        class="absolute left-0 z-30 p-2 rounded-r-md bg-black hover:bg-gray-900 transition-all duration-300 ease-in-out"
        :style="{ 
          transform: showPostDetails ? 'translateX(320px)' : 'translateX(0)',
          top: `calc(1rem + env(safe-area-inset-top, 0))`
        }"
      >
        <span class="text-xl font-bold">{{ showPostDetails ? '<<' : '>>' }}</span>
      </button>
      
      <div class="h-full w-full relative overflow-hidden"
        :style="routerViewContainerStyle"
      >
        <router-view
          :key="routerViewKey"
          :commentsSheetHeight="commentsSheetHeight"
          @current-post-changed="updateCurrentPost"
          @video-state-change="handleVideoStateChange"
        ></router-view>
        
        <!-- Debug Overlay -->
        <div v-if="debugMode && currentPost" class="absolute top-0 left-1/2 transform -translate-x-1/2 p-4 bg-black bg-opacity-75 text-xs text-white z-40 max-w-xs font-mono rounded shadow-lg pointer-events-auto"
          style="margin-top: calc(1rem + env(safe-area-inset-top, 0)); max-height: 80vh; overflow-y: auto;"
        >
          <h3 class="font-bold mb-1 text-pink-400">Recommendation Debug</h3>
          
          <div class="mb-2 border-b border-gray-700 pb-2">
            
            <!-- Show Actual Query (from adapter) if available, otherwise fallback -->
            <div v-if="currentPost._actualQuery" class="mt-1">
              <p class="text-gray-400 text-xs tracking-wide">Query:</p>
              <p class="text-xs break-words font-mono text-cyan-300 bg-gray-900 p-1 rounded mt-0.5">{{ currentPost._actualQuery }}</p>
            </div>
            <div v-else-if="currentPost._debugMetadata?.apiQuery || currentPost._searchCriteria" class="mt-1">
              <p class="text-gray-400 text-xs uppercase tracking-wide">Internal Query:</p>
              <p class="text-xs break-all font-mono text-gray-300 bg-gray-900 p-1 rounded mt-0.5">{{ currentPost._debugMetadata?.apiQuery || currentPost._searchCriteria }}</p>
            </div>
            <p><span class="text-gray-400">Strategy:</span> {{ currentPost._strategy || 'Default' }}</p>
            <div v-if="currentPost._debugMetadata?.clientFilters && currentPost._debugMetadata?.clientFilters !== 'None'">
               <p><span class="text-red-400">Filters:</span> {{ currentPost._debugMetadata.clientFilters }}</p>
            </div>
          </div>

          <div v-if="debugDetails">
            <!-- Primary Score -->
            <p v-if="debugDetails.mlScore !== null && debugDetails.mlScore !== undefined">
              <span class="text-pink-400 font-bold">ML Score:</span> {{ debugDetails.mlScore?.toFixed(3) }}
              <span class="text-gray-500 text-xs">(conf: {{ ((debugDetails.mlConfidence || 0) * 100).toFixed(0) }}%)</span>
            </p>
            <p v-else>
              <span class="text-pink-400 font-bold">Score:</span> {{ debugDetails.totalScore?.toFixed(3) }}
            </p>

            <!-- ML Feature Breakdown -->
            <div v-if="debugDetails.mlFeatures" class="mt-2 border-t border-gray-700 pt-1">
              <p class="text-pink-300 text-xs font-semibold mb-1">ML Features:</p>
              <p class="text-xs">
                <span class="text-gray-400">Embedding Similarity:</span>
                <span :class="debugDetails.mlFeatures.embeddingSimilarity > 0 ? 'text-green-400' : 'text-red-400'">
                  {{ debugDetails.mlFeatures.embeddingSimilarity?.toFixed(3) }}
                </span>
              </p>
              <p class="text-xs">
                <span class="text-gray-400">Tag Overlap:</span>
                {{ (debugDetails.mlFeatures.tagOverlapRatio * 100).toFixed(0) }}%
              </p>
              <p class="text-xs">
                <span class="text-gray-400">User Interest Strength:</span>
                {{ debugDetails.mlFeatures.userEmbeddingStrength?.toFixed(3) }}
              </p>
              <p class="text-xs">
                <span class="text-gray-400">Post Embedding Strength:</span>
                {{ debugDetails.mlFeatures.postEmbeddingStrength?.toFixed(3) }}
              </p>
              <p class="text-xs">
                <span class="text-gray-400">Tag Count:</span>
                {{ debugDetails.mlFeatures.tagCount }}
                <span v-if="debugDetails.mlFeatures.isVideo" class="text-blue-400 ml-1">video</span>
              </p>
            </div>

            <!-- ML Top Contributing Tags -->
            <div v-if="debugDetails.mlTagContributions && debugDetails.mlTagContributions.length > 0" class="mt-2 border-t border-gray-700 pt-1">
              <p class="text-pink-300 text-xs font-semibold mb-1">Top ML Tag Contributions:</p>
              <ul class="list-none pl-0 mt-0.5 space-y-0.5">
                <li v-for="tag in debugDetails.mlTagContributions" :key="tag.tag" class="flex justify-between text-xs">
                  <span class="truncate pr-2" :class="tag.direction === 'positive' ? 'text-green-400' : 'text-red-400'">{{ tag.tag }}</span>
                  <span :class="tag.direction === 'positive' ? 'text-green-400' : 'text-red-400'">
                    {{ tag.direction === 'positive' ? '+' : '-' }}{{ tag.delta.toFixed(4) }}
                  </span>
                </li>
              </ul>
            </div>

            <!-- User Tag Affinities (what user likes that match this post) -->
            <div v-if="debugDetails.contributingTags && debugDetails.contributingTags.length > 0" class="mt-2 border-t border-gray-700 pt-1">
              <p class="text-gray-300 text-xs font-semibold mb-1">Your Tag Affinities:</p>
              <ul class="list-none pl-0 mt-0.5 space-y-0.5">
                <li v-for="tag in debugDetails.contributingTags" :key="tag.tag" class="flex justify-between text-xs">
                  <span class="truncate pr-2" :class="tag.score > 0 ? 'text-green-400' : 'text-red-400'">{{ tag.tag }}</span>
                  <span>{{ tag.score.toFixed(3) }}</span>
                </li>
              </ul>
            </div>
          </div>
          <div v-else>
             <p class="italic text-gray-500">Calculating score details...</p>
          </div>
        </div>
      </div>
        
      <!-- Custom Video Controls -->
      <div 
        v-if="isCurrentPostVideo && currentPost" 
        class="fixed left-0 right-0 bg-black bg-opacity-60 backdrop-blur-sm py-2 px-4 flex items-center gap-4 transition-opacity duration-300 z-40"
        :class="{ 'opacity-0': !showVideoControls && !isVideoControlsHovered, 'opacity-100': showVideoControls || isVideoControlsHovered }"
        :style="{ bottom: `calc(3.5rem + env(safe-area-inset-bottom, 0))` }"
        @mouseenter="isVideoControlsHovered = true"
        @mouseleave="isVideoControlsHovered = false"
      >
        <button @click="togglePlayPause" class="text-white p-2 w-8 h-8 flex items-center justify-center">
          <svg v-if="isPlaying" viewBox="0 0 24 24" class="w-6 h-6 fill-white">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
          <svg v-else viewBox="0 0 24 24" class="w-6 h-6 fill-white">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
        
        <!-- Progress bar - Updated with drag functionality -->
        <div class="flex-grow relative h-2 bg-gray-700 rounded cursor-pointer" 
          @click="seekVideo"
          @mousedown="startProgressDrag"
          ref="progressBar">
          <div 
            class="absolute top-0 left-0 h-full bg-pink-600 rounded transition-[width]" 
            :class="{ 'transition-none': isProgressDragging }"
            :style="{ width: `${videoProgress}%` }"
          ></div>
        </div>
        
        <!-- Volume control section - Modified for better hover behavior -->
        <div class="flex items-center group relative">
          <!-- Improved hover area for volume slider -->
          <div 
            class="hidden absolute bottom-full w-8 h-28 group-hover:block cursor-pointer"
            style="left: 50%; transform: translateX(-50%);"
            @mouseenter="isVolumeSliderHovered = true"
            @mouseleave="isVolumeSliderHovered = false"
          >
            <!-- Vertical volume slider - positioned above the mute button -->
            <div 
              class="absolute bottom-2 left-1/2 transform -translate-x-1/2 h-24 w-2 bg-gray-700 rounded cursor-pointer"
              :class="{ 'hidden': !isVolumeSliderHovered && !isVolumeHovered }"
              @mousedown.stop="startVolumeChange"
              @click.stop="changeVolumeVertical"
              ref="volumeSlider"
            >
              <div 
                class="absolute bottom-0 left-0 w-full bg-pink-600 rounded" 
                :style="{ height: `${volumeLevel * 100}%` }"
              ></div>
            </div>
          </div>
          
          <!-- Mute button with improved hover behavior -->
          <button 
            @click.stop="toggleMute" 
            @mouseenter="isVolumeHovered = true"
            @mouseleave="isVolumeHovered = false"
            class="text-white p-2 w-8 h-8 flex items-center justify-center"
          >
            <svg v-if="isMuted || volumeLevel === 0" viewBox="0 0 24 24" class="w-6 h-6 fill-white">
              <path d="M12 4L6 10H2v4h4l6 6z" />
              <line x1="18" y1="6" x2="6" y2="18" stroke="white" stroke-width="2" />
            </svg>
            <svg v-else-if="volumeLevel < 0.5" viewBox="0 0 24 24" class="w-6 h-6 fill-white">
              <path d="M12 4L6 10H2v4h4l6 6z" />
              <path d="M15 12c0-1.7-1-3-2-3.5" stroke="white" stroke-width="2" fill="none" />
            </svg>
            <svg v-else viewBox="0 0 24 24" class="w-6 h-6 fill-white">
              <path d="M12 4L6 10H2v4h4l6 6z" />
              <path d="M15 12c0-1.7-1-3-2-3.5" stroke="white" stroke-width="2" fill="none" />
              <path d="M18 8c1 1.5 1.5 3 1.5 4s-.5 2.5-1.5 4" stroke="white" stroke-width="2" fill="none" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Settings sidebar -->
      <SettingsSidebar :show="showSettingsSidebar" @apply-settings="applySettings" @save-player-preferences="savePlayerPreferences" />
      
      <!-- Floating toggle button for settings sidebar -->
      <button
        v-if="showSettingsToggle"
        @click="showSettingsSidebar = !showSettingsSidebar"
        class="absolute right-0 z-30 p-2 rounded-l-md bg-black hover:bg-gray-900 transition-all duration-300 ease-in-out"
        :style="{
          transform: showSettingsSidebar ? 'translateX(-320px)' : 'translateX(0)',
          top: `calc(1rem + env(safe-area-inset-top, 0))`
        }"
      >
        <Settings class="h-6 w-6" />
      </button>
      
      <!-- Floating post action buttons - repositioned to appear below sidebar but above content -->
      <div 
        class="fixed right-4 flex flex-col items-center gap-4 z-15" 
        :style="{ bottom: `calc(6.5rem + env(safe-area-inset-bottom, 0))` }"
        v-if="currentPost"
      >
        <button 
          @click="toggleLike(currentPost)"
          class="p-3 rounded-full bg-black bg-opacity-70 hover:bg-pink-600 transition-colors backdrop-blur-sm"
          :class="{ 'bg-pink-600': currentPost.liked }"
        >
          <Heart :fill="currentPost.liked ? 'currentColor' : 'none'" class="h-6 w-6" />
        </button>
        
        <button 
          @click="toggleDislike(currentPost)"
          class="p-3 rounded-full bg-black bg-opacity-70 hover:bg-gray-900 transition-colors backdrop-blur-sm"
          :class="{ 'bg-gray-700': currentPost.disliked }"
        >
          <ThumbsDown :fill="currentPost.disliked ? 'currentColor' : 'none'" class="h-6 w-6" />
        </button>
        
        <button
          @click="toggleFavorite(currentPost)"
          class="p-3 rounded-full bg-black bg-opacity-70 hover:bg-yellow-600 transition-colors backdrop-blur-sm"
          :class="{ 'bg-yellow-600': currentPost.favorited }"
        >
          <Star :fill="currentPost.favorited ? 'currentColor' : 'none'" class="h-6 w-6" />
        </button>

        <button
          @click="openComments(currentPost)"
          class="p-3 rounded-full bg-black bg-opacity-70 hover:bg-blue-600 transition-colors backdrop-blur-sm"
        >
          <MessageCircle class="h-6 w-6" />
        </button>
      </div>

      <!-- Comments Sheet -->
      <CommentsSheet
        v-if="commentsPost"
        :post="commentsPost"
        @close="commentsPost = null; commentsSheetHeight = 0"
        @height-change="commentsSheetHeight = $event"
      />
    </div>
    <BottomNavBar @navigate-feed="navigateToFeed" />
  </div>
</template>

<script>
import { X, Settings, Heart, ThumbsDown, Star, MessageCircle } from 'lucide-vue-next';
import { mapState, mapWritableState, mapActions } from 'pinia';
import { useSettingsStore } from './stores/settings';
import { usePlayerStore } from './stores/player';
import { useInteractionsStore } from './stores/interactions';
import StorageService from './services/StorageService.js';
import BooruService from './services/BooruService.js';
import recommendationSystem from './services/RecommendationSystem.js';

import BottomNavBar from './components/BottomNavBar.vue';
import CommentsSheet from './components/CommentsSheet.vue';
import PostDetailsSidebar from './components/PostDetailsSidebar.vue';
import SettingsSidebar from './components/SettingsSidebar.vue';

export default {
  name: 'App',
  components: {
    X,
    Settings,
    Heart,
    ThumbsDown,
    Star,
    MessageCircle,
    BottomNavBar,
    CommentsSheet,
    PostDetailsSidebar,
    SettingsSidebar,
  },
  data() {
    return {
      currentPost: null,
      currentVideoElement: null,
      showPostDetails: false,
      linkCopied: false,
      showSettingsSidebar: false,
      newWhitelistTag: '',
      newBlacklistTag: '',

      // Comments sheet state
      commentsPost: null,
      commentsSheetHeight: 0,

      routerViewKey: 0,
      
      // UI state for controls
      showVideoControls: true,
      isVideoControlsHovered: false,
      isProgressDragging: false,
      videoProgress: 0, // Keep progress local as it is high frequency
      isVolumeSliderHovered: false,
      isVolumeHovered: false,
      isVolumeDragging: false,
      sliderRect: null,
      lastVideoPropUpdate: 0,
      
      // Time tracking
      watchStartTime: null,
      accumulatedWatchTime: 0,
      
      // Sidebar filter state
      recommendationSystem,
      
      debugDetails: null, // Store for calculated debug info
    };
  },
  watch: {
    currentPost(newPost) {
      if (!newPost) {
        this.showPostDetails = false;
        this.debugDetails = null;
      } else if (this.debugMode) {
          this.updateDebugDetails();
      }

      // Update comments if the comments sheet is open
      if (this.commentsPost && newPost && newPost.id !== this.commentsPost.id) {
        this.commentsPost = newPost;
      }
    },
    debugMode(newVal) {
        if (newVal && this.currentPost) {
            this.updateDebugDetails();
        }
    },
    $route(to, from) {
      // Hide post details and video controls when leaving the viewer
      if (to.name !== 'Viewer') {
        if (this.currentPost) {
            this.saveWatchTime(this.currentPost);
        }
        this.currentPost = null;
        this.currentVideoElement = null;
        this.watchStartTime = null;
        this.accumulatedWatchTime = 0;
      }
      // Collapse settings sidebar when navigating to profile pages
      const hiddenRoutes = ['Profile', 'ProfileSettings', 'ProfileAnalytics'];
      if (hiddenRoutes.includes(to.name) && this.showSettingsSidebar) {
        this.showSettingsSidebar = false;
      }
    },
    showSettingsSidebar(isOpen) {
      if (!isOpen) return;
      const hiddenRoutes = ['Profile', 'ProfileSettings', 'ProfileAnalytics'];
      if (hiddenRoutes.includes(this.$route.name)) {
        this.showSettingsSidebar = false;
      }
    },
  },

  computed: {
    // Computed style for router-view container that adjusts for comments sheet
    routerViewContainerStyle() {
      return {
        paddingTop: 'env(safe-area-inset-top, 0)',
        paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0))',
        '--comments-sheet-height': `${this.commentsSheetHeight}px`
      };
    },
    // Map settings store state
    ...mapWritableState(useSettingsStore, [
      'autoScroll',
      'autoScrollSeconds',
      'autoScrollWaitForVideo',
      'autoScrollSpeed',
      'disableScrollAnimation',
      'disableHistory',
      'autoplayVideos',
      'loopVideos',
      'mediaType',
      'ratings',
      'whitelistTags',
      'blacklistTags',
      'activeSource',
      'customSources',
      'debugMode',
      'enabledRatings'
    ]),
    // Map player store state
    ...mapWritableState(usePlayerStore, [
      'volume',
      'muted',
      'isPlaying',
      'defaultMuted'
    ]),
    
    // Alias to match template usage
    volumeLevel: {
      get() { return this.volume },
      set(val) { this.volume = val }
    },
    isMuted: {
      get() { return this.muted },
      set(val) { this.muted = val }
    },

    isCurrentPostVideo() {
      if (!this.currentPost) return false;
      const ext = this.currentPost.file_ext;
      return ['mp4', 'webm'].includes(ext);
    },
    showSettingsToggle() {
      // Only show settings on feed, history, likes, favorites, and viewer
      const routeName = this.$route.name;
      return !['Profile', 'ProfileSettings', 'ProfileAnalytics'].includes(routeName);
    },
  },
  methods: {
    // Map store actions
    ...mapActions(useSettingsStore, {
        toggleRatingAction: 'toggleRating',
        addWhitelistTagAction: 'addWhitelistTag',
        removeWhitelistTag: 'removeWhitelistTag',
        addBlacklistTagAction: 'addBlacklistTag',
        removeBlacklistTag: 'removeBlacklistTag', 
        saveSettings: 'saveSettings',
        initializeSettings: 'initialize'
    }),
    ...mapActions(usePlayerStore, {
        setPlayerVolume: 'setVolume',
        setPlayerMuted: 'setMuted',
        setPlayerPlaying: 'setPlaying',
        initializePlayer: 'initialize',
        savePlayerPreferences: 'savePreferences'
    }),
    ...mapActions(useInteractionsStore, {
        logInteraction: 'logInteraction',
        initializeInteractions: 'initialize'
    }),

    navigateToFeed() {
      if (this.$route.name === 'Home' && JSON.stringify(this.$route.query) === JSON.stringify(this.generateQueryFromSettings())) {
        return;
      }
      this.$router.push({ name: 'Home', query: this.generateQueryFromSettings() });
    },
    async updateCurrentPost(post, videoEl) {
      if (this.currentPost) {
          this.saveWatchTime(this.currentPost);
      }
      
      this.watchStartTime = null;
      this.accumulatedWatchTime = 0;
      this.startWatchTimeTracking();

      this.currentPost = post;
      this.currentVideoElement = videoEl;

      if (post) {
        // Reset state immediately to prevent "sticking" buttons from previous post
        // Only if they aren't already set (to avoid flickering if we revisit a loaded post)
        if (post.liked === undefined) post.liked = false;
        if (post.disliked === undefined) post.disliked = false;
        if (post.favorited === undefined) post.favorited = false;

        // Async fetch - will update reactivity when done
        StorageService.getPostInteractions(post.id).then(interactions => {
             // Verify we are still looking at the same post to avoid race conditions
             if (this.currentPost && this.currentPost.id === post.id) {
                 this.currentPost.liked = interactions.some(i => i.type === 'like' && i.value > 0);
                 this.currentPost.disliked = interactions.some(i => i.type === 'dislike' && i.value > 0);
                 this.currentPost.favorited = interactions.some(i => i.type === 'favorite' && i.value > 0);
             } else {
                 // Even if we moved away, update the post object so it's cached correctly for next time
                 post.liked = interactions.some(i => i.type === 'like' && i.value > 0);
                 post.disliked = interactions.some(i => i.type === 'dislike' && i.value > 0);
                 post.favorited = interactions.some(i => i.type === 'favorite' && i.value > 0);
             }
        });
      }

      if (videoEl) {
        videoEl.volume = this.volume;
        // Respect defaultMuted setting: if ON, always mute new videos; if OFF, inherit current muted state
        const shouldMute = this.defaultMuted ? true : this.muted;
        videoEl.muted = shouldMute;
        // Sync store state so mute icon matches
        if (shouldMute !== this.muted) {
          this.muted = shouldMute;
        }
      }
      
      if (this.debugMode && post) {
          this.updateDebugDetails();
      }
    },

    async updateDebugDetails() {
        if (!this.currentPost) return;
        try {
          const details = await this.recommendationSystem.getPostScoreDetails(this.currentPost);
          this.debugDetails = details;
        } catch (e) {
          console.error('[DebugOverlay] Failed to get score details:', e);
          this.debugDetails = { error: e.message, totalScore: 0 };
        }
    },
    

    startWatchTimeTracking() {
        this.watchStartTime = Date.now();
    },

    saveWatchTime(post) {
        let totalTime = this.accumulatedWatchTime;
        if (this.watchStartTime) {
            totalTime += (Date.now() - this.watchStartTime);
        }
        
        if (totalTime > 1000) {
            this.logInteraction({
                postId: post.id,
                type: 'timeSpent',
                value: totalTime,
                metadata: { post }
            });
        }
    },
    getRatingFromCode(rating) {
      const ratingMap = { 'g': 'General', 's': 'Sensitive', 'q': 'Questionable', 'e': 'Explicit' };
      return ratingMap[rating] || 'Unknown';
    },
    formatFileSize(bytes) {
      if (!bytes || bytes === 0) return 'Unknown';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },
    getSourceName(sourceUrl) {
      if (!sourceUrl) return 'Unknown';
      const sourceMap = {
        'https://danbooru.donmai.us': 'Danbooru',
        'https://safebooru.org': 'Safebooru',
        'https://gelbooru.com': 'Gelbooru',
        'https://konachan.com': 'Konachan',
        'https://yande.re': 'Yande.re',
      };
      if (sourceMap[sourceUrl]) return sourceMap[sourceUrl];
      for (const [url, name] of Object.entries(sourceMap)) {
        if (sourceUrl.includes(url.replace('https://', ''))) return name;
      }
      try {
        const url = new URL(sourceUrl);
        return url.hostname;
      } catch {
        return sourceUrl;
      }
    },
    copyPostLink(post) {
        const url = post.post_url || `https://danbooru.donmai.us/posts/${post.id}`;
        navigator.clipboard.writeText(url).then(() => {
            this.linkCopied = true;
            setTimeout(() => {
                this.linkCopied = false;
            }, 1500);
        });
    },
    togglePostDetails() {
      this.showPostDetails = !this.showPostDetails;
    },
    
    toggleLike(post) {
        if (!post) return;
        post.liked = !post.liked;
        if (post.liked) post.disliked = false;
        
        this.logInteraction({
            postId: post.id,
            type: 'like',
            value: post.liked ? 1 : 0,
            metadata: { post }
        });
        if (post.liked) {
             this.logInteraction({
                postId: post.id,
                type: 'dislike',
                value: 0,
                metadata: { post }
            });
        }
    },
    toggleDislike(post) {
        if (!post) return;
        post.disliked = !post.disliked;
        if (post.disliked) post.liked = false;
        
        this.logInteraction({
            postId: post.id,
            type: 'dislike',
            value: post.disliked ? 1 : 0,
            metadata: { post }
        });
        if (post.disliked) {
             this.logInteraction({
                postId: post.id,
                type: 'like',
                value: 0,
                metadata: { post }
            });
        }
    },
    toggleFavorite(post) {
        if (!post) return;
        post.favorited = !post.favorited;

        this.logInteraction({
            postId: post.id,
            type: 'favorite',
            value: post.favorited ? 1 : 0,
            metadata: { post }
        });
    },

    openComments(post) {
        if (!post) return;
        this.commentsPost = post;
    },

    toggleRating(rating) {
        this.toggleRatingAction(rating);
    },
    addWhitelistTag() {
      this.addWhitelistTagAction(this.newWhitelistTag);
      this.newWhitelistTag = '';
    },
    addBlacklistTag() {
      this.addBlacklistTagAction(this.newBlacklistTag);
      this.newBlacklistTag = '';
    },

    applySettings() {
      this.saveSettings();
      // Refresh current view with new settings instead of always redirecting to feed
      const currentName = this.$route.name;
      const settingsAwareRoutes = ['Home', 'History', 'Likes', 'Favorites'];

      if (settingsAwareRoutes.includes(currentName)) {
        // For feed/history/likes/favorites: update query to trigger refetch
        const query = this.generateQueryFromSettings();
        // Only navigate if query actually changed (avoids redundant navigation)
        if (JSON.stringify(this.$route.query) !== JSON.stringify(query)) {
          this.$router.replace({ name: currentName, query });
        }
      }
      // For other routes (Viewer, etc.), just stay put - no navigation needed

      // Emit event so child views can react to settings change
      this.$routerViewKeyBump();
      this.showSettingsSidebar = false;
    },
    $routerViewKeyBump() {
      // Increment key to force re-render of current view if needed
      this.routerViewKey++;
    },

    generateQueryFromSettings() {
      const query = {
        ratings: this.ratings.join(','),
        images: this.mediaType.images ? '1' : '0',
        videos: this.mediaType.videos ? '1' : '0',
        whitelist: this.whitelistTags.join(','),
        blacklist: this.blacklistTags.join(',')
      };
      return query;
    },

    syncSettingsFromQuery(query) {
      if (query.ratings) this.ratings = query.ratings.split(',');
      if (query.images !== undefined) this.mediaType.images = query.images !== '0';
      if (query.videos !== undefined) this.mediaType.videos = query.videos !== '0';
      if (query.whitelist) this.whitelistTags = query.whitelist.split(',');
      if (query.blacklist) this.blacklistTags = query.blacklist.split(',');
    },
    
    // Video Controls
    togglePlayPause() {
        if (this.currentVideoElement) {
            if (this.currentVideoElement.paused) {
                this.currentVideoElement.play();
                this.isPlaying = true;
            } else {
                this.currentVideoElement.pause();
                this.isPlaying = false;
            }
        }
    },
    handleVideoStateChange(state) {
        // Update local state from event, relying on store writable computing to update store via setters
        if (state.isPlaying !== undefined) this.isPlaying = state.isPlaying;
        if (state.progress !== undefined) this.videoProgress = state.progress;
        // Ignore volume/muted changes during drag to prevent race condition
        if (!this.isVolumeDragging) {
            if (state.volume !== undefined) this.volume = state.volume;
            if (state.muted !== undefined) this.muted = state.muted;
        }
    },
    seekVideo(e) {
        if (!this.currentVideoElement) return;
        const rect = e.target.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;
        const percentage = x / width;
        const time = percentage * this.currentVideoElement.duration;
        this.currentVideoElement.currentTime = time;
        this.videoProgress = percentage * 100;
    },
    startProgressDrag(e) {
        this.isProgressDragging = true;
        document.addEventListener('mousemove', this.handleProgressDrag);
        document.addEventListener('mouseup', this.stopProgressDrag);
    },
    handleProgressDrag(e) {
        if (!this.isProgressDragging || !this.$refs.progressBar) return;
        const rect = this.$refs.progressBar.getBoundingClientRect();
        let x = e.clientX - rect.left;
        x = Math.max(0, Math.min(x, rect.width));
        const percentage = x / rect.width;
        this.videoProgress = percentage * 100;
        if (this.currentVideoElement) {
             const time = percentage * this.currentVideoElement.duration;
             this.currentVideoElement.currentTime = time;
        }
    },
    stopProgressDrag() {
        this.isProgressDragging = false;
        document.removeEventListener('mousemove', this.handleProgressDrag);
        document.removeEventListener('mouseup', this.stopProgressDrag);
    },
    
    // Volume
    startVolumeChange(e) {
        this.isVolumeDragging = true;
        this.sliderRect = this.$refs.volumeSlider.getBoundingClientRect();
        document.addEventListener('mousemove', this.handleVolumeDrag);
        document.addEventListener('mouseup', this.stopVolumeDrag);
        this.handleVolumeDrag(e);
    },
    handleVolumeDrag(e) {
        if (!this.isVolumeDragging || !this.sliderRect) return;
        
        const bottom = this.sliderRect.bottom;
        const height = this.sliderRect.height;
        let y = bottom - e.clientY;
        y = Math.max(0, Math.min(y, height));
        
        const newVol = y / height;
        this.volume = newVol; // Update store
        
        if (this.currentVideoElement) {
            this.currentVideoElement.volume = newVol;
            if (newVol > 0 && this.muted) {
                this.currentVideoElement.muted = false;
                this.muted = false; // Sync store state with video
            }
        }
    },
    stopVolumeDrag() {
         this.isVolumeDragging = false;
         document.removeEventListener('mousemove', this.handleVolumeDrag);
         document.removeEventListener('mouseup', this.stopVolumeDrag);
         this.savePlayerPreferences(); // Save volume to player store
    },
    changeVolumeVertical(e) {
        // Use ref instead of e.target to avoid getting wrong bounds when clicking on the fill div
        const rect = this.$refs.volumeSlider.getBoundingClientRect();
        const bottom = rect.bottom;
        const height = rect.height;
        let y = bottom - e.clientY;
        y = Math.max(0, Math.min(y, height));
        this.volume = y / height;
        
        if (this.currentVideoElement) {
            this.currentVideoElement.volume = this.volume;
            if (this.volume > 0 && this.muted) {
                this.currentVideoElement.muted = false;
                this.muted = false; // Sync store state with video
            }
        }
        this.savePlayerPreferences(); // Save volume to player store
    },
    toggleMute() {
        this.muted = !this.muted; // Update store
        if (this.currentVideoElement) {
            this.currentVideoElement.muted = this.muted;
        }
        this.savePlayerPreferences(); // Save mute state to player store
    },


    
    handleKeydown(e) {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlayPause();
      } else if (e.code === 'ArrowRight') {
        if (this.currentVideoElement) {
            this.currentVideoElement.currentTime += 5;
        }
      } else if (e.code === 'ArrowLeft') {
        if (this.currentVideoElement) {
            this.currentVideoElement.currentTime -= 5;
        }
      }
    }
  },
  async created() {
      await this.initializeSettings();
      this.initializePlayer();
      this.initializeInteractions();
      
      if (Object.keys(this.$route.query).length > 0) {
          this.syncSettingsFromQuery(this.$route.query);
      }
      
      window.addEventListener('keydown', this.handleKeydown);
  },
  beforeUnmount() {
      window.removeEventListener('keydown', this.handleKeydown);
  }
}
</script>

<style>
/* Add these rules to hide scrollbars while maintaining functionality */
* {
  -ms-overflow-style: none;  /* IE and Edge */
  scrollbar-width: none;  /* Firefox */
}

*::-webkit-scrollbar {
  display: none;  /* Chrome, Safari and Opera */
}

/* Remove the existing scrollbar styles */
::-webkit-scrollbar,
::-webkit-scrollbar-track,
::-webkit-scrollbar-thumb,
::-webkit-scrollbar-thumb:hover {
  display: none;
  width: 0;
  background: transparent;
}

/* Keep the backdrop-blur-sm style */
.backdrop-blur-sm {
  background-color: rgba(0, 0, 0, 0.5) !important;
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

@keyframes fadeOut {
  0% { opacity: 1; }
  70% { opacity: 1; }
  100% { opacity: 0; }
}

/* Add a subtle animation for the action buttons */
@keyframes fadeIn {
  0% { opacity: 0; transform: translateY(10px); }
  100% { opacity: 1; transform: translateY(0); }
}

/* Apply the animation to the fixed buttons */
.fixed.flex.flex-col button {
  animation: fadeIn 0.3s ease-out forwards;
}

/* Stagger the animations for each button */
.fixed.flex.flex-col button:nth-child(1) {
  animation-delay: 0s;
}
.fixed.flex.flex-col button:nth-child(2) {
  animation-delay: 0.1s;
}
.fixed.flex.flex-col button:nth-child(3) {
  animation-delay: 0.2s;
}

/* Add a box-shadow to the buttons to make them stand out against any background */
.fixed.flex.flex-col button {
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

/* Video controls styling */
.video-progress {
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  overflow: hidden;
  cursor: pointer;
}

.video-progress-filled {
  background: #EC4899;
  height: 100%;
}

/* Add a shadow above the video controls for better visibility */
.fixed.bottom-0 {
  box-shadow: 0 -4px 6px rgba(0, 0, 0, 0.1);
}

/* Add more refined video control styling */
.fixed.bottom-0 {
  box-shadow: 0 -4px 6px rgba(0, 0, 0, 0.1);
}

/* Add hover effects for video control buttons */
.fixed.bottom-0 button {
  transition: transform 0.2s ease;
  border-radius: 50%;
}

.fixed.bottom-0 button:hover {
  transform: scale(1.15);
  background-color: rgba(255, 255, 255, 0.1);
}

/* Improved progress bar appearance */
.flex-grow.relative.h-2 {
  height: 4px;
  overflow: hidden;
  transition: height 0.2s ease;
}

.flex-grow.relative.h-2:hover {
  height: 6px;
}

/* Volume control styling */
.group:hover .hidden.group-hover\:block {
  display: block;
}

/* Improved progress and volume bars */
.flex-grow.relative.h-2,
.group-hover\:block.w-24.h-2 {
  height: 4px;
  overflow: hidden;
  transition: height 0.2s ease;
}

.flex-grow.relative.h-2:hover,
.group-hover\:block.w-24.h-2:hover {
  height: 6px;
}

/* Make volume slider handle more visible when dragging */
.group-hover\:block.w-24.h-2 {
  position: relative;
  height: 4px;
  overflow: visible;
  transition: height 0.2s ease;
}

.group-hover\:block.w-24.h-2:hover,
.group-hover\:block.w-24.h-2:active {
  height: 6px;
}

/* Change volume slider drag handle to appear at current position */
.group-hover\:block.w-24.h-2 .bg-pink-600::after {
  content: '';
  position: absolute;
  right: 0;
  top: 50%;
  transform: translate(50%, -50%);
  width: 12px;
  height: 12px;
  background-color: #EC4899;
  border-radius: 50%;
  box-shadow: 0 0 4px rgba(0,0,0,0.5);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.group-hover\:block.w-24.h-2:hover .bg-pink-600::after {
  opacity: 1;
}

.group-hover\:block.w-24.h-2:active .bg-pink-600::after {
  opacity: 1;
}

/* Remove the old right-edge-only handle style */
.group-hover\:block.w-24.h-2:active::after {
  content: none;
}

/* Prevent text selection during volume dragging */
.user-select-none {
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
}
</style>
