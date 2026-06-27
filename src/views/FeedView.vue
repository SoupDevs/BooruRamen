<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 DottsGit

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div class="w-full relative overflow-hidden" :style="feedContainerStyle">
    <!-- Post feed -->
    <div class="h-full overflow-y-auto snap-y snap-mandatory" ref="feedContainer">
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
        v-for="(post, visibleIdx) in visiblePosts"
        :key="getCompositeKey(post)"
        class="w-full snap-start snap-always flex justify-center relative shrink-0"
        :class="commentsSheetHeight > 0 ? 'items-end' : 'items-center'"
        :style="postContainerStyle"
        v-observe-visibility
      >
        <!-- Post media -->
        <div class="relative max-h-full max-w-full">
          <img
            v-if="['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(getFileExtension(post))"
            :src="post.file_url"
            :alt="post.tags || 'Post image'"
            class="max-w-full object-contain transition-[max-height] duration-300"
            :style="{ maxHeight: mediaMaxHeight }"
            :referrerpolicy="post.file_url && post.file_url.includes('gelbooru') ? 'no-referrer' : 'strict-origin-when-cross-origin'"
            @error="(e) => console.error('Image load error:', post.file_url, e)"
          />
          <video
            v-else-if="getFileExtension(post) === 'mp4' || getFileExtension(post) === 'webm' || isVideoPost(post)"
            :src="getVideoSrc(post)"
            :ref="(el) => setVideoRef(el, post)"
            :poster="post.preview_url || post.sample_url"
            autoplay
            loop
            playsinline
            muted
            class="max-w-full transition-[max-height] duration-300"
            :style="{ maxHeight: mediaMaxHeight }"
            :preload="(visibleStartIndex + visibleIdx) === currentPostIndex || (visibleStartIndex + visibleIdx) === currentPostIndex + 1 ? 'auto' : 'metadata'"
            @click="togglePlayPause"
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
          <div 
            v-else
            class="flex items-center justify-center bg-gray-900 p-4 rounded"
          >
            <p>Unable to display media. <a :href="post.file_url" target="_blank" class="text-pink-500 underline">Open directly</a></p>
          </div>

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
      
      <!-- Pagination loading spinner -->
      <div v-if="isFetching && !loading" class="h-full w-full snap-start flex items-center justify-center relative">
         <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-pink-600"></div>
      </div>

      <!-- End of Feed Indicator -->
      <div v-if="!hasMorePosts && !loading && posts.length > 0" class="h-48 w-full snap-start flex bg-gray-900 items-center justify-center relative flex-col">
         <p class="text-xl text-pink-500 font-bold mb-2">You're all caught up!</p>
         <p class="text-gray-400">No more posts matching your criteria found.</p>
         <button @click="fetchPosts(false)" class="mt-4 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm text-white">Try Again</button>
      </div>
    </div>
  </div>
</template>

<script>
import { mapState } from 'pinia';
import { useSettingsStore } from '../stores/settings';
import { usePlayerStore } from '../stores/player';
import BooruService from '../services/BooruService';
import StorageService from '../services/StorageService';
import recommendationSystem from '../services/RecommendationSystem';
import { getPlayableVideoUrl } from '../services/videoProxy.js';

