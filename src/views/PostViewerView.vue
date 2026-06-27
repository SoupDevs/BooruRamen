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
            v-else-if="isVideo(post)" 
            :src="post.file_url" 
            ref="videoPlayer"
            :autoplay="autoplayVideos"
            :muted="isMuted"
            loop 
            class="max-h-[calc(100vh-0px)] max-w-full"
            @click="togglePlayPause"
            @play="handleVideoStateUpdate($event, index)"
            @pause="handleVideoStateUpdate($event, index)"
            @timeupdate="handleVideoStateUpdate($event, index)"
            @volumechange="handleVideoStateUpdate($event, index)"
          ></video>
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

export default {
  name: 'PostViewerView',
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
            const video = entry.target.querySelector('video');
            if (entry.isIntersecting) {
              if (this.autoplayVideos && video) {
                video.volume = this.volume;
                video.muted = this.muted;
                video.play().catch(e => console.warn("Autoplay was prevented in viewer.", e));
              }
            } else {
              video?.pause();
            }
          });
        },
        { threshold: 0.5 }
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
      this.loading = false;
      this.$nextTick(this.scrollToInitialPost);
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
            }
        }
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
    },
    observePosts() {
      if (!this.observer) return;
      this.observer.disconnect();
      this.$nextTick(() => {
        const postElements = this.$refs.viewerContainer?.querySelectorAll('.snap-start');
        postElements?.forEach(el => this.observer.observe(el));
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
    togglePlayPause(event) {
        const video = event.target;
        if (video.paused) video.play();
        else video.pause();
    }
  },
  watch: {
    posts: 'observePosts',
    autoplayVideos: 'setupObserver'
  }
};
</script> 