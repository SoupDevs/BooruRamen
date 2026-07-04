<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <!-- Bottom Sheet - No backdrop, sits above the nav bar -->
  <Teleport to="body">
    <div
      ref="sheetRef"
      class="fixed inset-x-0 z-40 touch-none"
      :style="sheetStyle"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
    >
      <div
        class="bg-gray-900 rounded-t-2xl flex flex-col h-full shadow-2xl"
      >
        <!-- Handle -->
        <div
          class="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing"
          @mousedown="onHandleMouseDown"
          @touchstart.stop="onHandleTouchStart"
        >
          <div class="w-10 h-1 bg-gray-600 rounded-full"></div>
        </div>

        <!-- Header with comment count -->
        <div class="flex items-center justify-between px-4 pb-3 border-b border-gray-700">
          <div class="flex items-center gap-2">
            <h3 class="text-lg font-semibold text-white">Comments</h3>
            <span
              v-if="!loading"
              class="px-2 py-0.5 text-xs font-medium rounded-full"
              :class="comments.length > 0 ? 'bg-pink-600 text-white' : 'bg-gray-700 text-gray-400'"
            >
              {{ comments.length }}
            </span>
          </div>
          <button
            @click="close"
            class="p-2 rounded-full hover:bg-gray-700 transition-colors"
          >
            <X class="h-5 w-5 text-gray-400" />
          </button>
        </div>

        <!-- Content -->
        <div
          ref="contentRef"
          class="flex-1 overflow-y-auto px-4 py-3"
          @touchstart.stop
          @touchmove.stop
        >
          <!-- Loading State -->
          <div v-if="loading" class="flex flex-col items-center justify-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-pink-500"></div>
            <p class="text-gray-400 mt-3">Loading comments...</p>
          </div>

          <!-- Error State -->
          <div v-else-if="error" class="text-center py-8">
            <p class="text-red-400">{{ error }}</p>
            <button
              @click="fetchComments"
              class="mt-3 px-4 py-2 bg-pink-600 hover:bg-pink-700 rounded text-white text-sm transition-colors"
            >
              Retry
            </button>
          </div>

          <!-- Empty State -->
          <div v-else-if="comments.length === 0" class="text-center py-8">
            <MessageCircle class="h-12 w-12 text-gray-600 mx-auto mb-3" />
            <p class="text-gray-400">No comments yet</p>
            <a
              v-if="postUrl"
              :href="postUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="text-pink-400 hover:text-pink-300 text-sm mt-2 inline-block"
            >
              View on source site
            </a>
          </div>

          <!-- Comments List -->
          <div v-else class="space-y-4">
            <div
              v-for="comment in comments"
              :key="comment.id"
              class="bg-gray-800 rounded-lg p-3"
            >
              <div class="flex items-center justify-between mb-2">
                <span class="text-pink-400 font-medium text-sm">{{ comment.creator }}</span>
                <span class="text-gray-500 text-xs">{{ formatDate(comment.createdAt) }}</span>
              </div>
              <div class="text-gray-200 text-sm whitespace-pre-wrap break-words comment-body" v-html="formatComment(comment.body)"></div>
              
              <!-- Footer with Rating -->
              <div class="mt-2 text-xs text-gray-500 font-medium">
                Rating: {{ comment.score }}
              </div>
            </div>

            <!-- Link to source -->
            <div class="text-center pt-2 pb-4">
              <a
                v-if="postUrl"
                :href="postUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="text-pink-400 hover:text-pink-300 text-sm"
              >
                View all comments on source site
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script>
import { X, MessageCircle } from 'lucide-vue-next';
import BooruService from '../services/BooruService';

