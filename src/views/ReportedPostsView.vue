<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div class="h-screen overflow-y-auto pb-16">
    <div class="relative flex items-center justify-center p-4 pb-0">
      <router-link
        to="/profile/settings"
        class="absolute left-0 text-pink-500 hover:text-pink-400 flex items-center gap-1"
      >
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        <span class="text-sm">Back</span>
      </router-link>
      <h1 class="text-2xl font-bold">Reported Posts</h1>
    </div>
    <div v-if="posts.length === 0" class="text-center text-gray-400 mt-16">
      <p>You haven't reported any posts.</p>
    </div>
    <PostGrid :posts="posts" @post-clicked="onPostClicked" />
  </div>
</template>

<script>
import PostGrid from '../components/PostGrid.vue';
import ReportService from '../services/ReportService';

export default {
  name: 'ReportedPostsView',
  components: {
    PostGrid,
  },
  data() {
    return {
      posts: [],
    };
  },
  beforeRouteEnter(to, from, next) {
    next(vm => {
      vm.loadReportedPosts();
    });
  },
  methods: {
    async loadReportedPosts() {
      // Intentionally not filtered by feed settings: this is a management view,
      // the user must be able to see everything they've reported
      this.posts = await ReportService.getReportedPosts();
    },
    onPostClicked({ index }) {
      const post = this.posts[index];
      this.$router.push({
        name: 'Viewer',
        params: { source: 'reported' },
        query: { start: index, postId: post?.id }
      });
    },
  },
};
</script>
