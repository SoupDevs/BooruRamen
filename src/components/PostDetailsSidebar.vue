<template>
  <div
    class="absolute top-0 left-0 w-80 h-full bg-transparent backdrop-blur-sm border-r border-gray-700 overflow-y-auto z-50 transition-transform duration-300 ease-in-out"
    :style="{ transform: show ? 'translateX(0)' : 'translateX(-100%)' }"
  >
    <div class="p-4" style="padding-top: calc(1rem + env(safe-area-inset-top, 0)); padding-bottom: calc(5rem + env(safe-area-inset-bottom, 0));">
      <h2 class="text-xl font-bold mb-4">Post Details</h2>

      <div class="space-y-4" v-if="post">
        <!-- Tag sections ordered and colored to match Danbooru -->
        <TagSection v-if="post.tag_string_artist" title="Artist Tags" :tagString="post.tag_string_artist" colorClass="bg-pink-900" @tag-click="addTagToWhitelist" />
        <TagSection v-if="post.tag_string_copyright" title="Copyright Tags" :tagString="post.tag_string_copyright" colorClass="bg-[#c797ff] text-gray-900" @tag-click="addTagToWhitelist" />
        <TagSection v-if="post.tag_string_character" title="Character Tags" :tagString="post.tag_string_character" colorClass="bg-green-900" @tag-click="addTagToWhitelist" />
        <TagSection v-if="post.tag_string_general" title="General Tags" :tagString="post.tag_string_general" colorClass="bg-gray-700" @tag-click="addTagToWhitelist" />
        <TagSection v-if="post.tag_string_meta" title="Meta Tags" :tagString="post.tag_string_meta" colorClass="bg-[#ead084] text-gray-900" @tag-click="addTagToWhitelist" />

        <!-- Fallback if specific tags don't exist but master string does -->
        <TagSection
          v-if="!post.tag_string_artist && !post.tag_string_character && !post.tag_string_general && post.tag_string"
          title="All Tags"
          :tagString="post.tag_string"
          colorClass="bg-gray-700"
          @tag-click="addTagToWhitelist"
        />

        <div>
          <h3 class="text-sm font-medium text-gray-400 mb-1">Information</h3>
          <ul class="space-y-1 text-sm">
            <li class="flex justify-between gap-3">
              <span class="text-gray-400 shrink-0">ID</span>
              <span class="text-right">{{ post.id }}</span>
            </li>
            <li class="flex justify-between gap-3">
              <span class="text-gray-400 shrink-0">Uploader</span>
              <span class="text-right break-all">{{ uploaderName }}</span>
            </li>
            <li class="flex justify-between gap-3">
              <span class="text-gray-400 shrink-0">Date</span>
              <span class="text-right">{{ post.created_at ? new Date(post.created_at).toLocaleString() : 'Unknown' }}</span>
            </li>
            <li class="flex justify-between gap-3">
              <span class="text-gray-400 shrink-0">Approver</span>
              <span class="text-right break-all">{{ approverName }}</span>
            </li>
            <li class="flex justify-between gap-3">
              <span class="text-gray-400 shrink-0">Size</span>
              <span class="text-right">{{ sizeInfo }}</span>
            </li>
            <li class="flex justify-between gap-3">
              <span class="text-gray-400 shrink-0">Source</span>
              <button
                v-if="originalSourceIsUrl"
                @click="openExternal(post.original_source)"
                class="text-right text-pink-400 hover:text-pink-300 hover:underline break-all"
                :title="post.original_source"
              >
                {{ originalSourceLabel }}
              </button>
              <span v-else class="text-right break-all">{{ originalSourceLabel }}</span>
            </li>
            <li class="flex justify-between gap-3">
              <span class="text-gray-400 shrink-0">Rating</span>
              <span class="text-right capitalize">{{ getRatingFromCode(post.rating) }}</span>
            </li>
            <li class="flex justify-between gap-3">
              <span class="text-gray-400 shrink-0">Score</span>
              <span class="text-right">{{ post.score ?? 0 }}</span>
            </li>
            <li class="flex justify-between gap-3">
              <span class="text-gray-400 shrink-0">Favorites</span>
              <span class="text-right">{{ post.fav_count ?? 'Unknown' }}</span>
            </li>
            <li class="flex justify-between gap-3">
              <span class="text-gray-400 shrink-0">Status</span>
              <span class="text-right">{{ postStatus }}</span>
            </li>
          </ul>
        </div>

        <div>
          <h3 class="text-sm font-medium text-gray-400">Source</h3>
          <p class="text-pink-400">{{ booruName }}</p>
        </div>

        <div class="flex justify-between items-center mt-4">
          <button
            @click="openInBrowser"
            class="text-gray-400 hover:text-white transition-colors p-2 rounded-full hover:bg-gray-800"
            title="Open in browser"
          >
            View in Browser
          </button>
          <button
            @click="share"
            class="relative flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors p-2 rounded-full hover:bg-gray-800"
            :title="isMobile ? 'Share post' : 'Copy link'"
          >
            <Share2 class="h-4 w-4" />
            Share
            <span
              v-if="linkCopied"
              class="absolute top-0 right-0 bottom-0 left-0 bg-green-600 rounded-full flex items-center justify-center text-white"
              style="animation: fadeOut 1.5s forwards;"
            >
              Copied!
            </span>
          </button>
        </div>

        <div class="border-t border-gray-700 mt-4 pt-4">
          <button
            @click="$emit('report-block')"
            class="w-full text-center py-2 rounded-md text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-900/30 border border-red-900/60 transition-colors"
          >
            Report/Block
          </button>
        </div>
      </div>
    </div>

    <!-- Tag feedback: a short note that pops where the tag was tapped, sits
         solid for a beat, then fades downward. Teleported so the sidebar's
         scroll container cannot clip it. -->
    <Teleport to="body">
      <div
        v-if="tagPop"
        :key="tagPop.id"
        data-tag-pop
        class="pr-tag-pop fixed z-[100] pointer-events-none whitespace-nowrap rounded-md border border-pink-600/60 bg-gray-900/95 px-2 py-1 text-xs text-white shadow-lg"
        :style="{ left: tagPop.x + 'px', top: tagPop.y + 'px' }"
      >
        {{ tagPop.text }}
      </div>
    </Teleport>
  </div>