export default {
  name: 'CommentsSheet',
  components: {
    X,
    MessageCircle
  },
  props: {
    post: {
      type: Object,
      default: null
    }
  },
  emits: ['close', 'height-change'],
  data() {
    return {
      isOpen: false,
      loading: false,
      error: null,
      comments: [],

      // Animation state
      currentHeight: 0,
      targetHeight: 0,
      maxHeight: 0,
      minHeight: 120,
      isDragging: false,
      dragStartedOnHandle: false,
      startY: 0,
      startHeight: 0,
      velocity: 0,
      lastY: 0,
      lastTime: 0
    };
  },
  computed: {
    postUrl() {
      return this.post?.post_url || null;
    },
    sheetStyle() {
      // Nav bar height is 4rem (64px) + safe area
      const navBarHeight = 'calc(4rem + env(safe-area-inset-bottom, 0))';

      if (!this.isOpen) {
        return {
          transform: 'translateY(100%)',
          height: '0px',
          bottom: navBarHeight,
          visibility: 'hidden'
        };
      }
      return {
        height: `${this.currentHeight}px`,
        bottom: navBarHeight,
        transition: this.isDragging ? 'none' : 'height 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
        visibility: 'visible'
      };
    }
  },
  watch: {
    post: {
      handler(newPost, oldPost) {
        if (newPost) {
          // If already open and just switching posts, refetch without re-animating
          if (this.isOpen && oldPost && newPost.id !== oldPost.id) {
            this.fetchComments();
          } else if (!this.isOpen) {
            // First time opening
            this.open();
          }
        }
      },
      immediate: true
    },
    currentHeight(newHeight) {
      this.$emit('height-change', newHeight);
    }
  },
  mounted() {
    this.calculateMaxHeight();
    window.addEventListener('resize', this.calculateMaxHeight);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.calculateMaxHeight);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
  },
  methods: {
    calculateMaxHeight() {
      // Max height is 70% of viewport
      this.maxHeight = Math.floor(window.innerHeight * 0.7);
      // Default open height is 45% of viewport
      this.targetHeight = Math.floor(window.innerHeight * 0.45);
    },
    async open() {
      if (!this.post) return;
      this.calculateMaxHeight();
      this.isOpen = true;
      this.comments = [];
      this.error = null;

      // Start from 0 and animate up
      this.currentHeight = 0;

      // Animate to target height on next frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.currentHeight = this.targetHeight;
        });
      });

      await this.fetchComments();
    },
    close() {
      // Animate down
      this.currentHeight = 0;
      this.$emit('height-change', 0);

      setTimeout(() => {
        this.isOpen = false;
        this.$emit('close');
      }, 350);
    },

    // Handle-specific touch (always drags)
    onHandleTouchStart(e) {
      this.dragStartedOnHandle = true;
      this.startDrag(e.touches[0].clientY);
    },

    // General touch handling
    onTouchStart(e) {
      // Check if scrolled to top in content area
      const contentEl = this.$refs.contentRef;
      if (contentEl && contentEl.contains(e.target)) {
        if (contentEl.scrollTop > 0) {
          // Allow native scroll
          return;
        }
      }

      this.dragStartedOnHandle = false;
      this.startDrag(e.touches[0].clientY);
    },
    onTouchMove(e) {
      if (!this.isDragging) return;

      // If we started in content and are trying to scroll up (expand), allow native behavior
      if (!this.dragStartedOnHandle) {
        const contentEl = this.$refs.contentRef;
        if (contentEl && contentEl.contains(e.target) && contentEl.scrollTop > 0) {
          this.isDragging = false;
          return;
        }
      }

      e.preventDefault();
      this.moveDrag(e.touches[0].clientY);
    },
    onTouchEnd() {
      this.endDrag();
    },

    // Mouse handling (for handle only)
    onHandleMouseDown(e) {
      e.preventDefault();
      this.dragStartedOnHandle = true;
      this.startDrag(e.clientY);
      document.addEventListener('mousemove', this.onMouseMove);
      document.addEventListener('mouseup', this.onMouseUp);
    },
    onMouseMove(e) {
      if (!this.isDragging) return;
      e.preventDefault();
      this.moveDrag(e.clientY);
    },
    onMouseUp() {
      this.endDrag();
      document.removeEventListener('mousemove', this.onMouseMove);
      document.removeEventListener('mouseup', this.onMouseUp);
    },

    // Drag logic
    startDrag(clientY) {
      this.isDragging = true;
      this.startY = clientY;
      this.startHeight = this.currentHeight;
      this.lastY = clientY;
      this.lastTime = Date.now();
      this.velocity = 0;
    },
    moveDrag(clientY) {
      const deltaY = this.startY - clientY;
      let newHeight = this.startHeight + deltaY;

      // Clamp height with rubber band effect at boundaries
      if (newHeight > this.maxHeight) {
        const overflow = newHeight - this.maxHeight;
        newHeight = this.maxHeight + (overflow * 0.2);
      } else if (newHeight < this.minHeight) {
        const overflow = this.minHeight - newHeight;
        newHeight = this.minHeight - (overflow * 0.3);
      }

      // Calculate velocity for momentum
      const now = Date.now();
      const dt = now - this.lastTime;
      if (dt > 0) {
        this.velocity = (this.lastY - clientY) / dt;
      }
      this.lastY = clientY;
      this.lastTime = now;

      this.currentHeight = Math.max(0, newHeight);
    },
    endDrag() {
      if (!this.isDragging) return;
      this.isDragging = false;

      // Determine action based on velocity and position
      const velocityThreshold = 0.4;
      const closeThreshold = this.maxHeight * 0.25;

      if (this.velocity < -velocityThreshold || this.currentHeight < closeThreshold) {
        // Swipe down or dragged low - close
        this.close();
      } else if (this.velocity > velocityThreshold) {
        // Swipe up - expand to max
        this.currentHeight = this.maxHeight;
      } else {
        // Snap to nearest sensible position
        if (this.currentHeight > this.maxHeight * 0.6) {
          this.currentHeight = this.maxHeight;
        } else if (this.currentHeight < closeThreshold) {
          this.close();
        } else {
          this.currentHeight = this.targetHeight;
        }
      }
    },

    async fetchComments() {
      if (!this.post) return;

      this.loading = true;
      this.error = null;

      try {
        const result = await BooruService.getComments(this.post);
        // Check if the result is an error object
        if (result && result.error) {
          this.error = result.error;
          this.comments = [];
        } else {
          this.comments = result || [];
        }
      } catch (err) {
        console.error('Error fetching comments:', err);
        this.error = 'Failed to load comments';
      } finally {
        this.loading = false;
      }
    },
    formatDate(dateString) {
      if (!dateString) return '';
      try {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
          const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
          if (diffHours === 0) {
            const diffMins = Math.floor(diffMs / (1000 * 60));
            return diffMins <= 1 ? 'just now' : `${diffMins}m ago`;
          }
          return `${diffHours}h ago`;
        } else if (diffDays === 1) {
          return 'yesterday';
        } else if (diffDays < 7) {
          return `${diffDays}d ago`;
        } else if (diffDays < 365) {
          return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        } else {
          return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        }
      } catch {
        return dateString;
      }
    },
    formatComment(text) {
      if (!text) return '';

      // 1. Escape HTML first to prevent XSS
      let formatted = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

      // 2. Handle [quote] blocks
      // Global replace for flat quotes
      formatted = formatted.replace(
        /\[quote\]([\s\S]*?)\[\/quote\]/gi,
        '<blockquote class="border-l-2 border-pink-500 pl-3 my-2 text-gray-400 italic bg-gray-900/30 p-2 rounded text-xs">$1</blockquote>'
      );

      // 3. Handle [i] italics
      formatted = formatted.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em class="text-pink-200">$1</em>');

      // 4. Handle [b] bold
      formatted = formatted.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong class="text-white font-bold">$1</strong>');
      
      // 5. Handle [s] strikethrough (common in boorus)
      formatted = formatted.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<del class="text-gray-500">$1</del>');

      // 6. Auto-linkify URLs (http/https)
      // We look for URLs that are NOT preceded by a quote or within a tag (simplified)
      // Since we escaped HTML < > earlier, we can safely match http...
      // but we inserted HTML tags in steps 2-5. 
      // The HTML tags we inserted use double quotes for attributes.
      // We should be careful not to match URLs inside attributes.
      // However, our inserted HTML only has class="..." and no hrefs yet.
      // So matching http://... should be safe as long as we don't match inside class="..." (which we won't usually find http there).
      
      // 6. Handle !asset embeds (e.g. !asset #123: Title [url])
      // Format: !asset #id: Title [url]
      formatted = formatted.replace(
        /!asset #(\d+): (.+?) \[(.+?)\]/g,
        (match, id, title, url) => {
           return `<div class="my-2 p-2 bg-gray-900 rounded border border-gray-700 hover:border-pink-500 transition-colors group">
             <a href="${url}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-3 no-underline">
               <div class="h-10 w-10 bg-gray-800 rounded flex items-center justify-center text-gray-400 group-hover:text-pink-400">
                 <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
               </div>
               <div class="flex-1 min-w-0">
                 <div class="text-sm font-medium text-pink-400 truncate">${title}</div>
                 <div class="text-xs text-gray-500 truncate">Origin ${url}</div>
               </div>
             </a>
           </div>`;
        }
      );

      // 7. Auto-linkify URLs (http/https)
      // We look for URLs that are NOT preceded by a quote or within a tag (simplified)
      
      formatted = formatted.replace(
        /(https?:\/\/[^\s<"']+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-pink-400 hover:text-pink-300 hover:underline break-all">$1</a>'
      );

      return formatted;
    }
  }
};
</script>

<style scoped>
.touch-none {
  touch-action: none;
}
</style>
