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
        class="h-full w-full snap-start flex items-center justify-center relative touch-manipulation"
        @click="onMediaTap(post, $event)"
      >
        <!-- Post media -->
        <div class="relative max-h-full max-w-full">
          <!-- Feedback for the interaction that was just logged -->
          <PostActionBurst
            v-if="mediaBurst(post)"
            :key="mediaBurst(post).id"
            :type="mediaBurst(post).type"
          />
          <BooruImage
            v-if="isImage(post)" 
            :src="post.large_file_url || post.file_url" 
            :alt="post.tag_string" 
            class="max-h-[calc(100vh-0px)] max-w-full object-contain"
          />
          <div
            v-else-if="isVideo(post)"
            class="relative flex items-center justify-center max-h-[calc(100vh-0px)] max-w-full"
          >
            <!-- A paused <video> must never be the visible layer: the Android
                 webview paints its own play glyph over a paused clip, and an
                 element with no decoded frame is an empty black box (#148).
                 That is why a video scrolling into view arrived black. Same
                 stand-in chain as the feed: the booru thumbnail for the clip
                 shows straight away, the canvas takes over with the decoded
                 first frame once it exists, and playback swaps in the video
                 itself, on top of the frame it starts from. -->
            <img
              v-if="videoPosterSrc(post)"
              :src="videoPosterSrc(post)"
              :alt="post.tag_string"
              class="max-h-[calc(100vh-0px)] max-w-full object-contain"
              :class="{ 'opacity-0': hasVideoFrame(post) }"
              @error="onPosterError(post)"
            />
            <video
              :src="getVideoSrc(post)"
              :ref="(el) => setVideoRef(el, post)"
              :autoplay="autoplayVideos && isPostVisible(post)"
              :muted="!isPostVisible(post) || muted"
              loop
              :preload="videoPreloadAttr(post)"
              playsinline
              class="max-h-[calc(100vh-0px)] max-w-full"
              :class="[
                { 'opacity-0': !isVideoActive(post) },
                videoOverlayClass(post)
              ]"
              @click="togglePlayPause"
              @loadeddata="onVideoLoadedData($event, post)"
              @playing="onVideoPlaying(post)"
              @play="handleVideoStateUpdate($event, index)"
              @pause="onVideoPause($event, post, index)"
              @timeupdate="handleVideoStateUpdate($event, index)"
              @volumechange="handleVideoStateUpdate($event, index)"
            ></video>
            <canvas
              v-show="hasVideoFrame(post) && !isVideoActive(post)"
              :ref="(el) => setCanvasRef(el, post)"
              class="absolute inset-0 m-auto max-h-full max-w-full pointer-events-none"
            ></canvas>
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
import ReportService from '../services/ReportService';
import { getPlayableVideoUrl, revokeBlobUrl } from '../services/videoProxy.js';
import { postFilterMixin } from '../mixins/postFilterMixin';
import {
  captureStandInFrame,
  drawOnPresentedFrame,
  primeNeighbouringFrames,
  VIDEO_FRAME_RUNWAY_AHEAD,
  VIDEO_FRAME_RUNWAY_BEHIND
} from '../services/videoFramePriming.js';
import BooruImage from '../components/BooruImage.vue';
import PostActionBurst from '../components/PostActionBurst.vue';
import { postGestureMixin } from '../mixins/postGestureMixin';

