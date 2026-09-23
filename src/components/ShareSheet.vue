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
        :style="backdropStyle"
        @click="requestClose"
      ></div>

      <div
        ref="panel"
        class="relative bg-gray-900 rounded-t-2xl border-t border-gray-700 shadow-2xl"
        :class="closing ? 'share-sheet-out' : 'share-sheet-in'"
        :style="sheetStyle"
      >
        <!-- The handle is a real grab handle: drag the header down to dismiss.
             touch-none keeps the browser from scrolling instead, and it spans
             the title too, so a drag that starts on the heading works as well. -->
        <div
          class="touch-none cursor-grab select-none active:cursor-grabbing"
          @pointerdown="startDrag"
          @pointermove="onDragMove"
          @pointerup="endDrag"
          @pointercancel="endDrag"
        >
          <div class="flex justify-center pt-3 pb-2">
            <div class="w-10 h-1 bg-gray-600 rounded-full"></div>
          </div>

          <div class="px-4 pb-1 text-center">
            <h3 class="text-lg font-semibold text-white">Share</h3>
            <p class="text-xs text-gray-500 truncate">{{ subtitle }}</p>
          </div>
        </div>

        <!-- Share targets: the ones this user reaches for, with everything
             else behind More. Colours come from the active theme, never from
             a per-network brand hex. -->
        <div v-if="gridTargets.length" class="grid grid-cols-4 gap-x-2 gap-y-4 px-4 pt-4 pb-2">
          <button
            v-for="(target, index) in gridTargets"
            :key="revealSeq + '-' + target.id"
            type="button"
            class="flex flex-col items-center gap-1.5 group"
            :class="leavingIds.includes(target.id) ? 'share-tile-out' : 'share-tile-in'"
            :style="tileStyle(target, index)"
            :data-share-target="target.id"
            @click="shareTo(target)"
          >
            <span
              class="w-12 h-12 rounded-full flex items-center justify-center bg-gray-800 ring-1 ring-gray-700 text-pink-400 text-base font-bold transition-transform duration-150 group-hover:scale-105 group-active:scale-95"
            >
              <!-- Saving the file is an action, not a network: it carries a
                   glyph and reports back in place of a badge. -->
              <template v-if="target.action === 'download'">
                <Check v-if="downloaded" class="w-6 h-6 text-green-500" />
                <Download v-else class="w-6 h-6" />
              </template>
              <template v-else-if="target.action === 'more'">
                <MoreHorizontal class="w-6 h-6" />
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
import { Check, Download, Link2, MoreHorizontal, Share2 } from 'lucide-vue-next';
import { useSettingsStore } from '../stores/settings';
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
// Swipe-to-dismiss: dragging the handle up to here closes the sheet, and a
// quick flick only has to travel a token distance, like a native sheet.
const DRAG_CLOSE_DISTANCE = 96;
const DRAG_FLING_VELOCITY = 0.6;
const DRAG_FLING_MIN_DISTANCE = 24;
const DRAG_SETTLE_MS = 180;
// The grid unfolds in reading order — left to right, then the next row —
// both when the sheet opens and when More expands.
const REVEAL_BASE_MS = 100;
const REVEAL_STAGGER_MS = 40;
// Collapsing swipes the hidden tiles back out, quickly and in that order.
const LEAVE_STAGGER_MS = 35;
const LEAVE_MS = 150;

