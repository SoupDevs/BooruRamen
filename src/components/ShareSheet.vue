<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[60] flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Share post"
    >
      <!-- Backdrop: tapping it dismisses the sheet, like it does in any
           Android share sheet. Staying translucent after the fade-in needs a
           base opacity, since the animation does not fill forwards. -->
      <div
        class="absolute inset-0 bg-black opacity-70"
        :class="closing ? 'share-backdrop-out' : 'share-backdrop-in'"
        @click="requestClose"
      ></div>

      <div
        class="relative bg-gray-900 rounded-t-2xl border-t border-gray-700 shadow-2xl"
        :class="closing ? 'share-sheet-out' : 'share-sheet-in'"
        :style="{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0))' }"
      >
        <div class="flex justify-center pt-3 pb-2">
          <div class="w-10 h-1 bg-gray-600 rounded-full"></div>
        </div>

        <div class="px-4 pb-1 text-center">
          <h3 class="text-lg font-semibold text-white">Share</h3>
          <p class="text-xs text-gray-500 truncate">{{ subtitle }}</p>
        </div>

        <!-- Share targets -->
        <div v-if="targets.length" class="grid grid-cols-4 gap-x-2 gap-y-4 px-4 pt-4 pb-2">
          <button
            v-for="target in targets"
            :key="target.id"
            type="button"
            class="flex flex-col items-center gap-1.5 group"
            :data-share-target="target.id"
            @click="shareTo(target)"
          >
            <span
              class="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold transition-transform duration-150 group-hover:scale-105 group-active:scale-95"
              :style="{ backgroundColor: target.color, color: target.textColor || '#FFFFFF' }"
            >
              <!-- Saving the file is an action, not a network: it carries a
                   glyph and reports back in place of a badge. -->
              <template v-if="target.action === 'download'">
                <Check v-if="downloaded" class="w-6 h-6 text-green-400" />
                <Download v-else class="w-6 h-6" />
              </template>
              <template v-else>{{ target.badge }}</template>
            </span>
            <span class="text-[11px] leading-tight text-gray-300 text-center">{{ targetLabel(target) }}</span>
          </button>
        </div>

        <!-- Copy Link keeps the old one-tap behaviour, alongside the platforms
             that need a real share sheet. -->
        <div class="px-3 pt-3">
          <div class="border-t border-gray-800 mb-1"></div>

          <button
            type="button"
            data-share-action="copy-link"
            class="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-gray-800 transition-colors"
            @click="copyLink"
          >
            <span class="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center">
              <Check v-if="linkCopied" class="w-5 h-5 text-green-400" />
              <Link2 v-else class="w-5 h-5 text-gray-300" />
            </span>
            <span class="text-sm font-medium text-white">{{ linkCopied ? 'Link copied!' : 'Copy Link' }}</span>
          </button>

          <!-- Only offered where the platform actually has a native share
               sheet behind the Web Share API. -->
          <button
            v-if="canSystemShare"
            type="button"
            data-share-action="system"
            class="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-gray-800 transition-colors"
            @click="systemShare"
          >
            <span class="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center">
              <Share2 class="w-5 h-5 text-gray-300" />
            </span>
            <span class="text-sm font-medium text-white">More options</span>
          </button>

          <button
            type="button"
            class="w-full mt-1 py-3 rounded-lg bg-gray-800 text-sm font-medium text-gray-200 hover:bg-gray-700 transition-colors"
            @click="requestClose"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script>
import { Check, Download, Link2, Share2 } from 'lucide-vue-next';
import { downloadPost } from '../services/DownloadService';
import {
  buildShareTargets,
  copyToClipboard,
  getPostShareUrl,
  getShareSourceLabel,
  getShareText,
  openExternalUrl
} from '../services/ShareService';

// Keep the dismiss animation and the close event in step.
const CLOSE_ANIMATION_MS = 160;
const COPIED_FEEDBACK_MS = 1500;
// Saving a file can take a while (videos), so its confirmation lingers.
const DOWNLOAD_FEEDBACK_MS = 2500;

export default {
  name: 'ShareSheet',
  components: { Check, Download, Link2, Share2 },
  props: {
    post: {
      type: Object,
      default: null
    }
  },
  emits: ['close'],
  data() {
    return {
      closing: false,
      linkCopied: false,
      downloading: false,
      downloaded: false,
      downloadError: false,
      closeTimer: null,
      copiedTimer: null,
      downloadTimer: null
    };
  },
  computed: {
    targets() {
      return buildShareTargets(this.post);
    },
    postUrl() {
      return getPostShareUrl(this.post);
    },
    subtitle() {
      if (!this.post) return '';
      return `${getShareSourceLabel(this.post)} #${this.post.id}`;
    },
    canSystemShare() {
      return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    },
    downloadLabel() {
      if (this.downloading) return 'Saving…';
      if (this.downloaded) return 'Saved!';
      if (this.downloadError) return 'Download failed';
      return 'Download';
    }
  },
  beforeUnmount() {
    clearTimeout(this.closeTimer);
    clearTimeout(this.copiedTimer);
    clearTimeout(this.downloadTimer);
  },
  methods: {
    shareTo(target) {
      if (!target) return;
      // Download is the one entry that stays in the app, so it neither opens
      // a URL nor dismisses the sheet: the user gets to see it finish.
      if (target.action === 'download') {
        this.downloadMedia();
        return;
      }
      if (!target.url) return;
      openExternalUrl(target.url);
      this.requestClose();
    },
    targetLabel(target) {
      return target.action === 'download' ? this.downloadLabel : target.label;
    },
    async downloadMedia() {
      if (!this.post || this.downloading) return;
      this.downloading = true;
      this.downloaded = false;
      this.downloadError = false;
      // Same route as the like/favourite auto-download: the app streams the
      // file itself, the browser falls back to an anchor download.
      const saved = await downloadPost(this.post, 'shared');
      this.downloading = false;
      this.downloaded = saved;
      this.downloadError = !saved;
      clearTimeout(this.downloadTimer);
      this.downloadTimer = setTimeout(() => {
        this.downloaded = false;
        this.downloadError = false;
      }, DOWNLOAD_FEEDBACK_MS);
    },
    async copyLink() {
      const copied = await copyToClipboard(this.postUrl);
      if (!copied) return;
      this.linkCopied = true;
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => {
        this.linkCopied = false;
      }, COPIED_FEEDBACK_MS);
    },
    async systemShare() {
      try {
        await navigator.share({
          title: this.subtitle,
          text: getShareText(this.post),
          url: this.postUrl
        });
        this.requestClose();
      } catch {
        // Dismissed by the user, or the platform refused the payload: leave
        // the sheet open so another option is still one tap away.
      }
    },
    requestClose() {
      if (this.closing) return;
      this.closing = true;
      this.closeTimer = setTimeout(() => this.$emit('close'), CLOSE_ANIMATION_MS);
    }
  }
};
</script>

<style scoped>
.share-sheet-in {
  animation: share-sheet-in 240ms cubic-bezier(0.32, 0.72, 0, 1);
}

.share-sheet-out {
  animation: share-sheet-out 160ms ease-in forwards;
}

.share-backdrop-in {
  animation: share-backdrop-in 200ms ease-out;
}

.share-backdrop-out {
  animation: share-backdrop-out 160ms ease-in forwards;
}

@keyframes share-sheet-in {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

@keyframes share-sheet-out {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(100%);
  }
}

@keyframes share-backdrop-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 0.7;
  }
}

@keyframes share-backdrop-out {
  from {
    opacity: 0.7;
  }
  to {
    opacity: 0;
  }
}
</style>