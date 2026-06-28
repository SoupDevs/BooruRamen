<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 DottsGit

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div class="p-4 text-white">
    <h1 class="text-2xl font-bold mb-8 text-center">Profile</h1>
    <div class="space-y-4 max-w-sm mx-auto">
      <router-link to="/history" class="block w-full text-center bg-gray-700 hover:bg-gray-600 py-3 rounded-md text-lg">
        History
      </router-link>
      <router-link to="/likes" class="block w-full text-center bg-gray-700 hover:bg-gray-600 py-3 rounded-md text-lg">
        Likes
      </router-link>
      <router-link to="/favorites" class="block w-full text-center bg-gray-700 hover:bg-gray-600 py-3 rounded-md text-lg">
        Favorites
      </router-link>
      <router-link to="/profile/settings" class="block w-full text-center bg-gray-700 hover:bg-gray-600 py-3 rounded-md text-lg">
        Profile Settings
      </router-link>
      <router-link to="/profile/analytics" class="block w-full text-center bg-gray-700 hover:bg-gray-600 py-3 rounded-md text-lg">
        Profile Analytics
      </router-link>
    </div>

    <!-- About/License Note -->
    <div class="mt-16 pb-8 text-center opacity-40">
      <p class="text-sm font-semibold text-gray-400">BooruRamen v{{ appVersion }}</p>
      <p class="text-xs text-gray-500 mt-1">
        Licensed under <span class="text-pink-500/80 uppercase">GPL-3.0</span>
      </p>
      <p class="text-[10px] text-gray-600 mt-2">© 2025 SoupDevs</p>
    </div>
  </div>
</template>

<script>/* global __APP_VERSION__ */
export default {
  name: 'ProfileView',
  computed: {
    appVersion() {
      return __APP_VERSION__;
    },
  },
};
</script>