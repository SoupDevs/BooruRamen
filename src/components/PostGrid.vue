<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 p-4">
    <div 
      v-for="(post, index) in posts" 
      :key="post.id" 
      class="relative aspect-square bg-gray-800 rounded-lg overflow-hidden cursor-pointer"
      @click="emitPostClick(post, index)"
    >
      <BooruImage :src="post.preview_file_url || post.file_url" :alt="post.tag_string" class="w-full h-full object-cover" />
    </div>
  </div>
</template>

<script>
import BooruImage from './BooruImage.vue';

export default {
  name: 'PostGrid',
  components: {
    BooruImage,
  },
  props: {
    posts: {
      type: Array,
      required: true,
    },
  },
  methods: {
    emitPostClick(post, index) {
      this.$emit('post-clicked', { post, index });
    },
  },
};
</script>
