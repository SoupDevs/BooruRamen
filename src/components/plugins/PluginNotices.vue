<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div
    v-if="notices.length"
    class="fixed left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none px-4 w-full max-w-sm"
    :style="{ bottom: 'calc(5rem + env(safe-area-inset-bottom, 0))' }"
  >
    <div
      v-for="notice in notices"
      :key="notice.key"
      class="rounded-lg bg-black/80 text-white text-sm px-3 py-2 backdrop-blur-sm ring-1 ring-white/10 text-center break-words"
      role="status"
      data-plugin-notice
    >{{ notice.message }}</div>
  </div>
</template>

<script>
import { uiState } from '../../plugins/ui.js';

/** Notices plugins post with api.ui.notify(). */
export default {
  name: 'PluginNotices',
  computed: {
    notices() {
      return uiState.notices;
    },
  },
};
</script>