export default {
  name: 'FeedView',
  props: {
    commentsSheetHeight: {
      type: Number,
      default: 0
    }
  },
  data() {
    return {
      posts: [],
      loading: true,
      page: 1,
      currentPostIndex: 0,
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
      videoLoadingTimeouts: {}, // Non-reactive timers for debouncing spinner
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
    ...mapState(useSettingsStore, ['autoScroll', 'autoScrollSeconds', 'disableScrollAnimation', 'autoplayVideos', 'debugMode', 'whitelistTags', 'blacklistTags']),
    ...mapState(usePlayerStore, ['volume', 'muted', 'defaultMuted']),

    // Calculate max height for media based on comments sheet
    mediaMaxHeight() {
      // Base: 100vh - 4rem (nav bar) - comments sheet height
      const baseHeight = 'calc(100vh - 4rem)';
      if (this.commentsSheetHeight > 0) {
        return `calc(100vh - 4rem - ${this.commentsSheetHeight}px)`;
      }
      return baseHeight;
    },

    // Container style that adjusts height for comments sheet
    feedContainerStyle() {
      return {
        height: this.commentsSheetHeight > 0
          ? `calc(100% - ${this.commentsSheetHeight}px)`
          : '100%',
        transition: 'height 0.35s cubic-bezier(0.32, 0.72, 0, 1)'
      };
    },

    // Post container style - each post takes full height of the adjusted feed
    postContainerStyle() {
      return {
        height: this.commentsSheetHeight > 0
          ? `calc(100vh - 4rem - ${this.commentsSheetHeight}px)`
          : 'calc(100vh - 4rem)',
        transition: 'height 0.35s cubic-bezier(0.32, 0.72, 0, 1)'
      };
    },
    spacerTransitionStyle() {
      return {
        transition: this.isResizing ? 'height 0.35s cubic-bezier(0.32, 0.72, 0, 1)' : 'none'
      };
    },
    // Alias to match template if needed, or just updated template to use 'muted'
    // The template uses 'isMuted' prop, so we alias it or change template.
    // Let's alias it for minimal template changes.
    isMuted() {
        return this.muted;
    },

    // --- Virtual Scrolling Computed Properties ---
    visibleStartIndex() {
      return Math.max(0, this.currentPostIndex - 2);
    },
    visibleEndIndex() {
      return Math.min(this.posts.length - 1, this.currentPostIndex + 2);
    },
    visiblePosts() {
      if (!this.posts.length) return [];
      return this.posts.slice(this.visibleStartIndex, this.visibleEndIndex + 1);
    },
    topSpacerHeight() {
      if (this.visibleStartIndex === 0) return '0px';
      const perPostHeight = this.commentsSheetHeight > 0 
        ? `100vh - 4rem - ${this.commentsSheetHeight}px` 
        : `100vh - 4rem`;
      return `calc((${perPostHeight}) * ${this.visibleStartIndex})`;
    },
    bottomSpacerHeight() {
      const remainingPosts = Math.max(0, this.posts.length - 1 - this.visibleEndIndex);
      if (remainingPosts === 0) return '0px';
      const perPostHeight = this.commentsSheetHeight > 0 
        ? `100vh - 4rem - ${this.commentsSheetHeight}px` 
        : `100vh - 4rem`;
      return `calc((${perPostHeight}) * ${remainingPosts})`;
    }
  },
  // beforeUpdate removed to prevent clearing refs and causing infinite loops/resetting state
  async created() {
    this.videoElements = {}; // Non-reactive to prevent infinite render loops
    this.recommendationSystem = recommendationSystem;
    // Initialize recommendation system (async)
    await this.recommendationSystem.initialize();
  },
  methods: {
    getCompositeKey(post) {
      if (!post) return '';
      return post.source ? `${post.source}|${post.id}` : String(post.id);
    },
    getVideoSrc(post) {
      if (!post || !post.file_url) return '';
      // Use blob URL if available (for Tauri production), otherwise use original
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
            console.error('[FeedView] Failed to proxy video:', e);
          }
        }
      }
    },
    buildTagsFromRouteQuery(overrideQuery = null) {
      const query = overrideQuery || this.$route.query;
      const tags = [];

      const ratings = query.ratings ? query.ratings.split(',') : ['general'];
      if (ratings.length > 0) {
        const ratingMap = { 'general': 'g', 'sensitive': 's', 'questionable': 'q', 'explicit': 'e' };
        const shortRatings = ratings.map(r => ratingMap[r] || r);
        tags.push(`rating:${shortRatings.join(',')}`);
      }

      const wantsImages = 'images' in query ? query.images === '1' : true;
      const wantsVideos = 'videos' in query ? query.videos === '1' : true;

      if (wantsVideos && !wantsImages) {
        tags.push('filetype:mp4,webm');
      } else if (!wantsVideos && wantsImages) {
        tags.push('-filetype:mp4,webm');
      }

      // Use query param if present, otherwise fall back to global settings
      if (query.whitelist) {
        tags.push(...query.whitelist.split(','));
      } else if (this.whitelistTags && this.whitelistTags.length > 0) {
        tags.push(...this.whitelistTags);
      }

      if (query.blacklist) {
        tags.push(...query.blacklist.split(',').map(t => `-${t}`));
      } else if (this.blacklistTags && this.blacklistTags.length > 0) {
        tags.push(...this.blacklistTags.map(t => `-${t}`));
      }

      return tags.join(' ');
    },

    async fetchPosts(newSearch = false) {
      if (this.isFetching) return;
      this.isFetching = true;
      if (newSearch || this.posts.length === 0) {
        this.loading = true;
      }

      // Get view history to exclude seen posts
      const viewedHistory = await StorageService.getViewedPosts();
      // Create a set of IDs to exclude (viewed history + currently loaded posts)
      const blockedKeys = new Set([
        ...Object.keys(viewedHistory), 
        ...this.posts.map(p => this.getCompositeKey(p))
      ]);
      
      console.log(`FetchPosts: Blocked ${Object.keys(viewedHistory).length} from history, ${this.posts.length} from current. Total blocked IDs: ${blockedKeys.size}`);

      if (newSearch) {
        this.page = 1;
        this.posts = [];
        this.currentPostIndex = -1;
        if (this.$refs.feedContainer) {
          this.$refs.feedContainer.scrollTop = 0;
        }
        this.hasMorePosts = true;
        // Reset recommendation system session (cursors, exhausted list)
        if (this.recommendationSystem) {
          this.recommendationSystem.resetExploreSession();
        }
      }
      
      if (!this.hasMorePosts) {
          this.isFetching = false;
          this.loading = false;
          return;
      }

      const exploreMode = this.$route.query.explore === '1';

      try {
        let newPosts = [];
        
        if (exploreMode) {
          // Guard: if recommendationSystem not yet initialized (watcher fires before created), skip
          if (!this.recommendationSystem) {
            console.log('Skipping explore mode - recommendationSystem not yet initialized');
            this.isFetching = false;
            this.loading = false;
            return;
          }
          const targetCount = 5; // Relaxed target for explore mode
          let attempts = 0;
          const maxAttempts = 15;

          const fetchFunction = (queryParams, limit) => {
            return BooruService.getPosts({ 
              tags: queryParams.tags || '', 
              limit, 
              // Use specific page from recommendation system if provided (for smart cursors), 
              // otherwise fall back to global page (though global page is now static in explore mode)
              page: queryParams.page || this.page, 
              sort: this.sort, 
              sortOrder: this.sortOrder,
              skipSort: true // RecommendationSystem handles order
            });
          };

          const { ratings, whitelist, blacklist } = this.$route.query;

          // Resolve whitelist/blacklist: use query first, then global settings
          const activeWhitelist = whitelist ? whitelist.split(',') : (this.whitelistTags || []);
          const activeBlacklist = blacklist ? blacklist.split(',') : (this.blacklistTags || []);

          // Loop until we find news posts or hit max attempts
          while (newPosts.length < targetCount && attempts < maxAttempts) {
            attempts++;
            
            const batch = await this.recommendationSystem.getCuratedExploreFeed(fetchFunction, {
              postsPerFetch: 20,
              selectedRatings: ratings ? ratings.split(',') : ['general'],
              whitelist: activeWhitelist,
              blacklist: activeBlacklist,
              existingPostIds: blockedKeys, 
              wantsImages: 'images' in this.$route.query ? this.$route.query.images === '1' : true,
              wantsVideos: 'videos' in this.$route.query ? this.$route.query.videos === '1' : true,
            });
            
            if (batch.length > 0) {
              newPosts = [...newPosts, ...batch];
              batch.forEach(p => blockedKeys.add(this.getCompositeKey(p)));
            }
          }

        } else {
          // Normal mode: use recommendation engine's multi-strategy queries
          // for balanced exploitation (anchor/pivot) + exploration (reach/wildcard)
          const targetCount = 10;

          if (!this.recommendationSystem) {
            // Fallback to simple tags if recommendation system not available
            const tagsForApi = this.buildTagsFromRouteQuery();
            const targetCount = 10;
            let attempts = 0;
            const maxAttempts = 5;

            while (newPosts.length < targetCount && attempts < maxAttempts) {
              attempts++;

              const rawPosts = await BooruService.getPosts({
                tags: tagsForApi,
                page: this.page,
                limit: 20,
                sort: this.sort,
                sortOrder: this.sortOrder,
              });

              if (!rawPosts || rawPosts.length === 0) break;

              const filteredBatch = rawPosts.filter(p => !blockedKeys.has(this.getCompositeKey(p)));
              for (const post of filteredBatch) {
                if (newPosts.length < targetCount) {
                  post._searchCriteria = tagsForApi;
                  newPosts.push(post);
                  blockedKeys.add(this.getCompositeKey(post));
                }
              }

              this.page++;
              if (rawPosts.length < 20) break;
            }
          } else {
            // Use recommendation engine multi-strategy queries
            let attempts = 0;
            const maxAttempts = 5;

            while (newPosts.length < targetCount && attempts < maxAttempts) {
              attempts++;

              const queries = await this.recommendationSystem.generateMultiStrategyQueries(
                ['general'], this.whitelistTags || []
              );

              // Fetch from first available query
              let fetched = false;
              for (const query of queries) {
                if (newPosts.length >= targetCount) break;

                const rawPosts = await BooruService.getPosts({
                  tags: query.tags,
                  limit: 10,
                  sort: this.sort,
                  sortOrder: this.sortOrder,
                });

                if (rawPosts && rawPosts.length > 0) {
                  for (const post of rawPosts) {
                    if (newPosts.length >= targetCount) break;
                    if (!blockedKeys.has(this.getCompositeKey(post))) {
                      post._searchCriteria = query.tags;
                      post._strategy = query.type;
                      newPosts.push(post);
                      blockedKeys.add(this.getCompositeKey(post));
                    }
                  }
                  fetched = true;
                  break; // Only use the first successful query per attempt
                }
              }

              if (!fetched) break;
            }
          }
        
        if (newPosts && newPosts.length > 0) {
          this.posts = [...this.posts, ...newPosts];
          console.log(`Added ${newPosts.length} new posts. Total: ${this.posts.length}`);
          // Pre-fetch video URLs as blobs for Tauri production (non-blocking)
          this.processVideoUrls(newPosts);
        } else if (!exploreMode && newPosts.length === 0 && this.posts.length > 0) {
            console.log("No new unique posts found in this batch (normal mode).");
            this.hasMorePosts = false;
        } else if (exploreMode && newPosts.length === 0) {
            console.log("No new posts found in explore mode batch.");
        }
      } catch (error) {
        console.error('Failed to fetch posts:', error);
      } finally {
        this.isFetching = false;
        this.loading = false;
        
        this.$nextTick(() => {
          this.observePosts();
        });
      }
    },
    handleScroll() {
      if (this.isResizing) return;
      this.determineCurrentPost();
      const container = this.$refs.feedContainer;
      // Fetch more posts when we are 1 page away from the bottom (pre-fetching)
      if (this.hasMorePosts && container.scrollTop + container.clientHeight >= container.scrollHeight - container.clientHeight) {
        this.fetchPosts();
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

      // Bounds check: ensure index is valid and points to an actual post
      if (
        calculatedIndex >= 0 && 
        calculatedIndex < this.posts.length && 
        calculatedIndex !== this.currentPostIndex
      ) {
        this.currentPostIndex = calculatedIndex;
        const currentPost = this.posts[this.currentPostIndex];
        
        if (currentPost) {
          const videoEl = this.videoElements[this.getCompositeKey(currentPost)] || null;
          this.$emit('current-post-changed', currentPost, videoEl);
          
          await StorageService.trackPostView(currentPost.id, currentPost, currentPost.source);
        }
      }
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
      if (el) {
        const key = this.getCompositeKey(post);
        // Only initialize settings if this is a NEW element for this post
        // This prevents resetting muted=true during re-renders (e.g. volume updates)
        if (!this.videoElements[key] || this.videoElements[key] !== el) {
            this.videoElements[key] = el;
            el.volume = this.volume;
            // If defaultMuted is ON, start muted. If OFF, inherit current mute state.
            // Use muted=true for initial autoplay compliance, IntersectionObserver will set correct state when visible.
            el.muted = true; // Safe default for autoplay
            el.currentTime = 0; // Reset progress to prevent carryover
        }
      }
    },
    
    getFileExtension(post) {
      if (post && post.file_url) {
        return post.file_url.split('.').pop();
      }
      return '';
    },
    isVideoPost(post) {
      const videoExtensions = ['mp4', 'webm'];
      return videoExtensions.includes(this.getFileExtension(post));
    },
    togglePlayPause(event) {
        const video = event.target;
        if (video.paused) {
            video.play();
        } else {
            video.pause();
        }
    },
    onVideoPlay(event, post) {
      if (this.posts[this.currentPostIndex] && this.getCompositeKey(this.posts[this.currentPostIndex]) !== this.getCompositeKey(post)) return;
      
      // Enforce playback rate to prevent accidental speed changes
      const video = event.target;
      if (video.playbackRate !== 1.0) {
          video.playbackRate = 1.0;
      }
      
      this.$emit('video-state-change', { isPlaying: true });
    },
    onVideoPause(event, post) {
      if (this.posts[this.currentPostIndex] && this.getCompositeKey(this.posts[this.currentPostIndex]) !== this.getCompositeKey(post)) return;
      this.$emit('video-state-change', { isPlaying: false });
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
      if (this.autoScrollInterval) {
        clearInterval(this.autoScrollInterval);
      }
      this.autoScrollInterval = setInterval(() => {
        const container = this.$refs.feedContainer;
        if (container) {
          const nextScrollTop = container.scrollTop + container.clientHeight;
          container.scrollTo({
            top: nextScrollTop,
            behavior: this.disableScrollAnimation ? 'auto' : 'smooth'
          });
        }
      }, this.autoScrollSeconds * 1000);
    },
    stopAutoScroll() {
      if (this.autoScrollInterval) {
        clearInterval(this.autoScrollInterval);
        this.autoScrollInterval = null;
      }
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
    },
  },
  mounted() {
    this.$refs.feedContainer.addEventListener('scroll', this.handleScroll, { passive: true });

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const video = entry.target.querySelector('video');
          
          if (entry.isIntersecting) {
            if (video) {
              // Set flag to prevent volumechange event from overwriting store
              this.isProgrammaticVolumeChange = true;
              
              // Reset video progress to start when becoming visible
              video.currentTime = 0;
              
              // Apply user's volume and mute preferences when video becomes visible
              video.volume = this.volume;
              // If defaultMuted is ON: always start this video muted
              // If defaultMuted is OFF: inherit the current global mute state (from previous video)
              const shouldMute = this.defaultMuted ? true : this.isMuted;
              video.muted = shouldMute;
              
              // Sync store state with the actual video muted state so icon matches
              if (shouldMute !== this.isMuted) {
                this.$emit('video-state-change', { muted: shouldMute });
              }
              
              // Clear flag after a short delay to allow volumechange event to pass
              setTimeout(() => { this.isProgrammaticVolumeChange = false; }, 50);
              
              // Only auto-play if setting is enabled!
              if (this.autoplayVideos) {
                video.play().catch(e => {
                  // If autoplay fails, try again with muted=true
                  if (e.name === 'NotAllowedError') {
                    video.muted = true;
                    video.play().catch(() => {}); // Silently fail if still blocked
                    // Sync global state to reflect fallback to muted
                    this.$emit('video-state-change', { muted: true });
                  }
                });
              }
            }
          } else {
            if (video) {
              video.pause();
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
    this.$refs.feedContainer.removeEventListener('scroll', this.handleScroll);
    if (this.observer) {
        this.observer.disconnect();
    }
    this.$emit('current-post-changed', null, null);
    this.stopAutoScroll();
  },
  watch: {
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