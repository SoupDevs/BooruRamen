<template>
  <div class="h-screen overflow-y-auto pb-16">
    <h1 class="text-2xl font-bold p-4">Likes</h1>
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