export default {
  name: 'ShareSheet',
  components: { Check, Download, Link2, MoreHorizontal, Share2 },
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
      // Drag state: dragY follows the finger, dragClosing runs the glide out.
      drag: null,
      dragY: 0,
      dragClosing: false,
      linkCopied: false,
      // Everything beyond what this user actually uses waits behind More.
      showAll: false,
      // Reveal state: the key bumps to replay the entrance, the order
      // freezes so a layout shift can never change a finished tile's
      // animation-delay (a changed delay restarts it — that was the blink),
      // and leavingIds holds the collapse animation open while it plays.
      revealSeq: 0,
      tileOrder: {},
      leavingIds: [],
      collapseTimer: null,
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
    usage() {
      // target id -> { count, lastUsed }, written every time one is opened.
      return useSettingsStore().shareTargetUsage || {};
    },
    actions() {
      return this.targets.filter(target => target.action === 'download');
    },
    usedTargets() {
      return this.targets
        .filter(target => !target.action && this.usage[target.id])
        .sort((a, b) => {
          const ua = this.usage[a.id] || {};
          const ub = this.usage[b.id] || {};
          return (ub.count || 0) - (ua.count || 0) || (ub.lastUsed || 0) - (ua.lastUsed || 0);
        });
    },
    hiddenTargets() {
      return this.targets.filter(target => !target.action && !this.usage[target.id]);
    },
    gridTargets() {
      // The app's own actions always show, networks earn their place, and the
      // rest stay one tap away rather than in the user's face.
      const list = [...this.actions, ...this.usedTargets];
      if (this.showAll) list.push(...this.hiddenTargets);
      if (this.hiddenTargets.length) {
        list.push({ id: 'more', action: 'more' });
      }
      return list;
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
    sheetStyle() {
      const base = { paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0))' };
      if (this.dragClosing) {
        return {
          ...base,
          transform: 'translateY(100%)',
          transition: `transform ${CLOSE_ANIMATION_MS}ms ease-in`
        };
      }
      if (this.dragging) return { ...base, transform: `translateY(${this.dragY}px)` };
      if (this.dragY) {
        // Released short of the threshold: settle back up.
        return { ...base, transform: 'translateY(0)', transition: `transform ${DRAG_SETTLE_MS}ms ease-out` };
      }
      return base;
    },
    backdropStyle() {
      if (this.dragClosing) {
        return { opacity: 0, transition: `opacity ${CLOSE_ANIMATION_MS}ms ease-in` };
      }
      if (!this.dragging) return null;
      // The scrim fades with the drag so the gesture reads as one motion.
      return { opacity: Math.max(0, 0.7 * (1 - this.dragY / this.panelHeight())) };
    },
    dragging() {
      return this.drag !== null;
    },
    downloadLabel() {
      if (this.downloading) return 'Saving…';
      if (this.downloaded) return 'Saved!';
      if (this.downloadError) return 'Download failed';
      return 'Download';
    }
  },
  created() {
    this.tileOrder = this.snapshotOrder();
  },
  beforeUnmount() {
    clearTimeout(this.closeTimer);
    clearTimeout(this.copiedTimer);
    clearTimeout(this.downloadTimer);
    clearTimeout(this.collapseTimer);
  },
  methods: {
    shareTo(target) {
      if (!target) return;
      if (target.action === 'more') {
        if (this.leavingIds.length) return; // a collapse is already running
        if (this.showAll) {
          this.collapseGrid();
          return;
        }
        this.showAll = true;
        this.revealNow();
        return;
      }
      // Download is the one entry that stays in the app, so it neither opens
      // a URL nor dismisses the sheet: the user gets to see it finish.
      if (target.action === 'download') {
        this.downloadMedia();
        return;
      }
      if (!target.url) return;
      // Remember the networks this user actually reaches for.
      useSettingsStore().recordShareUse(target.id);
      openExternalUrl(target.url);
      this.requestClose();
    },
    snapshotOrder() {
      const order = {};
      this.gridTargets.forEach((target, index) => {
        order[target.id] = index;
      });
      return order;
    },
    // Replaying the reveal means re-mounting the tiles under a new key.
    revealNow() {
      this.revealSeq += 1;
      this.tileOrder = this.snapshotOrder();
    },
    collapseGrid() {
      const leaving = this.hiddenTargets.map(target => target.id);
      if (!leaving.length) {
        this.showAll = false;
        return;
      }
      // Keep them mounted while they swipe out, then drop them for real.
      this.leavingIds = leaving;
      const total = LEAVE_STAGGER_MS * (leaving.length - 1) + LEAVE_MS + 60;
      clearTimeout(this.collapseTimer);
      this.collapseTimer = setTimeout(() => {
        this.showAll = false;
        this.leavingIds = [];
      }, total);
    },
    tileStyle(target, index) {
      const at = this.leavingIds.indexOf(target.id);
      if (at !== -1) {
        return { animationDelay: `${at * LEAVE_STAGGER_MS}ms` };
      }
      // Positions come from the frozen reveal order, never the live grid.
      const pos = this.tileOrder[target.id];
      const at2 = pos === undefined ? index : pos;
      return { animationDelay: `${REVEAL_BASE_MS + at2 * REVEAL_STAGGER_MS}ms` };
    },
    targetLabel(target) {
      if (target.action === 'download') return this.downloadLabel;
      if (target.action === 'more') return this.showAll ? 'Less' : 'More';
      return target.label;
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
    panelHeight() {
      const el = this.$refs.panel;
      return (el && el.offsetHeight) || (typeof window !== 'undefined' ? window.innerHeight : 1);
    },
    startDrag(event) {
      if (this.closing || this.dragClosing) return;
      // Left button / first finger only, and never while the sheet is leaving.
      if (event.button !== undefined && event.button !== 0) return;
      this.drag = { id: event.pointerId, startY: event.clientY, startTime: performance.now() };
      this.dragY = 0;
      // Capture so the gesture keeps tracking outside the handle.
      const zone = event.currentTarget;
      if (zone && zone.setPointerCapture) zone.setPointerCapture(event.pointerId);
    },
    onDragMove(event) {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      // Upward drags do not lift the sheet off its edge.
      this.dragY = Math.max(0, event.clientY - this.drag.startY);
    },
    endDrag(event) {
      if (!this.drag || (event && event.pointerId !== undefined && event.pointerId !== this.drag.id)) return;
      const { startTime } = this.drag;
      const dy = this.dragY;
      const elapsed = Math.max(1, performance.now() - startTime);
      this.drag = null;
      const flicked = dy / elapsed > DRAG_FLING_VELOCITY && dy > DRAG_FLING_MIN_DISTANCE;
      if (dy > DRAG_CLOSE_DISTANCE || flicked) {
        this.dragClose();
        return;
      }
      this.dragY = 0;
    },
    dragClose() {
      if (this.closing || this.dragClosing) return;
      // Glide out from where the finger left it, then hand the sheet back.
      this.dragClosing = true;
      this.dragY = this.panelHeight();
      this.closeTimer = setTimeout(() => this.$emit('close'), CLOSE_ANIMATION_MS);
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

/* The grid's own entrance: one tile after another in reading order. The
   dialog deliberately does not use App.vue's global fadeIn rules — those
   are for the action bar and used to leak in here through the shared
   .fixed.flex.flex-col class. */
@keyframes share-tile-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes share-tile-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(14px) scale(0.92);
  }
}

.share-tile-in {
  animation: share-tile-in 300ms ease-out both;
}

.share-tile-out {
  animation: share-tile-out 150ms ease-in both;
}
</style>