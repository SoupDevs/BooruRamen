<template>
  <div class="h-full w-full relative overflow-hidden">
    <div class="h-full overflow-y-auto snap-y snap-mandatory" ref="viewerContainer">
      <div v-if="loading" class="h-full flex items-center justify-center">
        <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-pink-600"></div>
      </div>
      
      <div v-else-if="posts.length === 0" class="h-full flex items-center justify-center">
        <div class="text-center">
          <p class="text-xl">No posts to display.</p>
        </div>
      </div>
      
      <div
        v-for="(post, index) in posts"
        :key="post.id"
        :data-post-key="post.id"
        class="h-full w-full snap-start flex items-center justify-center relative"
      >
        <!-- Post media -->
        <div class="relative max-h-full max-w-full">
          <img 
            v-if="isImage(post)" 
            :src="post.large_file_url || post.file_url" 
            :alt="post.tag_string" 
            class="max-h-[calc(100vh-0px)] max-w-full object-contain"
          />
          <video
            v-else-if="isVideo(post) && isPostVisible(post)"
            :src="getVideoSrc(post)"
            ref="videoPlayer"
            :autoplay="autoplayVideos"
            muted
            loop
            preload="auto"
            class="max-h-[calc(100vh-0px)] max-w-full"
            @click="togglePlayPause"
            @play="handleVideoStateUpdate($event, index)"
            @pause="handleVideoStateUpdate($event, index)"
            @timeupdate="handleVideoStateUpdate($event, index)"
            @volumechange="handleVideoStateUpdate($event, index)"
          ></video>
          <!-- Placeholder for not-yet-visible videos -->
          <div
            v-else-if="isVideo(post)"
            class="flex items-center justify-center bg-gray-900 h-full w-full"
          >
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-pink-600"></div>
          </div>
          <div 
            v-else
            class="flex items-center justify-center bg-gray-900 p-4 rounded"
          >
            <p>Unable to display media. <a :href="post.file_url" target="_blank" class="text-pink-500 underline">Open directly</a></p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { mapState } from 'pinia';
import { useSettingsStore } from '../stores/settings';
import { usePlayerStore } from '../stores/player';
import StorageService from '../services/StorageService';
import { getPlayableVideoUrl } from '../services/videoProxy.js';
import { postFilterMixin } from '../mixins/postFilterMixin';

