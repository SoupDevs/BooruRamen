<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div class="space-y-3">
    <p class="text-sm text-gray-400">
      Spotlight posts you've seen and liked, per tag. Change the tags under Profile → Plugins.
    </p>
    <div v-if="!rows.length" class="p-4 bg-gray-800 rounded-lg text-sm text-gray-400">
      Nothing yet. Add spotlight tags and scroll the feed.
    </div>
    <div v-for="row in rows" :key="row.tag" class="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
      <span class="font-medium">{{ row.tag }}</span>
      <span class="text-sm text-gray-400">{{ row.shown }} shown · {{ row.liked }} liked</span>
    </div>
    <button v-if="rows.length" type="button" class="text-sm px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600" @click="reset">Reset tally</button>
  </div>
</template>

<script>
/** The Tag Spotlight page: a bundled plugin can use a .vue file. */
export default {
  name: 'SpotlightStats',
  props: {
    api: { type: Object, required: true },
  },
  data() {
    return { tally: this.api.storage.get('tally', {}) };
  },
  computed: {
    rows() {
      return Object.entries(this.tally)
        .map(([tag, counts]) => ({ tag, ...counts }))
        .sort((a, b) => b.shown - a.shown);
    },
  },
  methods: {
    reset() {
      this.api.storage.remove('tally');
      this.tally = {};
    },
  },
};
</script>
