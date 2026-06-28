<template>
  <div class="h-screen overflow-y-auto pb-16">
    <h1 class="text-2xl font-bold p-4">Favorited Posts</h1>
    <PostGrid :posts="posts" @post-clicked="onPostClicked" />
  </div>
</template>

<script>
import PostGrid from '../components/PostGrid.vue';
import StorageService from '../services/StorageService';
import { postFilterMixin } from '../mixins/postFilterMixin';
import { useSettingsStore } from '../stores/settings';

export default {
  name: 'FavoritesView',
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
      this.loadFavorites();
    },
  },
  beforeRouteEnter(to, from, next) {
    next(vm => {
      vm.loadFavorites();
    });
  },
  methods: {
    async loadFavorites() {
      const favoritedInteractions = await StorageService.getInteractions('favorite');
      const allPosts = favoritedInteractions
        .filter(interaction => interaction.value > 0)
        .map(interaction => interaction.metadata.post);
      this.posts = await this.filterPostsBySettings(allPosts);
    },
    onPostClicked({ index }) {
      const post = this.posts[index];
      this.$router.push({
        name: 'Viewer',
        params: { source: 'favorites' },
        query: { start: index, postId: post?.id }
      });
    },
  },
};
</script> 