<template>
  <div class="h-screen overflow-y-auto pb-16">
    <div class="relative flex items-center justify-center p-4 pb-0">
      <router-link
        to="/profile"
        class="absolute left-0 text-pink-500 hover:text-pink-400 flex items-center gap-1"
      >
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        <span class="text-sm">Back</span>
      </router-link>
      <h1 class="text-2xl font-bold">History</h1>
    </div>
    <PostGrid :posts="posts" @post-clicked="onPostClicked" />
  </div>
</template>

<script>
import PostGrid from '../components/PostGrid.vue';
import StorageService from '../services/StorageService';
import { postFilterMixin } from '../mixins/postFilterMixin';
import { useSettingsStore } from '../stores/settings';

export default {
  name: 'HistoryView',
  mixins: [postFilterMixin],
  components: {
    PostGrid,
  },
  data() {
    return {
      posts: [],
    };
  },
  mounted() {
    this.loadHistory();
  },
  computed: {
    settingsVersion() {
      return useSettingsStore().settingsVersion;
    },
  },
  watch: {
    settingsVersion() {
      this.loadHistory();
    },
  },
  methods: {
    async loadHistory() {
      const history = await StorageService.getViewedPosts();
      const allPosts = Object.values(history)
        .sort((a, b) => b.lastViewed - a.lastViewed)
        .map(item => item.data);
      this.posts = await this.filterPostsBySettings(allPosts);
    },
    onPostClicked({ index }) {
      const post = this.posts[index];
      this.$router.push({
        name: 'Viewer',
        params: { source: 'history' },
        query: { start: index, postId: post?.id }
      });
    },
  },
};
</script> 