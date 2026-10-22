<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div class="w-full relative overflow-hidden" :style="feedContainerStyle">
    <!-- Post feed -->
    <div class="h-full overflow-y-auto snap-y snap-mandatory" ref="feedContainer" :style="containerStyle">
      <div v-if="loading" class="h-full flex items-center justify-center">
        <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-pink-600"></div>
      </div>

      <div v-else-if="posts.length === 0" class="h-full flex items-center justify-center">
        <div class="text-center">
          <p class="text-xl">No posts found</p>
          <p class="text-gray-400 mt-2">Try adjusting your filters</p>
        </div>
      </div>

      <!-- Top spacer for virtual scrolling -->
      <div v-if="visibleStartIndex > 0" class="w-full shrink-0 pointer-events-none" :style="[{ height: topSpacerHeight }, spacerTransitionStyle]"></div>

      <div
        v-for="post in visiblePosts"
        :key="getCompositeKey(post)"
        class="w-full snap-start snap-always flex justify-center relative shrink-0 select-none"
        :class="commentsSheetHeight > 0 ? 'items-end' : 'items-center'"
        :style="[postContainerStyle, { touchAction: 'pan-y pinch-zoom' }]"
        @click="onMediaTap(post, $event)"
        @pointerdown="onMediaPointerDown(post, $event)"
        @pointermove="onMediaPointerMove($event)"
        @pointerup="onMediaPointerUp($event)"
        @pointercancel="onMediaPointerCancel()"
        @dragstart.prevent="blockRowDrag"
        v-observe-visibility
      >
        <!-- Why a discovery pick is here: a quiet pill centred at the top, level
             with the sidebar tabs and clear of them. Fades on its own and
             never takes a tap. -->
        <transition name="why-chip">
          <div
            v-if="whyChip && showWhyChips && !focusMode && whyChip.key === getCompositeKey(post)"
            class="why-chip absolute left-1/2 -translate-x-1/2 z-10 truncate pointer-events-none rounded-full bg-black/35 text-white/90 text-[11px] font-medium leading-5 px-3 backdrop-blur-sm ring-1 ring-white/10"
            role="status"
            data-why-chip
          >{{ whyChip.text }}</div>
        </transition>
        <!-- Post media -->
        <div class="relative h-full max-w-full flex items-center justify-center">
          <!-- Feedback for the interaction that was just logged -->
          <PostActionBurst
            v-if="mediaBurst(post)"
            :key="mediaBurst(post).id"
            :type="mediaBurst(post).type"
          />
          <ProgressiveImage
            v-if="['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(getFileExtension(post))"
            :src="post.file_url"
            :preview-src="post.preview_file_url || ''"
            :sample-src="post.sample_file_url || post.large_file_url || ''"
            :alt="post.tags || 'Post image'"
            :load-sample="imagePreloadTier(post).loadSample"
            :load-full="imagePreloadTier(post).loadFull"
            class="max-w-full max-h-full object-contain"
            @error="(e) => console.error('Image load error:', post.file_url, e)"
            @load="onImageLoaded(post)"
          />
          <!-- No poster and no autoplay: offscreen videos buffer (preload="auto") but never
               play — the IntersectionObserver starts playback from 0 when a post enters view.
               A paused <video> is NEVER visible: Android's webview draws its own overlay
               play-glyph on paused videos (#148), so until playback starts we show a canvas
               holding the decoded first frame instead — pixel-identical, seamless swap. -->
          <template v-else-if="isVideoPost(post)">
            <video
              :src="getVideoSrc(post)"
              :ref="(el) => setVideoRef(el, post)"
              :loop="loopVideos && !(autoScroll && autoScrollWaitForVideo)"
              playsinline
              muted
              class="max-w-full max-h-full"
              :class="{ 'opacity-0': !videoActiveStates[getCompositeKey(post)] }"
              :preload="videoPreloadAttr(post)"
              @loadeddata="onVideoLoadedData($event, post)"
              @play="onVideoPlay($event, post)"
              @pause="onVideoPause($event, post)"
              @timeupdate="onVideoTimeUpdate($event, post)"
              @volumechange="onVideoVolumeChange($event, post)"
              @loadstart="onVideoLoadStart(post)"
              @waiting="onVideoWaiting(post)"
              @playing="onVideoPlaying(post)"
              @canplay="onVideoCanPlay(post)"
              @error="onVideoError(post)"
            ></video>
            <!-- First-frame stand-in while the video is not actively playing.
                 pointer-events-none so taps fall through to the video underneath. -->
            <canvas
              v-show="!videoActiveStates[getCompositeKey(post)]"
              :ref="(el) => setCanvasRef(el, post)"
              class="absolute inset-0 m-auto max-w-full max-h-full pointer-events-none"
            ></canvas>
            <!-- Playback glyph on a mildly transparent grey disc: the icon
                 pops in/out, the disc just fades (styles below). -->
            <div
              v-if="pauseOverlayState[getCompositeKey(post)]"
              data-pause-overlay
              :class="pauseOverlayState[getCompositeKey(post)] === 'paused'
                ? 'pause-pop--in'
                : 'pause-pop--out'"
              class="absolute inset-0 z-10 flex items-center justify-center pointer-events-none"
            >
              <span class="pause-pop__disc">
                <Pause
                  v-if="pauseOverlayState[getCompositeKey(post)] === 'paused'"
                  :size="88"
                  fill="currentColor"
                  :stroke-width="0"
                  class="pause-pop__glyph text-white"
                />
                <Play
                  v-else
                  :size="88"
                  fill="currentColor"
                  :stroke-width="0"
                  class="pause-pop__glyph text-white"
                />
              </span>
            </div>
          </template>
          <!-- Custom Loading Spinner -->
          <div 
            v-if="videoLoadingStates[getCompositeKey(post)]" 
            class="absolute inset-0 flex items-center justify-center bg-black bg-opacity-20 pointer-events-none"
          >
            <div class="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-pink-600"></div>
          </div>
        </div>
      </div>
      
      <!-- Bottom spacer for virtual scrolling -->
      <div v-if="bottomSpacerHeight !== '0px'" class="w-full shrink-0 pointer-events-none" :style="[{ height: bottomSpacerHeight }, spacerTransitionStyle]"></div>
      
      <!-- Keep the same full-height scroll target when loading finishes without results. -->
      <div v-if="!loading && posts.length > 0 && (isFetching || !hasMorePosts)" class="h-full w-full snap-start snap-always flex items-center justify-center relative px-6 text-center" role="status">
         <div v-if="isFetching" class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-pink-600"></div>
         <div v-else>
           <p class="text-xl text-pink-500 font-bold mb-2">{{ deepDiveState.active ? 'No more similar posts found' : 'No more posts found' }}</p>
           <p class="text-gray-400">{{ deepDiveState.active ? 'Try a Deep Dive from another post, expand your search filters, or end Deep Dive to return to your usual feed.' : 'No more posts match your search requirements. Expand your search to find more content.' }}</p>
         </div>
      </div>
    </div>
  </div>
</template>

<script>
import { mapState } from 'pinia';
import { useSettingsStore } from '../stores/settings';
import { usePlayerStore } from '../stores/player';
import { useInteractionsStore } from '../stores/interactions';
import BooruService from '../services/BooruService';
import StorageService from '../services/StorageService';
import ReportService from '../services/ReportService';
import recommendationSystem, { deepDiveState } from '../services/RecommendationSystem';
import { getPlayableVideoUrl, revokeBlobUrl } from '../services/videoProxy.js';
import {
  drawFirstFrameNow,
  primeNeighbouringFrames,
  VIDEO_FRAME_RUNWAY_AHEAD,
  VIDEO_FRAME_RUNWAY_BEHIND
} from '../services/videoFramePriming.js';
import ProgressiveImage from '../components/ProgressiveImage.vue';
import PostActionBurst from '../components/PostActionBurst.vue';
import { Pause, Play } from 'lucide-vue-next';
import { postGestureMixin } from '../mixins/postGestureMixin';
import { postKey } from '../services/postKey';
import tagSuggestion from '../services/TagSuggestionService';
import imageAnalysis from '../services/ImageAnalysisService.js';
import { contentKeys, excludeDuplicateContent } from '../services/contentIdentity.js';
import { shortcutFor } from '../services/keyboardShortcuts.js';
import RunwayCache from '../services/RunwayCache.js';
import { SESSION_IDLE_MS } from '../services/SessionInterest.js';
import { whyChipText, WHY_CHIP_MS } from '../services/WhyChip.js';

// How long the play glyph lingers while popping out after an unpause: the
// 380ms pop-out plus a margin before the element is dropped.
const PAUSE_GLYPH_FADE_MS = 550;
// How long a scrolled-back-to post must stay on screen to count as a revisit.
const REVISIT_DWELL_MS = 2000;

export default {
  name: 'FeedView',
  mixins: [postGestureMixin],
  components: {
    ProgressiveImage,
    PostActionBurst,
    Pause,
    Play,
  },
  props: {
    commentsSheetHeight: {
      type: Number,
      default: 0
    }
  },
  data() {
    return {
      posts: [],
      // { key, text } of the "why this post" chip on screen
      whyChip: null,
      loading: true,
      page: 1,
      currentPostIndex: 0,
      currentPostKey: null,
      tags: 'rating:general',
      sort: 'score',
      sortOrder: 'desc',
      isFetching: false,
      lastPostY: 0,
      observer: null,
      videoBlobUrls: {}, // Map of original URL -> blob URL for Tauri production
      // Local tracking for video elements to interactions
      videoElements: {}, 
      hasMorePosts: true,
      isProgrammaticVolumeChange: false, // Flag to ignore volumechange events during programmatic updates
      isResizing: false, // Flag to suspend scroll tracking during CSS animation
      videoLoadingStates: {}, // Map of composite key -> loading boolean
      videoActiveStates: {}, // Map of composite key -> true while video is actively playing in view (video visible, first-frame canvas hidden)
      pauseOverlayState: {}, // Map of composite key -> 'paused' | 'resuming' | null (playback glyph over the video)
      videoErrorStates: {}, // Map of composite key -> error boolean (CDN blocked)
      videoLoadingTimeouts: {}, // Non-reactive timers for debouncing spinner
      isAutoScrolling: false, // Flag to distinguish auto-scroll from manual scroll
      hasUserScrolled: false, // Flag to detect if user has scrolled (for autoplay logic)
      accumulatedWheelDelta: 0, // Track wheel scroll for snap-on-scroll
      wheelSnapThreshold: 100, // Pixels of scroll before snapping to next post
      clearWheelDeltaTimeout: null, // Debounce timer for resetting wheel delta
      initializedVideos: new Set(), // Track videos that have already started playback to prevent restart
      unsubscribeImageAnalysis: null,
      unsubscribeSession: null,
      unsubscribeMode: null,
      deepDiveState,
      feedDisposed: false,
      // A new search requested while a fetch was running; it runs once that
      // fetch returns. The generation retires the running fetch's results.
      pendingNewSearch: false,
      searchGeneration: 0,
      sessionRankTimer: null,
      historyContentKeys: new Set(),
    }
  },
  directives: {
    observeVisibility: {
      mounted(el, binding, vnode) {
        // Small timeout to ensure DOM is ready and component context is available
        setTimeout(() => {
          // In Vue 3, context is not directly on vnode, we access component instance via binding.instance
          const vm = binding.instance;
          if (vm && vm.observer) {
            vm.observer.observe(el);
          }
        }, 0);
      },
      beforeUnmount(el, binding, vnode) {
        const vm = binding.instance;
        if (vm && vm.observer) {
          vm.observer.unobserve(el);
        }
        
        // Cleanup: forcefully pause any video when it unmounts from virtual DOM 
        // preventing off-screen playing.
        const video = el.querySelector('video');
        if (video) {
          video.pause();
          video.muted = true;
        }
      }
    }
  },
  computed: {
    // Post -> position in this.posts. The template asks for every rendered
    // post's position on each render, and indexOf made that quadratic.
    postIndexes() {
      return new Map(this.posts.map((post, index) => [post, index]));
    },
    ...mapState(useSettingsStore, ['autoScroll', 'autoScrollSeconds', 'autoScrollWaitForVideo', 'disableScrollAnimation', 'autoplayVideos', 'loopVideos', 'debugMode', 'whitelistTags', 'blacklistTags', 'mediaType', 'aiTaggingEnabled', 'showWhyChips', 'focusMode', 'avoidedTags']),
    ...mapState(usePlayerStore, ['volume', 'muted', 'defaultMuted']),

    // Container style that adjusts height for comments sheet
    feedContainerStyle() {
      return {
        height: this.commentsSheetHeight > 0
          ? `calc(100% - ${this.commentsSheetHeight}px)`
          : '100%',
        transition: 'height 0.35s cubic-bezier(0.32, 0.72, 0, 1)'
      };
    },

    // Post container style - each post must be EXACTLY the scroll container's height.
    // Using 100% (not a 100vh calc) keeps scroll-snap positions at exact multiples of
    // clientHeight, which the index math in determineCurrentPost/_onWheel relies on.
    // A viewport-based height drifts from clientHeight (nav bar + safe-area insets),
    // desyncing currentPostIndex from the visible post after enough scrolling.
    postContainerStyle() {
      return {
        height: '100%'
      };
    },
    spacerTransitionStyle() {
      return {
        transition: this.isResizing ? 'height 0.35s cubic-bezier(0.32, 0.72, 0, 1)' : 'none'
      };
    },
    containerStyle() {
      if (this.disableScrollAnimation) {
        return 'scroll-snap-stop: always; overscroll-behavior-y: contain';
      }
      return '';
    },
    // Alias to match template if needed, or just updated template to use 'muted'
    // The template uses 'isMuted' prop, so we alias it or change template.
    // Let's alias it for minimal template changes.
    isMuted() {
        return this.muted;
    },

    // --- Virtual Scrolling Computed Properties ---
    // Asymmetric window: scrolling down is the dominant direction, so keep more
    // buffered runway ahead (rendered videos preload="auto" but never play offscreen).
    // Deep enough that the next page of posts usually arrives before the user
    // walks off the current one — the list-end spinner stays unseen.
    visibleStartIndex() {
      return Math.max(0, this.currentPostIndex - 2);
    },
    visibleEndIndex() {
      return Math.min(this.posts.length - 1, this.currentPostIndex + 7);
    },
    visiblePosts() {
      if (!this.posts.length) return [];
      return this.posts.slice(this.visibleStartIndex, this.visibleEndIndex + 1);
    },
    topSpacerHeight() {
      if (this.visibleStartIndex === 0) return '0px';
      // Percentages resolve against the scroll container's height, so spacers stay
      // exactly N posts tall and scroll positions remain multiples of clientHeight.
      return `calc(100% * ${this.visibleStartIndex})`;
    },
    bottomSpacerHeight() {
      const remainingPosts = Math.max(0, this.posts.length - 1 - this.visibleEndIndex);
      if (remainingPosts === 0) return '0px';
      return `calc(100% * ${remainingPosts})`;
    },
    lastScrollIndex() {
      return this.posts.length - 1 + (this.posts.length > 0 && (this.isFetching || !this.hasMorePosts) ? 1 : 0);
    }
  },
  // beforeUpdate removed to prevent clearing refs and causing infinite loops/resetting state
  async created() {
    this.videoElements = {}; // Non-reactive to prevent infinite render loops
    this.videoCanvases = {}; // Non-reactive: first-frame canvas elements by composite key
    this.recommendationSystem = recommendationSystem;
    // Posts whose "why this post" chip has been shown: once per post.
    this.whyChipShown = new Set();
    // The first search after mounting may start from the runway saved by the
    // previous launch (or the last visit to the feed).
    this.runwayRestoreTried = false;
    // Initialize recommendation system (async)
    await this.recommendationSystem.initialize();
  },
  methods: {
    onRecommendationModeChanged() {
      if (this.feedDisposed) return;
      clearTimeout(this.sessionRankTimer);
      // Preserve the current post and all rows behind it; replace the runway
      // with candidates fetched for the new mode.
      this.posts = this.posts.slice(0, Math.max(0, this.currentPostIndex + 1));
      this.hasMorePosts = true;
      this.page = 1;
      this.fetchPosts();
    },
    scheduleSessionRanking() {
      clearTimeout(this.sessionRankTimer);
      this.sessionRankTimer = setTimeout(async () => {
        await this.insertRecoveryPick();
        // Keep the visible row, scroll history and the preloaded runway
        // fixed: swapping a post whose media is already buffering would
        // waste the download and show a spinner. Discard a ranking result if
        // navigation or a background fetch changed the queue.
        const posts = this.posts, index = this.currentPostIndex;
        const start = Math.max(0, index + 1 + VIDEO_FRAME_RUNWAY_AHEAD);
        if (posts.length - start < 2) return;
        try {
          const ranked = await this.recommendationSystem.rankPosts(posts.slice(start), posts.slice(Math.max(0, start - 5), start));
          if (this.posts !== posts || this.currentPostIndex !== index) return;
          this.posts = [...posts.slice(0, start), ...ranked];
          this.analyzeUpcomingImages();
        } catch (error) { console.warn('[Feed] Session ranking unavailable:', error.message); }
      }, 150);
    },
    /**
     * After a run of skips the worker hands back a strong pick it held in
     * reserve; it goes straight after the current post. The buffered runway
     * only moves back one slot.
     */
    async insertRecoveryPick() {
      if (deepDiveState.active || this.feedDisposed) return;
      const posts = this.posts, index = this.currentPostIndex;
      try {
        const pick = await this.recommendationSystem.takeRecoveryPick(posts.map(post => this.getCompositeKey(post)));
        if (!pick || this.posts !== posts || this.currentPostIndex !== index) return;
        const seen = new Set([...(this._historyKeys || []), ...posts.flatMap(post => [this.getCompositeKey(post), ...contentKeys(post)])]);
        // Reports made since the pick was set aside still apply.
        const allowed = excludeDuplicateContent(ReportService.filterPosts([pick], await ReportService.getBlockSets()), seen);
        if (!allowed.length || this.posts !== posts || this.currentPostIndex !== index) return;
        this.posts = [...posts.slice(0, index + 1), pick, ...posts.slice(index + 1)];
      } catch (error) { console.warn('[Feed] Recovery pick unavailable:', error.message); }
    },
    onFeedVisibility() {
      if (document.hidden) {
        this.hiddenAt = Date.now();
        return;
      }
      const away = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
      this.hiddenAt = null;
      if (away >= SESSION_IDLE_MS) this.reopenSession();
    },
    /**
     * Back after a long pause: a new session. Re-rank the queue ahead so it
     * opens with the most confident picks instead of whatever was next when
     * the app was left (an exploration slot, a stale streak).
     */
    async reopenSession() {
      if (deepDiveState.active || this.feedDisposed) return;
      clearTimeout(this.sessionRankTimer);
      const posts = this.posts, index = this.currentPostIndex, start = index + 1;
      if (posts.length - start < 2) return;
      try {
        const ranked = await this.recommendationSystem.rankPosts(posts.slice(start), posts.slice(Math.max(0, start - 5), start), { opener: true });
        if (this.posts !== posts || this.currentPostIndex !== index) return;
        this.posts = [...posts.slice(0, start), ...ranked];
        this.analyzeUpcomingImages();
      } catch (error) { console.warn('[Feed] Session re-rank unavailable:', error.message); }
    },
    onImageLoaded(post) {
      imageAnalysis.enqueue([post], true);
    },
    analyzeUpcomingImages() {
      imageAnalysis.enqueue(this.posts.slice(Math.max(0, this.currentPostIndex), this.currentPostIndex + 8));
    },
    onImageAnalysisReady() {
      // Only remove duplicates ahead of the user; keep the visible post and
      // previous scroll positions stable when a background hash completes.
      const end = Math.max(0, this.currentPostIndex + 1);
      const seen = new Set([...this.historyContentKeys, ...this.posts.slice(0, end).flatMap(contentKeys)]);
      const remaining = excludeDuplicateContent(this.posts.slice(end), seen);
      if (remaining.length !== this.posts.length - end) this.posts = [...this.posts.slice(0, end), ...remaining];
    },
    getCompositeKey(post) {
      return postKey(post);
    },
    // Swiping must never turn into a native image drag: Chrome fires
    // pointercancel when a drag starts, which would kill the gesture
    // mid-swipe. Preventing dragstart keeps the pointer stream intact.
    blockRowDrag() {},
    getVideoSrc(post) {
      if (!post || !post.file_url) return '';
      // Use blob URL if available (set by processVideoUrls via getPlayableVideoUrl)
      return this.videoBlobUrls[post.file_url] || post.file_url;
    },
    async processVideoUrls(posts) {
      // Pre-fetch video URLs as blobs for Tauri production
      for (const post of posts) {
        if (this.isVideoPost(post) && post.file_url) {
           // If we already have a blob, skip (avoid redundant work)
           if (this.videoBlobUrls[post.file_url]) continue;

           // Check if video is already playing fine with original URL
           const key = this.getCompositeKey(post);
           const videoEl = this.videoElements[key];
           // If video is active (playing or buffered enough), don't swap and cause a restart
           if (videoEl && (videoEl.currentTime > 0 || videoEl.readyState >= 3)) {
               // console.log('[FeedView] Video already playing, skipping proxy swap:', post.id);
               continue;
           }

          try {
            const blobUrl = await getPlayableVideoUrl(post.file_url);
            if (blobUrl !== post.file_url) {
              // Final check before applying (in case it started playing ASYNC while we fetched)
              if (videoEl && (videoEl.currentTime > 0 || videoEl.readyState >= 3)) {
                 continue;
              }
              this.videoBlobUrls[post.file_url] = blobUrl;
            }
          } catch (e) {
            // Silently fall back to original URL
          }
        }
      }
    },
    async fetchPosts(newSearch = false) {
      if (this.feedDisposed) return;
      if (this.isFetching) {
        // A new search (whitelist tag tapped, post reported, filters changed)
        // must not be lost to a background prefetch: retire the running
        // fetch and start the search as soon as it returns.
        // A repeat of the search already running (mount and the route
        // watcher both start the first one) is not a new search.
        if (newSearch && this.runningSearchQuery !== JSON.stringify(this.$route.query)) {
          this.pendingNewSearch = true;
          this.searchGeneration++;
        }
        return;
      }
      this.runningSearchQuery = newSearch ? JSON.stringify(this.$route.query) : null;
      const modeGeneration = deepDiveState.generation;
      const searchGeneration = this.searchGeneration;
      const superseded = () => this.feedDisposed || modeGeneration !== deepDiveState.generation || searchGeneration !== this.searchGeneration;
      this.isFetching = true;
      try {
        // Settings load asynchronously at app startup; the first fetch must wait for
        // them or it runs against defaults and ignores the saved media filter (#150)
        await useSettingsStore().initialize();
        if (newSearch || this.posts.length === 0) {
          this.loading = true;
        }

        // Get view history to exclude seen posts
        // View history only grows by the posts this feed shows (which are in
        // this.posts), so it is read once per search instead of on every fetch:
        // a long history made each runway refill slower.
        if (newSearch || !this._historyKeys) {
          const viewedHistory = await StorageService.getViewedPosts();
          this.historyContentKeys = new Set(Object.values(viewedHistory).flatMap(entry => contentKeys(entry.data)));
          this._historyKeys = new Set([...Object.keys(viewedHistory), ...this.historyContentKeys]);
        }
        // Reported/blocked posts, artists, and uploaders must never enter the feed
        const blockSets = await ReportService.getBlockSets();
        // A newer search was requested during the awaits above
        if (superseded()) return;
        // Create a set of IDs to exclude (viewed history + currently loaded posts + reported posts)
        const blockedKeys = new Set(this._historyKeys);
        for (const p of this.posts) {
          blockedKeys.add(this.getCompositeKey(p));
          contentKeys(p).forEach(key => blockedKeys.add(key));
        }
        blockSets.postKeys.forEach(key => blockedKeys.add(key));

        console.log(`FetchPosts: ${this.posts.length} loaded. Total blocked IDs: ${blockedKeys.size}`);

        if (newSearch) {
          Object.values(this.videoBlobUrls).forEach(revokeBlobUrl);
          this.videoBlobUrls = {};
          this.page = 1;
          this.posts = [];
          this.currentPostIndex = -1;
          this._maxViewedIndex = -1;
          this.currentPostKey = null;
          this.hasUserScrolled = false;
          if (this.$refs.feedContainer) {
            this.$refs.feedContainer.scrollTop = 0;
          }
          this.hasMorePosts = true;
          // Reset recommendation system session (cursors, exhausted list)
          if (this.recommendationSystem) {
            this.recommendationSystem.resetExploreSession();
          }
        }
      
        if (!this.hasMorePosts) return;

        let newPosts = [];

        // Guard: if recommendationSystem not yet initialized (watcher fires before created), skip
        if (!this.recommendationSystem) {
          console.log('Skipping fetch - recommendationSystem not yet initialized');
          return;
        }
        const targetCount = 5;
        let attempts = 0;
        const maxAttempts = 15;
        // Each attempt already walks every strategy and paged fallback, so a
        // few empty attempts in a row mean the search is used up. Without this
        // a narrow whitelist fired ~90 booru requests before giving up.
        const maxEmptyAttempts = 3;
        let emptyAttempts = 0;

        const fetchFunction = (queryParams, limit) => {
          return BooruService.getPosts({ 
            tags: queryParams.tags || '', 
            limit, 
            page: queryParams.page || this.page, 
            sort: this.sort, 
            sortOrder: this.sortOrder,
            skipSort: true
          });
        };

        const { whitelist, blacklist } = this.$route.query;

        const activeWhitelist = whitelist ? whitelist.split(',') : (this.whitelistTags || []);
        const activeBlacklist = blacklist ? blacklist.split(',') : (this.blacklistTags || []);

        // Show the saved runway right away; the fetch below queues fresh
        // posts behind it.
        if (newSearch && !this.runwayRestoreTried && !deepDiveState.active) {
          this.runwayRestoreTried = true;
          const restored = await this.restoreRunway({ blockedKeys, blockSets, whitelist: activeWhitelist, blacklist: activeBlacklist });
          if (superseded()) return;
          if (restored.length) {
            console.log(`Restored ${restored.length} saved posts`);
            this.posts = restored;
            this.loading = false;
            this.analyzeUpcomingImages();
            this.processVideoUrls(restored);
            this.$nextTick(() => {
              if (this.feedDisposed) return;
              this.observePosts();
              this.determineCurrentPost();
            });
          }
        }

        while (newPosts.length < targetCount && attempts < maxAttempts && emptyAttempts < maxEmptyAttempts) {
          attempts++;
          
          const batch = await this.recommendationSystem.getCuratedExploreFeed(fetchFunction, {
            postsPerFetch: 20,
            // Ratings are no longer user-configurable: always query general
            selectedRatings: ['general'],
            whitelist: activeWhitelist,
            blacklist: activeBlacklist,
            existingPostIds: blockedKeys,
            // Diversity carries across batches: what the user just saw.
            contextPosts: [...this.posts, ...newPosts].slice(-5),
            // Fall back to the saved settings (not hardcoded true) so filters apply
            // on first load, before the user ever hits "Apply Settings" (#150)
            wantsImages: 'images' in this.$route.query ? this.$route.query.images === '1' : this.mediaType.images,
            wantsVideos: 'videos' in this.$route.query ? this.$route.query.videos === '1' : this.mediaType.videos,
          });
          if (superseded()) return;
          
          emptyAttempts = batch.length > 0 ? 0 : emptyAttempts + 1;
          if (batch.length > 0) {
            // Drop anything blocked via Report/Block (post, artist, or uploader)
            const allowedBatch = excludeDuplicateContent(ReportService.filterPosts(batch, blockSets), blockedKeys);
            newPosts = [...newPosts, ...allowedBatch];
            batch.forEach(p => blockedKeys.add(this.getCompositeKey(p)));
            batch.forEach(p => contentKeys(p).forEach(key => blockedKeys.add(key)));
          }
        }
        
        if (newPosts && newPosts.length > 0) {
          // Feed every fresh tag into the local autocomplete index: this is
          // what makes the whitelist/blacklist dropdown instant for the tags
          // the enabled sources actually return.
          for (const post of newPosts) {
            tagSuggestion.ingestTags(post.tag_string || post.tags || '', post.source);
          }
          this.posts = [...this.posts, ...newPosts];
          this.analyzeUpcomingImages();
          console.log(`Added ${newPosts.length} new posts. Total: ${this.posts.length}`);
          // Pre-fetch video URLs as blobs for Tauri production (non-blocking)
          this.processVideoUrls(newPosts);
          // Kept current in case the app is killed without being hidden first.
          this.saveRunway();
        } else if (newPosts.length === 0) {
            console.log("No new posts found in batch.");
            this.hasMorePosts = false;
        }
      } catch (error) {
        console.error('Failed to fetch posts:', error);
      } finally {
        this.isFetching = false;
        this.runningSearchQuery = null;
        this.loading = false;
        if (!this.feedDisposed && this.pendingNewSearch) {
          this.pendingNewSearch = false;
          this.fetchPosts(true);
        } else if (!this.feedDisposed && modeGeneration !== deepDiveState.generation) this.onRecommendationModeChanged();
        
        this.$nextTick(() => {
          if (this.feedDisposed) return;
          this.observePosts();
          this.determineCurrentPost();
        });
      }
    },
    /** Identifies the feed a saved runway belongs to. */
    runwayContext() {
      const query = this.$route.query;
      const settings = useSettingsStore();
      return JSON.stringify({
        whitelist: query.whitelist ? query.whitelist.split(',') : (this.whitelistTags || []),
        images: 'images' in query ? query.images === '1' : !!this.mediaType.images,
        videos: 'videos' in query ? query.videos === '1' : !!this.mediaType.videos,
        sources: [settings.activeSource, ...(settings.customSources || [])].filter(Boolean).map(source => [source.type, source.url, source.enabled !== false]),
      });
    },
    /** Save the unseen posts ahead of the current one for the next launch. */
    saveRunway() {
      if (deepDiveState.active || !this.recommendationSystem || !this.posts.length) return;
      RunwayCache.saveRunway(this.runwayContext(), this.posts.slice(Math.max(0, this.currentPostIndex + 1)), this.recommendationSystem.candidatePool);
    },
    onPageHidden(event) {
      if (event.type === 'pagehide' || document.hidden) this.saveRunway();
    },
    /**
     * Take the saved runway and keep only what may still be shown: the same
     * content gate, reports and seen-filtering as a fresh fetch. Its leftover
     * candidates go back into the recommendation pool.
     */
    async restoreRunway({ blockedKeys, blockSets, whitelist, blacklist }) {
      const saved = await RunwayCache.takeRunway(this.runwayContext());
      if (!saved) return [];
      const rs = this.recommendationSystem;
      const allowed = posts => excludeDuplicateContent(
        ReportService.filterPosts(rs.applyClientSideFilters(rs.applyContentFilters(posts, { blacklist, selectedRatings: ['general'] }), { whitelist }), blockSets),
        blockedKeys
      );
      const runway = allowed(saved.runway);
      for (const post of runway) {
        blockedKeys.add(this.getCompositeKey(post));
        contentKeys(post).forEach(key => blockedKeys.add(key));
      }
      rs.restorePool(allowed(saved.pool));
      return runway;
    },
    handleScroll() {
      if (this.isResizing) return;
      this.hasUserScrolled = true;
      this.determineCurrentPost();
      const container = this.$refs.feedContainer;
      // Fetch the next page while the user still has posts in front of them
      // (pre-fetching): waiting until the last post is on screen turns the end
      // of the list into a spinner. Three posts of runway is usually enough
      // for an API round-trip to finish unseen.
      if (this.hasMorePosts && container.scrollTop + container.clientHeight >= container.scrollHeight - container.clientHeight * 4) {
        this.fetchPosts();
      }
    },
    _onWheel(event) {
      if (!this.disableScrollAnimation) return;
      const container = this.$refs.feedContainer;
      if (!container) return;
      const itemHeight = container.clientHeight;
      if (itemHeight === 0) return;
      this.accumulatedWheelDelta += event.deltaY;
      if (this.clearWheelDeltaTimeout) {
        clearTimeout(this.clearWheelDeltaTimeout);
      }
      this.clearWheelDeltaTimeout = setTimeout(() => {
        this.accumulatedWheelDelta = 0;
      }, 200);
      if (Math.abs(this.accumulatedWheelDelta) >= this.wheelSnapThreshold) {
        const direction = this.accumulatedWheelDelta > 0 ? 1 : -1;
        this.accumulatedWheelDelta = 0;
        const nextIndex = this.currentPostIndex + direction;
        if (nextIndex >= 0 && nextIndex <= this.lastScrollIndex) {
          event.preventDefault();
          container.scrollTo({
            top: nextIndex * itemHeight,
            behavior: 'auto'
          });
        }
      }
    },
    async determineCurrentPost() {
      const container = this.$refs.feedContainer;
      if (!container) return;

      // Optimization: Calculate index mathematically since all posts are h-full (100% height).
      // This allows O(1) lookup instead of O(N) loop with getBoundingClientRect + Reflows.
      const itemHeight = container.clientHeight;
      if (itemHeight === 0) return;

      // We use Math.round to find which post is mostly in view
      const calculatedIndex = Math.round(container.scrollTop / itemHeight);
      const currentPost = this.posts[calculatedIndex];
      const currentPostKey = currentPost ? this.getCompositeKey(currentPost) : null;

      // The loading/end row is a scroll target too, but has no post actions.
      if (
        calculatedIndex >= 0 && 
        calculatedIndex <= this.lastScrollIndex &&
        (calculatedIndex !== this.currentPostIndex || currentPostKey !== this.currentPostKey)
      ) {
        this.currentPostIndex = calculatedIndex;
        this.currentPostKey = currentPostKey;
        this.showWhyChip(currentPost);
        // The window moved: make sure the clips about to scroll in are loading.
        this.primeNeighbouringVideos();
        this.analyzeUpcomingImages();
        
        // Scrolling back up to a post and staying on it is one of the
        // strongest implicit signals there is.
        clearTimeout(this._revisitTimer);
        if (currentPost && calculatedIndex < (this._maxViewedIndex ?? -1)) {
          this._revisitTimer = setTimeout(() => {
            if (this.currentPostKey !== currentPostKey || this.feedDisposed) return;
            useInteractionsStore().logInteraction({ postId: currentPost.id, type: 'revisit', value: 1, metadata: { post: currentPost } });
          }, REVISIT_DWELL_MS);
        }
        this._maxViewedIndex = Math.max(this._maxViewedIndex ?? -1, calculatedIndex);

        if (currentPost) {
          const videoEl = this.videoElements[this.getCompositeKey(currentPost)] || null;
          this.$emit('current-post-changed', currentPost, videoEl);
          
          await StorageService.trackPostView(currentPost.id, currentPost, currentPost.source);
        } else {
          this.$emit('current-post-changed', null, null);
        }
      }
    },
    /** Show the post's "why this post" chip for a few seconds, once. */
    showWhyChip(post) {
      clearTimeout(this._whyChipTimer);
      this.whyChip = null;
      if (!post || !this.showWhyChips || this.focusMode || deepDiveState.active) return;
      const key = this.getCompositeKey(post);
      if (this.whyChipShown.has(key)) return;
      const blacklist = this.$route.query.blacklist ? this.$route.query.blacklist.split(',') : (this.blacklistTags || []);
      const text = whyChipText(post, { blacklist, avoided: this.avoidedTags || [] });
      if (!text) return;
      this.whyChipShown.add(key);
      this.whyChip = { key, text };
      this._whyChipTimer = setTimeout(() => { this.whyChip = null; }, WHY_CHIP_MS);
    },
    hideWhyChip() {
      clearTimeout(this._whyChipTimer);
      this.whyChip = null;
    },
    observePosts() {
        if (this.observer) {
            this.observer.disconnect();
        }

        if (!this.$refs.feedContainer) return;

        const postElements = this.$refs.feedContainer.querySelectorAll('.snap-start');
        postElements.forEach(el => this.observer.observe(el));
    },
    setVideoRef(el, post) {
      const key = this.getCompositeKey(post);
      if (el) {
        // Only initialize settings if this is a NEW element for this post
        // This prevents resetting muted=true during re-renders (e.g. volume updates)
        if (!this.videoElements[key] || this.videoElements[key] !== el) {
            this.videoElements[key] = el;
            el._compositeKey = key; // For reverse lookup in the IntersectionObserver
            el.volume = this.volume;
            // If defaultMuted is ON, start muted. If OFF, inherit current mute state.
            // Use muted=true for initial autoplay compliance, IntersectionObserver will set correct state when visible.
            el.muted = true; // Safe default for autoplay
            el.currentTime = 0; // Reset progress to prevent carryover
            // Fresh element hasn't started playback — keep it hidden behind the
            // first-frame canvas so the webview's paused-video glyph can't show (#148)
            if (this.videoActiveStates[key]) this.videoActiveStates[key] = false;
            // ...and drop any playback glyph left over from the previous occupant
            this._hidePauseGlyph(key);
        }
      } else if (this.videoElements[key] && !this.videoElements[key].isConnected) {
        // Post left the virtual window: drop the detached element so lookups
        // never hand a stale <video> to the playback controls
        delete this.videoElements[key];
      }
    },
    setCanvasRef(el, post) {
      const key = this.getCompositeKey(post);
      if (el) {
        this.videoCanvases[key] = el;
      } else if (this.videoCanvases[key] && !this.videoCanvases[key].isConnected) {
        delete this.videoCanvases[key];
      }
    },
    
    getFileExtension(post) {
      if (!post) return '';
      // Adapters normalise file_ext; the URL is only a fallback, and may
      // carry a query string (".jpg?123") or an uppercase extension.
      if (post.file_ext) return String(post.file_ext).toLowerCase();
      if (!post.file_url) return '';
      return post.file_url.split(/[?#]/)[0].split('.').pop().toLowerCase();
    },
    isVideoPost(post) {
      const videoExtensions = ['mp4', 'webm'];
      return videoExtensions.includes(this.getFileExtension(post));
    },
    // Progressive-image tiering: how far ahead of the user a post sits decides
    // which stages request bytes. Near posts get preview + sample + original;
    // mid runway drops the original (the sample carries the favourite
    // decision); far runway shows only the preview. Keeps a moving user
    // buffered without pulling every multi-MB original at once. Clamped
    // behind too: scrolled-past posts keep their sample but never fetch a
    // full original for a back-glance.
    imagePreloadTier(post) {
      const distance = this.postIndexes.get(post) - this.currentPostIndex;
      return {
        loadSample: distance >= -2 && distance <= 4,
        loadFull: distance >= -1 && distance <= 1,
      };
    },
    // Offscreen videos only need metadata + first frame (the stand-in canvas
    // draws from loadeddata, playback starts on visibility). "metadata" keeps
    // the runway from draining bandwidth the upcoming images need; the
    // visible post's video still buffers fully ahead of playback.
    videoPreloadAttr(post) {
      const distance = this.postIndexes.get(post) - this.currentPostIndex;
      const near = distance >= -VIDEO_FRAME_RUNWAY_BEHIND && distance <= VIDEO_FRAME_RUNWAY_AHEAD;
      return near ? 'auto' : 'metadata';
    },
    primeNeighbouringVideos() {
      // The preload attribute is only a hint and phones ignore one set after the
      // element was created, which leaves a clip entering the viewport with no
      // frame to show. Loading the runway explicitly keeps the stand-in canvas
      // painted before the post gets there.
      return primeNeighbouringFrames(
        this.posts,
        this.currentPostIndex,
        (post) => this.videoElements[this.getCompositeKey(post)] || null,
        (post) => !!this.videoActiveStates[this.getCompositeKey(post)]
      );
    },
    // Deferred single tap from the gesture mixin: this view owns the video
    // elements, so playback toggling stays here.
    onMediaSingleTap(event) {
      this.togglePlayPause(event);
    },
    // Deferred single tap on a still image: in focus mode this is the only
    // way to call the chrome back — the 200ms window has already proven it
    // wasn't a double-tap like.
    onMediaImageTap() {
      this.$emit('focus-image-tap');
    },
    togglePlayPause(event) {
        // A swipe or a hold-to-seek just ran on this pointer sequence: the
        // trailing click must not flip playback.
        if (this.isTapSuppressed()) return;
        const video = event.target;
        if (video.paused) {
            video.play();
        } else {
            video.pause();
        }
    },
    onVideoPlay(event, post) {
      // Playback resumed: swap the pause glyph for a play glyph that fades
      // away, regardless of which post the event belongs to.
      this._fadeOutPauseGlyph(this.getCompositeKey(post));
      if (this.posts[this.currentPostIndex] && this.getCompositeKey(this.posts[this.currentPostIndex]) !== this.getCompositeKey(post)) return;

      // Enforce playback rate to prevent accidental speed changes
      const video = event.target;
      if (video.playbackRate !== 1.0) {
          video.playbackRate = 1.0;
      }

      // Mark as initialized so re-intersections don't reset playback
      this.initializedVideos.add(video);

      this.$emit('video-state-change', { isPlaying: true });
    },
    onVideoPause(event, post) {
      // Only a video that actually started playing earns the pause glyph —
      // a fresh element's initial pause (before autoplay) must not flash it.
      if (this.initializedVideos.has(event.target)) {
        this._showPauseGlyph(this.getCompositeKey(post));
      }
      if (this.posts[this.currentPostIndex] && this.getCompositeKey(this.posts[this.currentPostIndex]) !== this.getCompositeKey(post)) return;
      this.$emit('video-state-change', { isPlaying: false });
    },
    // Pop the pause glyph in (cancelling any pending fade-out).
    _showPauseGlyph(key) {
      this._clearPauseFadeTimer(key);
      this.pauseOverlayState[key] = 'paused';
    },
    // Swap the pause glyph for a play glyph, then drop it once the fade ends.
    _fadeOutPauseGlyph(key) {
      if (this.pauseOverlayState[key] !== 'paused') return;
      this._clearPauseFadeTimer(key);
      this.pauseOverlayState[key] = 'resuming';
      this._pauseFadeTimers = this._pauseFadeTimers || {};
      this._pauseFadeTimers[key] = setTimeout(() => {
        if (this.pauseOverlayState[key] === 'resuming') {
          this.pauseOverlayState[key] = null;
        }
        delete this._pauseFadeTimers[key];
      }, PAUSE_GLYPH_FADE_MS);
    },
    _hidePauseGlyph(key) {
      this._clearPauseFadeTimer(key);
      this.pauseOverlayState[key] = null;
    },
    _clearPauseFadeTimer(key) {
      if (this._pauseFadeTimers && this._pauseFadeTimers[key]) {
        clearTimeout(this._pauseFadeTimers[key]);
        delete this._pauseFadeTimers[key];
      }
    },
    onVideoTimeUpdate(event, post) {
      if (this.posts[this.currentPostIndex] && this.getCompositeKey(this.posts[this.currentPostIndex]) !== this.getCompositeKey(post)) return;
      
      const { currentTime, duration } = event.target;
      if (duration > 0) {
        this.$emit('video-state-change', { progress: (currentTime / duration) * 100 });
      }
    },
    onVideoVolumeChange(event, post) {
      // Ignore programmatic volume changes (from IntersectionObserver, drag handlers)
      if (this.isProgrammaticVolumeChange) return;
      
      // Only emit volume changes from the CURRENT video
      // This prevents non-visible videos (muted by IntersectionObserver) from overwriting user preference
      if (this.posts[this.currentPostIndex] && this.getCompositeKey(this.posts[this.currentPostIndex]) !== this.getCompositeKey(post)) return;
      
      const video = event.target;
      const { volume, muted } = video;
      this.$emit('video-state-change', { volume, muted });
    },
    startAutoScroll() {
      this.stopAutoScroll();
      this._setupVideoEndedListener();
      this._startAutoScrollTimer();
    },
    _isCurrentPostVideo() {
      const post = this.posts[this.currentPostIndex];
      if (!post) return false;
      return this.isVideoPost(post);
    },
    _startAutoScrollTimer() {
      if (this.autoScrollInterval) return;
      this.autoScrollInterval = setInterval(() => {
        if (this.autoScrollWaitForVideo && this._isCurrentPostVideo()) return;
        this._doAutoScroll();
      }, this.autoScrollSeconds * 1000);
    },
    _stopAutoScrollTimer() {
      if (this.autoScrollInterval) {
        clearInterval(this.autoScrollInterval);
        this.autoScrollInterval = null;
      }
    },
    // Up/Down (or K/J) move exactly one post, the keyboard twin of a swipe.
    onShortcutKey(event) {
      const action = shortcutFor(event);
      if (action !== 'next' && action !== 'previous') return;
      event.preventDefault();
      this.scrollToPostIndex(this.currentPostIndex + (action === 'next' ? 1 : -1));
    },
    scrollToPostIndex(index) {
      const container = this.$refs.feedContainer;
      if (!container || container.clientHeight === 0) return;
      if (index < 0 || index > this.lastScrollIndex) return;
      container.scrollTo({
        top: index * container.clientHeight,
        behavior: this.disableScrollAnimation ? 'auto' : 'smooth'
      });
    },
    _snapToNearestPost() {
      const container = this.$refs.feedContainer;
      if (!container) return;
      const itemHeight = container.clientHeight;
      if (itemHeight === 0) return;
      const scrolled = container.scrollTop;
      const baseIndex = Math.floor(scrolled / itemHeight);
      const offset = scrolled - (baseIndex * itemHeight);
      // Snap forward if scrolled past 40 of item height, otherwise snap back
      const SNAP_THRESHOLD = 0.4;
      const targetIndex = offset / itemHeight >= SNAP_THRESHOLD ? baseIndex + 1 : baseIndex;
      const clampedIndex = Math.max(0, Math.min(targetIndex, this.lastScrollIndex));
      if (clampedIndex === this.currentPostIndex) return;
      container.scrollTo({
        top: clampedIndex * itemHeight,
        behavior: 'auto'
      });
    },
    _doAutoScroll() {
      this.isAutoScrolling = true;
      const container = this.$refs.feedContainer;
      if (container) {
        const nextScrollTop = container.scrollTop + container.clientHeight;
        container.scrollTo({
          top: nextScrollTop,
          behavior: this.disableScrollAnimation ? 'auto' : 'smooth'
        });
      }
      setTimeout(() => { this.isAutoScrolling = false; }, 100);
    },
    _setupVideoEndedListener() {
      if (!this.$refs.feedContainer) return;
      this.$refs.feedContainer.addEventListener('ended', this._onVideoEnded, true);
    },
    _removeVideoEndedListener() {
      if (!this.$refs.feedContainer) return;
      this.$refs.feedContainer.removeEventListener('ended', this._onVideoEnded, true);
    },
    _onVideoEnded(event) {
      if (!this.autoScroll || !this.autoScrollWaitForVideo) return;
      const currentPost = this.posts[this.currentPostIndex];
      if (!currentPost) return;
      const videoEl = this.videoElements[this.getCompositeKey(currentPost)];
      if (!videoEl || event.target !== videoEl) return;
      this._doAutoScroll();
    },
    stopAutoScroll() {
      this._stopAutoScrollTimer();
      this._removeVideoEndedListener();
    },
    onVideoLoadedData(event, post) {
      // First frame is decoded - capture it into the stand-in canvas so scrolling
      // shows real content instead of the webview's paused-video placeholder (#148).
      //
      // Draw it straight away rather than waiting for a presented frame: the
      // video sits at opacity-0 until it plays, the compositor never presents
      // frames for an invisible element, and a clip entering the viewport was
      // left with an empty canvas over a dark post - the black box users saw on
      // mobile. A presented frame, when one arrives, replaces the first draw.
      drawFirstFrameNow(event.target, this.videoCanvases[this.getCompositeKey(post)]);
    },
    onVideoLoadStart(post) {
      const key = this.getCompositeKey(post);
      // Clear existing timeout
      if (this.videoLoadingTimeouts[key]) {
        clearTimeout(this.videoLoadingTimeouts[key]);
      }
      // Debounce showing spinner: only show if it takes > 400ms
      this.videoLoadingTimeouts[key] = setTimeout(() => {
        this.videoLoadingStates[key] = true;
      }, 400);
    },
    onVideoWaiting(post) {
      const key = this.getCompositeKey(post);
      if (!this.videoLoadingTimeouts[key]) {
        this.videoLoadingTimeouts[key] = setTimeout(() => {
          this.videoLoadingStates[key] = true;
        }, 400);
      }
    },
    onVideoPlaying(post) {
      const key = this.getCompositeKey(post);
      if (this.videoLoadingTimeouts[key]) {
        clearTimeout(this.videoLoadingTimeouts[key]);
        delete this.videoLoadingTimeouts[key];
      }
      this.videoLoadingStates[key] = false;
      // Playback started: reveal the video and hide the first-frame stand-in.
      // The canvas holds frame 0 and playback starts at 0, so the swap is seamless.
      this.videoActiveStates[key] = true;
    },
    onVideoCanPlay(post) {
      const key = this.getCompositeKey(post);
      if (this.videoLoadingTimeouts[key]) {
        clearTimeout(this.videoLoadingTimeouts[key]);
        delete this.videoLoadingTimeouts[key];
      }
      this.videoLoadingStates[key] = false;
    },
    onVideoError(post) {
      const key = this.getCompositeKey(post);
      if (this.videoLoadingTimeouts[key]) {
        clearTimeout(this.videoLoadingTimeouts[key]);
        delete this.videoLoadingTimeouts[key];
      }
      this.videoLoadingStates[key] = false;
      this.videoErrorStates[key] = true;
    },
  },
  mounted() {
    this.unsubscribeImageAnalysis = imageAnalysis.subscribe(this.onImageAnalysisReady);
    this.unsubscribeSession = recommendationSystem.subscribeSession(this.scheduleSessionRanking);
    this.unsubscribeMode = recommendationSystem.subscribeMode(this.onRecommendationModeChanged);
    this.$refs.feedContainer.addEventListener('scroll', this.handleScroll, { passive: true });
    this.$refs.feedContainer.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this.onShortcutKey);
    document.addEventListener('visibilitychange', this.onFeedVisibility);
    document.addEventListener('visibilitychange', this.onPageHidden);
    window.addEventListener('pagehide', this.onPageHidden);
    // The autoScroll watcher runs before the container exists; a feed mounted
    // with autoscroll already on (Apply in settings, back from Profile) needs
    // its video-ended listener attached here or "wait for video" never advances.
    if (this.autoScroll) this._setupVideoEndedListener();

    // Browsers may block autoplay until user interacts with the page.
    // Add a one-time listener to unlock playback on first user gesture.
    this._unlockAutoplay = (event) => {
      // A tap on the media itself is the user's playback control (pause /
      // play): unlocking must not immediately fight it by replaying the
      // video the tap just paused. Disarm without playing — the click still
      // counts as the user activation that unlocks later play() calls.
      const target = event && event.target;
      const onMedia = !!target && (target.tagName === 'VIDEO'
        || (typeof target.closest === 'function' && !!target.closest('video')));
      if (!onMedia) {
        const currentPost = this.posts[this.currentPostIndex];
        if (currentPost) {
          const videoEl = this.videoElements[this.getCompositeKey(currentPost)];
          if (videoEl && videoEl.paused) {
            videoEl.play().catch(() => {});
          }
        }
      }
      document.removeEventListener('click', this._unlockAutoplay);
      document.removeEventListener('touchstart', this._unlockAutoplay);
      this._unlockAutoplay = null;
    };
    document.addEventListener('click', this._unlockAutoplay);
    document.addEventListener('touchstart', this._unlockAutoplay);

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const video = entry.target.querySelector('video');
          
          if (entry.isIntersecting) {
            if (video) {
              // Helper to apply mute preference once video is playing
              const applyMutePreference = () => {
                const shouldMute = this.defaultMuted ? true : this.isMuted;
                video.muted = shouldMute;
                if (shouldMute !== this.isMuted) {
                  this.$emit('video-state-change', { muted: shouldMute });
                }
              };

              // Listen for 'playing' event to unmute (only once per video)
              if (!video._hasPlayingListener) {
                video._hasPlayingListener = true;
                const onPlaying = () => {
                  this.initializedVideos.add(video);
                  applyMutePreference();
                };
                video.addEventListener('playing', onPlaying);
              }

              // Set flag to prevent volumechange event from overwriting store
              this.isProgrammaticVolumeChange = true;

              // Reset progress and mute only on FIRST visibility — videos never
              // play offscreen (no autoplay attribute), so they always start at 0
              if (!this.initializedVideos.has(video)) {
                video.currentTime = 0;
                video.muted = true;
              }

              // Clear flag after a short delay to allow volumechange event to pass
              setTimeout(() => { this.isProgrammaticVolumeChange = false; }, 50);

              // The observer owns playback: play() is only ever called here,
              // when a post actually enters the viewport
              if (this.autoplayVideos) {
                const attemptPlay = () => {
                  // Already playing: play() resolves without a new 'playing' event, so
                  // apply the mute preference here or the video stays muted despite
                  // the user unmuting.
                  if (!video.paused && !video.ended) {
                    this.initializedVideos.add(video);
                    applyMutePreference();
                    return;
                  }
                  video.play().then(() => {
                    this.initializedVideos.add(video);
                    applyMutePreference();
                  }).catch(() => {
                    // Retry once after a short delay
                    setTimeout(() => {
                      if (video.paused && this.autoplayVideos) {
                        video.play().catch(() => {});
                      }
                    }, 500);
                  });
                };

                if (video.readyState >= 2) {
                  attemptPlay();
                } else {
                  let playStarted = false;
                  const tryPlay = () => {
                    if (playStarted) return;
                    playStarted = true;
                    video.removeEventListener('canplay', tryPlay);
                    video.removeEventListener('loadeddata', tryPlay);
                    attemptPlay();
                  };
                  video.addEventListener('canplay', tryPlay);
                  video.addEventListener('loadeddata', tryPlay);
                  if (video.readyState === 0) {
                    video.load();
                  }
                  setTimeout(() => {
                    if (!playStarted && video.paused && this.autoplayVideos) {
                      tryPlay();
                    }
                  }, 3000);
                }
              } else {
                // Autoplay disabled: still honor the user's mute preference
                const shouldMute = this.defaultMuted ? true : this.isMuted;
                video.muted = shouldMute;
              }
            }
          } else {
            if (video) {
              video.pause();
              // Remove from initialized set so next time it enters view, it resets to start
              this.initializedVideos.delete(video);
              // Back behind the first-frame canvas: the paused element must never be
              // visible or the webview draws its overlay play glyph (#148)
              if (video._compositeKey) {
                this.videoActiveStates[video._compositeKey] = false;
              }
              // Set flag before muting to prevent event feedback
              this.isProgrammaticVolumeChange = true;
              // Only mute if we aren't already muted (reduce spam)
              if (!video.muted) {
                  video.muted = true; // Always mute non-visible videos
              }
              setTimeout(() => { this.isProgrammaticVolumeChange = false; }, 50);
            }
          }
        });
      },
      { threshold: 0.5 }
    );
    this.fetchPosts(true);

    this.$nextTick(() => {
        if(this.posts.length > 0) {
            this.determineCurrentPost();
        }
    });
  },
  beforeUnmount() {
    clearTimeout(this._revisitTimer);
    clearTimeout(this._whyChipTimer);
    this.saveRunway();
    document.removeEventListener('visibilitychange', this.onPageHidden);
    window.removeEventListener('pagehide', this.onPageHidden);
    this.feedDisposed = true;
    this.unsubscribeImageAnalysis?.();
    this.unsubscribeSession?.();
    this.unsubscribeMode?.();
    clearTimeout(this.sessionRankTimer);
    this.$refs.feedContainer.removeEventListener('scroll', this.handleScroll);
    this.$refs.feedContainer.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this.onShortcutKey);
    document.removeEventListener('visibilitychange', this.onFeedVisibility);
    if (this.observer) {
        this.observer.disconnect();
    }
    if (this._unlockAutoplay) {
        document.removeEventListener('click', this._unlockAutoplay);
        document.removeEventListener('touchstart', this._unlockAutoplay);
    }
    this.$emit('current-post-changed', null, null);
    this.stopAutoScroll();
    Object.values(this.videoBlobUrls).forEach(revokeBlobUrl);
  },
  watch: {
    // Turning chips off, or entering focus mode, clears one already on screen.
    showWhyChips(on) {
      if (!on) this.hideWhyChip();
    },
    focusMode(enabled) {
      if (enabled) this.hideWhyChip();
    },
    aiTaggingEnabled(enabled) {
      if (enabled) this.analyzeUpcomingImages();
    },
    '$route.query': {
      handler(newQuery, oldQuery) {
        const newQueryStr = JSON.stringify(newQuery);
        const oldQueryStr = JSON.stringify(oldQuery);
        if (newQueryStr !== oldQueryStr) {
          this.fetchPosts(true);
        }
      },
      deep: true,
      immediate: true
    },
    autoScroll: {
      handler(newValue) {
        if (newValue) {
          this.startAutoScroll();
        } else {
          this.stopAutoScroll();
        }
      },
      immediate: true
    },
    autoScrollWaitForVideo() {
      if (this.autoScroll) {
        this.startAutoScroll();
      }
    },
    autoScrollSeconds() {
      if (this.autoScroll) {
        this.startAutoScroll();
      }
    },
    posts() {
      this.$nextTick(() => {
        this.observePosts();
        this.determineCurrentPost();
      });
    },
    commentsSheetHeight(newHeight, oldHeight) {
      if (!this.$refs.feedContainer) return;
      
      this.isResizing = true;
      const container = this.$refs.feedContainer;
      const targetIndex = this.currentPostIndex;
      
      const startTime = performance.now();
      const duration = 350; // Map exactly to CSS transition timing
      
      const animateScroll = (time) => {
        if (!this.$refs.feedContainer) return;
        const elapsed = time - startTime;
        
        // Dynamically track the shrinking/growing height of the container
        // to maintain pixel-perfect centering on the target post through the entire animation.
        container.scrollTo({
            top: targetIndex * container.clientHeight,
            behavior: 'auto' // Instant adjustment, 60fps loop gives the illusion of smoothness
        });

        if (elapsed < duration + 50) { // pad by 50ms to ensure final tick settles cleanly
          requestAnimationFrame(animateScroll);
        } else {
          this.isResizing = false;
        }
      };
      
      requestAnimationFrame(animateScroll);
          }
        },
      }
      </script>

      <style scoped>
      /* "Why this post" chip: fades in, lingers, fades out. Its top lines its
         centre up with the sidebar tabs (1rem down, ~44px tall); the width
         cap keeps it clear of them on narrow screens. */
      .why-chip {
        top: calc(1rem + 12px + env(safe-area-inset-top, 0px));
        max-width: calc(100% - 7rem);
      }
      .why-chip-enter-active, .why-chip-leave-active { transition: opacity 0.4s ease; }
      .why-chip-enter-from, .why-chip-leave-to { opacity: 0; }
      @media (prefers-reduced-motion: reduce) {
        .why-chip-enter-active, .why-chip-leave-active { transition: none; }
      }
      /* Playback glyph over a video: a mildly transparent grey disc with the icon
         on top. The icon pops in like the interaction bursts and, on resume,
         swaps to a play glyph that pops away; the disc only fades. */
      .pause-pop__disc {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 144px;
        height: 144px;
        border-radius: 50%;
        /* Mildly transparent grey: the paused frame still reads through it. */
        background: rgba(120, 120, 120, 0.45);
      }

      .pause-pop--in .pause-pop__disc {
        animation: pause-disc-in 300ms ease-out both;
      }

      .pause-pop--out .pause-pop__disc {
        animation: pause-disc-out 380ms ease-out both;
      }

      .pause-pop--in .pause-pop__glyph {
        animation: pause-pop-in 380ms cubic-bezier(0.2, 0.8, 0.3, 1) both;
      }

      /* Leaving motion borrowed from post-burst-pop's tail — settle at scale(1),
         expand to 1.12 while fading — stretched a little longer than the bursts'
         212ms so the play glyph doesn't wink out. */
      .pause-pop--out .pause-pop__glyph {
        animation: pause-pop-out 380ms cubic-bezier(0.2, 0.8, 0.3, 1) both;
      }

      .pause-pop__glyph {
        filter: drop-shadow(0 6px 18px rgba(0, 0, 0, 0.55));
      }

      @keyframes pause-pop-in {
        0% {
          transform: scale(0.3);
          opacity: 0;
        }
        25% {
          transform: scale(1.2);
          opacity: 1;
        }
        50% {
          transform: scale(0.96);
        }
        75% {
          transform: scale(1.03);
          opacity: 1;
        }
        100% {
          transform: scale(1);
          opacity: 1;
        }
      }

      @keyframes pause-pop-out {
        0% {
          transform: scale(1);
          opacity: 1;
        }
        100% {
          transform: scale(1.12);
          opacity: 0;
        }
      }

      @keyframes pause-disc-in {
        0% {
          opacity: 0;
        }
        100% {
          opacity: 1;
        }
      }

      @keyframes pause-disc-out {
        0% {
          opacity: 1;
        }
        100% {
          opacity: 0;
        }
      }
      </style>