</template>

<script>
import TagSection from './TagSection.vue';
import { Share2 } from 'lucide-vue-next';
import { isTauri } from '../services/DownloadService';
import { copyToClipboard, isMobilePlatform } from '../services/ShareService';
import { useSettingsStore } from '../stores/settings';

export default {
  name: 'PostDetailsSidebar',
  components: { TagSection, Share2 },
  props: {
    show: Boolean,
    post: Object,
  },
  emits: ['report-block', 'share'],
  data() {
    return {
      linkCopied: false,
      tagPop: null,
    };
  },
  computed: {
    uploaderName() {
      if (!this.post) return 'Unknown';
      // owner (Gelbooru) / author (Moebooru) cover posts stored before those
      // fields were mapped to uploader_name
      return this.post.uploader_name || this.post.owner || this.post.author || 'Unknown';
    },
    approverName() {
      if (!this.post) return 'None';
      if (this.post.approver_name) return this.post.approver_name;
      if (this.post.approver_id) return `User #${this.post.approver_id}`;
      return 'None';
    },
    sizeInfo() {
      const parts = [this.formatFileSize(this.post.file_size)];
      if (this.post.file_ext) parts.push(`.${this.post.file_ext.toLowerCase()}`);
      const w = this.post.image_width || this.post.width;
      const h = this.post.image_height || this.post.height;
      if (w && h) parts.push(`(${w}×${h})`);
      return parts.join(' ');
    },
    originalSourceIsUrl() {
      return /^https?:\/\//i.test(this.post?.original_source || '');
    },
    originalSourceLabel() {
      const src = this.post?.original_source;
      if (!src) return 'None';
      if (this.originalSourceIsUrl) {
        try {
          return new URL(src).hostname.replace(/^www\./, '');
        } catch {
          return src;
        }
      }
      return src;
    },
    postStatus() {
      if (!this.post) return 'Unknown';
      if (this.post.is_deleted) return 'Deleted';
      if (this.post.is_banned) return 'Banned';
      if (this.post.is_flagged) return 'Flagged';
      if (this.post.is_pending) return 'Pending';
      if (typeof this.post.status === 'string' && this.post.status) {
        return this.post.status.charAt(0).toUpperCase() + this.post.status.slice(1);
      }
      return 'Active';
    },
    booruName() {
      const source = this.post?.source;
      if (!source) return 'Unknown';
      try {
        const host = new URL(source).hostname.toLowerCase();
        if (host.endsWith('donmai.us')) return 'Danbooru';
        if (host.endsWith('gelbooru.com')) return 'Gelbooru';
        if (host.endsWith('safebooru.org')) return 'Safebooru';
        if (host.endsWith('konachan.com') || host.endsWith('konachan.net')) return 'Konachan';
        if (host.endsWith('yande.re')) return 'Yande.re';
        const label = host.replace(/^www\./, '').split('.')[0];
        return label.charAt(0).toUpperCase() + label.slice(1);
      } catch {
        return source.charAt(0).toUpperCase() + source.slice(1);
      }
    },
    isMobile() {
      return isMobilePlatform();
    },
    postUrl() {
      if (!this.post) return null;
      return this.post.post_url || (this.post.id ? `https://danbooru.donmai.us/posts/${this.post.id}` : null);
    },
  },
  methods: {
    // Tapping a tag in this sidebar whitelists it: the tag becomes a
    // mandatory filter for the next feed fetch, which is the fast path from
    // "I like what this post has" to "show me more of it". The feed is
    // refreshed straight away so the new filter is visible without an
    // Apply Settings round trip.
    addTagToWhitelist(tag, event) {
      if (!tag) return;
      const settings = useSettingsStore();
      const alreadyWhitelisted = settings.whitelistTags.includes(tag);
      settings.addWhitelistTag(tag);
      this.showTagPop(
        alreadyWhitelisted ? `${tag} is already whitelisted` : `Added ${tag} to whitelist`,
        event
      );
      this.refreshFeed();
    },
    // Feedback under the finger: solid for ~1s, then fades out while it
    // drifts down. A new tap replaces it and restarts the animation.
    showTagPop(text, event) {
      const x = event && Number.isFinite(event.clientX) ? event.clientX : window.innerWidth / 2;
      const y = event && Number.isFinite(event.clientY) ? event.clientY : window.innerHeight / 2;
      this.tagPop = {
        id: Date.now(),
        text,
        x: Math.round(x),
        // keep the bubble on screen when the tag sits near the top edge
        y: Math.round(Math.max(y, 44)),
      };
      // The bubble is centred on the cursor, so a long message near the
      // left edge would hang off the window; nudge it fully inside.
      // Measure the laid-out width (offsetWidth ignores the transform):
      // the fade animation may not have applied its translate(-50%) yet.
      // The correction goes back into tagPop.x — an imperative style write
      // would be clobbered by the next re-render of this sidebar.
      this.$nextTick(() => {
        const el = document.querySelector('[data-tag-pop]');
        if (!el || !this.tagPop) return;
        const half = el.offsetWidth / 2;
        const popX = this.tagPop.x;
        let dx = 0;
        if (popX - half < 8) dx = 8 - (popX - half);
        else if (popX + half > window.innerWidth - 8) {
          dx = (window.innerWidth - 8) - (popX + half);
        }
        if (dx !== 0) this.tagPop.x = Math.round(popX + dx);
      });
      clearTimeout(this._tagPopTimer);
      this._tagPopTimer = setTimeout(() => {
        this.tagPop = null;
      }, 1700);
    },
    // Re-run the feed's query with the updated whitelist. Only the feed
    // reads it, and only a route change makes it refetch.
    refreshFeed() {
      if (this.$route.name !== 'Home') return;
      const settings = useSettingsStore();
      const query = {
        images: settings.mediaType.images ? '1' : '0',
        videos: settings.mediaType.videos ? '1' : '0',
        whitelist: settings.whitelistTags.join(','),
        blacklist: settings.blacklistTags.join(','),
      };
      if (JSON.stringify(this.$route.query) === JSON.stringify(query)) return;
      this.$router.replace({ name: 'Home', query });
    },
    getRatingFromCode(code) {
      if (!code) return 'Unknown';
      const map = { 'g': 'General', 's': 'Sensitive', 'q': 'Questionable', 'e': 'Explicit' };
      return map[code] || code;
    },
    formatFileSize(bytes) {
      if (!bytes) return 'Unknown size';
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
    },
    async openExternal(url) {
      if (!url) return;
      // Tauri webviews don't handle target=_blank; route through the opener
      // plugin so the OS default browser is used on desktop and Android.
      if (isTauri()) {
        try {
          const { openUrl } = await import('@tauri-apps/plugin-opener');
          await openUrl(url);
          return;
        } catch (e) {
          console.error('[PostDetails] Failed to open via Tauri opener:', e);
        }
      }
      window.open(url, '_blank', 'noopener');
    },
    openInBrowser() {
      this.openExternal(this.postUrl);
    },
    share() {
      if (!this.post) return;
      // Phones get the share sheet; desktop keeps the old one-tap copy.
      if (this.isMobile) {
        this.$emit('share', this.post);
        return;
      }
      this.copyLink();
    },
    async copyLink() {
      if (!this.post) return;
      const copied = await copyToClipboard(this.postUrl);
      if (!copied) return;
      this.linkCopied = true;
      setTimeout(() => {
        this.linkCopied = false;
      }, 1500);
    }
  }
}
</script>

<style>
/* Tag-tap feedback. Global (not scoped) because the bubble is teleported to
   <body>; the pr-tag-pop prefix keeps it out of everyone else's way. */
.pr-tag-pop {
  transform: translate(-50%, -130%);
  animation: pr-tag-pop-fade 1.7s ease forwards;
}
@keyframes pr-tag-pop-fade {
  0% {
    opacity: 0;
    transform: translate(-50%, -105%);
  }
  10% {
    opacity: 1;
    transform: translate(-50%, -130%);
  }
  /* hold solid for about a second, right where the tag was tapped */
  65% {
    opacity: 1;
    transform: translate(-50%, -130%);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -60%);
  }
}
</style>