export default {
  name: 'PostViewerView',
  mixins: [postFilterMixin, postGestureMixin],
  components: {
    BooruImage,
    PostActionBurst,
  },
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
      videoCanvases: {}, // post id -> canvas holding the decoded stand-in frame
      videoFrameStates: {}, // post id -> true once a frame has been captured
      videoActiveStates: {}, // post id -> true while the video is actually playing
      posterErrorStates: {}, // post id -> true when the clip's thumbnail failed to load
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
    Object.values(this.videoBlobUrls).forEach(revokeBlobUrl);
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
      } else if (this.source === 'reported') {
        postData = await ReportService.getReportedPosts();
      }
      this.posts = postData.filter(p => p && p.id);
      // Apply user filters (ratings, media type, tag whitelist/blacklist).
      // Skipped for reported posts: it's a management view and must stay in
      // sync with the unfiltered grid in ReportedPostsView.
      if (this.source !== 'reported') {
        this.posts = await this.filterPostsBySettings(this.posts);
      }
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
        this.primeNeighbouringVideos();
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
                this.syncVisiblePosts();
                this.$nextTick(() => {
                  // Explicitly start playback after Vue has updated :autoplay / :muted bindings
                  const video = postElements[targetIndex]?.querySelector('video');
                  if (video && this.autoplayVideos) {
                    this._playVideo(video);
                  }
                  this.$emit('current-post-changed', this.posts[this.currentPostIndex], video);
                });
            }
        }
    },
    syncVisiblePosts() {
      // Track which posts are visible and play/pause videos accordingly
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
        const video = el.querySelector('video');
        if (isVisible) {
          if (!this._visiblePostKeys[postKey]) {
            this._visiblePostKeys[postKey] = true;
            changed = true;
          }
          // Always try to play visible videos (handles retries after pause/failed play)
          if (this.autoplayVideos && video && video.paused && !video._playPending) {
            this._playVideo(video);
          }
        } else {
          if (this._visiblePostKeys[postKey]) {
            delete this._visiblePostKeys[postKey];
            changed = true;
          }
          if (video && !video.paused) video.pause();
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
        // The runway moved: make sure the clips about to scroll in are loading.
        this.primeNeighbouringVideos();
        const currentPost = this.posts[this.currentPostIndex];
        if (currentPost) {
          // Video elements are registered by setVideoRef, keyed by post id
          // (there is no "videoPlayer" ref; the old lookup always returned undefined,
          // leaving the playback controls with no video to drive)
          const videoEl = this._videoElements?.[currentPost.id] || null;
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
      if (!video || video._playPending) return;
      // Always start muted for autoplay compliance, unmute after play resolves
      video.muted = true;
      video.volume = this.volume;
      video._playPending = true;
      video.play().then(() => {
        video._playPending = false;
        // Respect user mute preference (same as FeedView)
        video.muted = this.muted;
        this.$emit('video-state-change', { muted: this.muted });
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
    setVideoRef(el, post) {
      if (el) {
        // Store on element for later lookup by post ID
        this._videoElements = this._videoElements || {};
        this._videoElements[post.id] = el;
      }
    },
    setCanvasRef(el, post) {
      if (el) {
        this.videoCanvases[post.id] = el;
      } else {
        delete this.videoCanvases[post.id];
      }
    },
    videoPosterSrc(post) {
      // The booru's own thumbnail for the clip - its first frame, and normally
      // already in the cache from the feed. Shown until a decoded frame exists.
      if (!post || this.posterErrorStates[post.id]) return '';
      return post.sample_url || post.preview_url || '';
    },
    onPosterError(post) {
      // No usable thumbnail: drop the layer so the <video> can size the post.
      this.posterErrorStates[post.id] = true;
    },
    hasVideoFrame(post) {
      return !!this.videoFrameStates[post.id];
    },
    isVideoActive(post) {
      return !!this.videoActiveStates[post.id];
    },
    videoOverlayClass(post) {
      // With a stand-in present the video overlays the poster's box; without
      // one it stays in flow so it can size the post itself.
      return this.videoPosterSrc(post) ? 'absolute inset-0 m-auto max-h-full max-w-full' : '';
    },
    // Offscreen videos only need their first frame decoded - the stand-in draws
    // from loadeddata. Anything further out is not fetched at all, so walking a
    // long viewer list never pulls every clip at once.
    videoPreloadAttr(post) {
      const distance = this.posts.indexOf(post) - this.currentPostIndex;
      return distance >= -VIDEO_FRAME_RUNWAY_BEHIND && distance <= VIDEO_FRAME_RUNWAY_AHEAD
        ? 'auto' : 'none';
    },
    primeNeighbouringVideos() {
      // The attribute above is only a hint, and engines are free to ignore one
      // set after the element was created - phones ignore it, leaving the next
      // clip frameless until playback starts. Loading the runway explicitly is
      // what actually keeps a frame ready while it scrolls into view.
      return primeNeighbouringFrames(
        this.posts,
        this.currentPostIndex,
        (post) => this._videoElements?.[post.id] || null,
        (post) => this.isVideoActive(post)
      );
    },
    drawFrameToCanvas(post, video) {
      if (captureStandInFrame(video, this.videoCanvases[post.id])) {
        this.videoFrameStates[post.id] = true;
      }
    },
    onVideoLoadedData(event, post) {
      // Hold the first frame so the post shows real content while it scrolls
      // into view - pixel-identical to the frame playback starts on. The frame
      // has to be the one the compositor has actually been given: loadeddata
      // only means the data is in, and drawing then can capture an all-black
      // picture, which is the very artefact this stand-in exists to hide. So
      // wait for the presented frame when the engine can tell us about it.
      const video = event.target;
      drawOnPresentedFrame(video, this.videoCanvases[post.id], () => {
        this.videoFrameStates[post.id] = true;
      });
    },
    onVideoPlaying(post) {
      // Playback is rendering: reveal the video, hide the stand-in, and keep a
      // frame in hand for the next pause.
      this.videoActiveStates[post.id] = true;
      const video = this._videoElements?.[post.id];
      if (video) this.drawFrameToCanvas(post, video);
    },
    onVideoPause(event, post, index) {
      // Keep the frame the video stopped on (frame 0 before it ever played) so a
      // paused post shows a picture instead of the webview's play glyph.
      this.drawFrameToCanvas(post, event.target);
      this.videoActiveStates[post.id] = false;
      this.handleVideoStateUpdate(event, index);
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