export default {
  name: 'PostViewerView',
  mixins: [postFilterMixin],
  props: {
    source: {
      type: String,
      required: true,
    }
  },
  data() {
    return {
      posts: [],
      loading: true,
      currentPostIndex: 0,
      observer: null,
      videoBlobUrls: {}, // Map of original URL -> blob URL for CORS bypass
      _visiblePostKeys: {}, // Track which posts are currently visible (reactive object: { postId: true })
      _visibilityVersion: 0, // Counter to force re-renders on visibility change
      _proxyFailedUrls: {}, // Track URLs that failed proxy (skip proxy path next time)
    };
  },
  computed: {
    ...mapState(useSettingsStore, ['autoplayVideos']),
    ...mapState(usePlayerStore, ['volume', 'muted']),
    
    // Alias to match template usage
    isMuted() {
        return this.muted;
    }
  },
  mounted() {
    this.loadPosts();
    this.setupObserver();
    this.$refs.viewerContainer.addEventListener('scroll', this.determineCurrentPost);
  },
  beforeUnmount() {
    this.$refs.viewerContainer.removeEventListener('scroll', this.determineCurrentPost);
    if (this.observer) {
      this.observer.disconnect();
    }
  },
  methods: {
    setupObserver() {
      if (this.observer) {
        this.observer.disconnect();
      }
      this.observer = new IntersectionObserver(
        (entries) => {
          entries.forEach(entry => {
            const postEl = entry.target;
            const postKey = postEl.dataset.postKey;
            const video = postEl.querySelector('video');
            if (entry.isIntersecting) {
              this._visiblePostKeys[postKey] = true;
              if (this.autoplayVideos && video) {
                this._playVideo(video);
              }
            } else {
              delete this._visiblePostKeys[postKey];
              video?.pause();
            }
          });
          // Increment version to force method-based template expressions (isPostVisible) to re-evaluate
          this._visibilityVersion++;
        },
        { threshold: 0.1 }
      );
      this.observePosts();
    },
    async loadPosts() {
      this.loading = true;
      let postData = [];
      if (this.source === 'history') {
        const history = await StorageService.getViewedPosts();
        postData = Object.values(history)
          .sort((a, b) => b.lastViewed - a.lastViewed)
          .map(item => item.data);
      } else if (this.source === 'likes') {
        const likedInteractions = await StorageService.getInteractions('like');
        postData = likedInteractions
          .filter(i => i.value > 0)
          .sort((a, b) => b.timestamp - a.timestamp)
          .map(i => i.metadata.post);
      } else if (this.source === 'favorites') {
        const favoritedInteractions = await StorageService.getInteractions('favorite');
        postData = favoritedInteractions
          .filter(i => i.value > 0)
          .sort((a, b) => b.timestamp - a.timestamp)
          .map(i => i.metadata.post);
      }
      this.posts = postData.filter(p => p && p.id);
      // Apply user filters (ratings, media type, tag whitelist/blacklist)
      this.posts = await this.filterPostsBySettings(this.posts);
      // Pause any videos that are still in the DOM from before filtering
      this.$refs.viewerContainer?.querySelectorAll('video').forEach(v => v.pause());
      this.loading = false;
      // Pre-fetch video URLs as blobs to bypass CORS/CORP restrictions
      this.processVideoUrls(this.posts);
      // Recreate observer so it only watches filtered posts (not stale video elements)
      this.setupObserver();
      // Scroll to initial post; IntersectionObserver handles autoplay for the visible post
      this.$nextTick(() => {
        this.scrollToInitialPost();
      });
    },
    scrollToInitialPost() {
        const startIndex = parseInt(this.$route.query.start || 0, 10);
        const postId = this.$route.query.postId;
        const container = this.$refs.viewerContainer;
        if (container) {
            let targetIndex = startIndex;
            // If postId is provided, find the matching index in our loaded posts
            if (postId != null && this.posts.length > 0) {
                const foundIndex = this.posts.findIndex(p => String(p.id) === String(postId));
                if (foundIndex >= 0) {
                    targetIndex = foundIndex;
                }
            }
            const postElements = container.querySelectorAll('.snap-start');
            if (postElements[targetIndex]) {
                container.scrollTop = postElements[targetIndex].offsetTop;
                this.currentPostIndex = targetIndex;
                this.$emit('current-post-changed', this.posts[this.currentPostIndex], this.$refs.videoPlayer?.[this.currentPostIndex]);
                // Immediately mark the visible post so video element renders without waiting for IO callback
                this.syncVisiblePosts();
            }
        }
    },
    syncVisiblePosts() {
      // Manually determine which posts are in view (reliable fallback for initial load / IO timing)
      const container = this.$refs.viewerContainer;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const containerMidY = containerRect.top + containerRect.height / 2;
      const postElements = container.querySelectorAll('.snap-start');
      let changed = false;
      postElements.forEach(el => {
        const rect = el.getBoundingClientRect();
        const postMidY = rect.top + rect.height / 2;
        const isVisible = Math.abs(containerMidY - postMidY) < rect.height * 0.6;
        const postKey = el.dataset.postKey;
        if (isVisible && !this._visiblePostKeys[postKey]) {
          this._visiblePostKeys[postKey] = true;
          changed = true;
        } else if (!isVisible && this._visiblePostKeys[postKey]) {
          delete this._visiblePostKeys[postKey]
          changed = true;
        }
      });
      if (changed) this._visibilityVersion++;
    },
    async determineCurrentPost() {
      const container = this.$refs.viewerContainer;
      if (!container) return;

      const postElements = [...container.querySelectorAll('.snap-start')];
      const containerMidY = container.getBoundingClientRect().top + container.clientHeight / 2;

      let closestPostIndex = -1;
      let minDistance = Infinity;

      postElements.forEach((postEl, index) => {
        const postMidY = postEl.getBoundingClientRect().top + postEl.clientHeight / 2;
        const distance = Math.abs(containerMidY - postMidY);

        if (distance < minDistance) {
          minDistance = distance;
          closestPostIndex = index;
        }
      });

      if (closestPostIndex !== -1 && this.currentPostIndex !== closestPostIndex) {
        this.currentPostIndex = closestPostIndex;
        const currentPost = this.posts[this.currentPostIndex];
        if (currentPost) {
          const videoEl = this.$refs.videoPlayer?.[this.currentPostIndex];
          this.$emit('current-post-changed', currentPost, videoEl);
          await StorageService.trackPostView(currentPost.id, currentPost, currentPost.source);
        }
      }
      // Sync visibility on every scroll for reliability
      this.syncVisiblePosts();
    },
    observePosts() {
      if (!this.observer) return;
      this.observer.disconnect();
      this.$nextTick(() => {
        const postElements = this.$refs.viewerContainer?.querySelectorAll('.snap-start');
        postElements?.forEach(el => this.observer.observe(el));
      });
    },
    playVisibleVideo() {
      if (!this.autoplayVideos) return;
      const container = this.$refs.viewerContainer;
      if (!container) return;
      const postElements = [...container.querySelectorAll('.snap-start')];
      const containerMidY = container.getBoundingClientRect().top + container.clientHeight / 2;
      for (let i = 0; i < postElements.length; i++) {
        const postEl = postElements[i];
        const rect = postEl.getBoundingClientRect();
        const postMidY = rect.top + rect.height / 2;
        if (Math.abs(containerMidY - postMidY) < rect.height * 0.5) {
          const video = postEl.querySelector('video');
          if (video) {
            this._playVideo(video);
          }
          break;
        }
      }
    },
    _playVideo(video) {
      // Always start muted for autoplay compliance
      video.muted = true;
      video.volume = this.volume;
      // Guard against calling play() while another play() is pending
      if (video._playPending) return;
      video._playPending = true;
      video.play().then(() => {
        video._playPending = false;
        // Respect user mute preference (same as FeedView)
        const shouldMute = this.muted;
        video.muted = shouldMute;
        // Sync UI state with actual video muted state
        this.$emit('video-state-change', { muted: shouldMute });
      }).catch(() => {
        video._playPending = false;
      });
    },
    handleVideoStateUpdate(event, index) {
      if (index !== this.currentPostIndex) return;

      const video = event.target;
      const state = {};

      switch (event.type) {
        case 'play':
          state.isPlaying = true;
          break;
        case 'pause':
          state.isPlaying = false;
          break;
        case 'timeupdate':
          if (video.duration) {
            state.progress = (video.currentTime / video.duration) * 100;
          }
          break;
        case 'volumechange':
          state.volume = video.volume;
          state.muted = video.muted;
          break;
      }
      if (Object.keys(state).length > 0) {
        this.$emit('video-state-change', state);
      }
    },
    isImage(post) {
      if (!post || !post.file_ext) return false;
      const ext = post.file_ext.toLowerCase();
      return ['jpg', 'jpeg', 'png', 'gif'].includes(ext);
    },
    isVideo(post) {
      if (!post || !post.file_ext) return false;
      const ext = post.file_ext.toLowerCase();
      return ['mp4', 'webm'].includes(ext);
    },
    getVideoSrc(post) {
      if (!post || !post.file_url) return '';
      // Use blob URL if available (successfully proxied)
      if (this.videoBlobUrls[post.file_url]) {
        return this.videoBlobUrls[post.file_url];
      }
      // Only use proxy URL if processVideoUrls hasn't run yet or is still pending.
      // If the proxy already failed (returned original URL), videoBlobUrls stays empty
      // and we fall back to the direct CDN URL which the browser handles natively.
      return post.file_url;
    },
    isPostVisible(post) {
      // Touch _visibilityVersion to register a reactive dependency — forces re-evaluate when version changes
      const _v = this._visibilityVersion;
      return !!this._visiblePostKeys[String(post.id)];
    },
    togglePlayPause(event) {
        const video = event.target;
        if (video.paused) video.play();
        else video.pause();
    },
    async processVideoUrls(posts) {
      for (const post of posts) {
        if (this.isVideo(post) && post.file_url) {
          if (this.videoBlobUrls[post.file_url]) continue;
          // Skip if already known to fail the proxy
          if (this._proxyFailedUrls[post.file_url]) continue;
          try {
            const blobUrl = await getPlayableVideoUrl(post.file_url);
            if (blobUrl !== post.file_url) {
              this.videoBlobUrls[post.file_url] = blobUrl;
            } else {
              // Proxy failed — remember so getVideoSrc skips the proxy path
              this._proxyFailedUrls[post.file_url] = true;
            }
          } catch (e) {
            this._proxyFailedUrls[post.file_url] = true;
          }
        }
      }
    },
  },
  watch: {
    posts: 'observePosts',
    autoplayVideos: 'setupObserver'
  }
};
</script> 