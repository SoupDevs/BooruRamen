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
      <h1 class="text-2xl font-bold">Likes</h1>
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
  name: 'LikesView',
  mixins: [postFilterMixin],
  components: {
    PostGrid,
  },
  data() {
    return {
      posts: [],
    };
  },
  computed: {
    settingsVersion() {
      return useSettingsStore().settingsVersion;
    },
  },
  watch: {
    settingsVersion() {
      this.loadLikes();
    },
  },
  beforeRouteEnter(to, from, next) {
    next(vm => {
      vm.loadLikes();
    });
  },
  methods: {
    async loadLikes() {
      const likedInteractions = await StorageService.getInteractions('like');
      const allPosts = likedInteractions
        .filter(interaction => interaction.value > 0)
        .map(interaction => interaction.metadata.post);
      this.posts = await this.filterPostsBySettings(allPosts);
    },
    onPostClicked({ index }) {
      const post = this.posts[index];
      this.$router.push({
        name: 'Viewer',
        params: { source: 'likes' },
        query: { start: index, postId: post?.id }
      });
    },
  },
};
</script> 