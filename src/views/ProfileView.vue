<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 DottsGit

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div class="p-4 text-white h-full overflow-y-auto">
    <h1 class="text-2xl font-bold mb-8 text-center">Profile</h1>

    <div class="max-w-2xl mx-auto space-y-2">
      <router-link
        to="/history"
        class="w-full flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors group"
      >
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-purple-600/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <div class="text-left">
            <div class="font-medium">History</div>
            <div class="text-xs text-gray-400">Posts you've viewed</div>
          </div>
        </div>
        <svg viewBox="0 0 24 24" class="w-5 h-5 text-gray-500 group-hover:text-gray-300" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </router-link>

      <router-link
        to="/likes"
        class="w-full flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors group"
      >
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-pink-600/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" class="w-5 h-5 text-pink-400" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
            </svg>
          </div>
          <div class="text-left">
            <div class="font-medium">Likes</div>
            <div class="text-xs text-gray-400">Posts you've liked</div>
          </div>
        </div>
        <svg viewBox="0 0 24 24" class="w-5 h-5 text-gray-500 group-hover:text-gray-300" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </router-link>

      <router-link
        to="/favorites"
        class="w-full flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors group"
      >
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-yellow-600/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" class="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/>
            </svg>
          </div>
          <div class="text-left">
            <div class="font-medium">Favorites</div>
            <div class="text-xs text-gray-400">Posts you've favorited</div>
          </div>
        </div>
        <svg viewBox="0 0 24 24" class="w-5 h-5 text-gray-500 group-hover:text-gray-300" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </router-link>

      <router-link
        to="/profile/settings"
        class="w-full flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors group"
      >
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.585 2.071.436 2.573-1.066z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </div>
          <div class="text-left">
            <div class="font-medium">Profile Settings</div>
            <div class="text-xs text-gray-400">Content, downloads, advanced</div>
          </div>
        </div>
        <svg viewBox="0 0 24 24" class="w-5 h-5 text-gray-500 group-hover:text-gray-300" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </router-link>

      <router-link
        to="/profile/analytics"
        class="w-full flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors group"
      >
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-green-600/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
            </svg>
          </div>
          <div class="text-left">
            <div class="font-medium">Profile Analytics</div>
            <div class="text-xs text-gray-400">Recommendation insights</div>
          </div>
        </div>
        <svg viewBox="0 0 24 24" class="w-5 h-5 text-gray-500 group-hover:text-gray-300" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </router-link>
    </div>

    <!-- About/License Note -->
    <div class="mt-16 pb-8 text-center opacity-40">
      <p class="text-sm font-semibold text-gray-400">BooruRamen v{{ appVersion }}</p>
      <p class="text-xs text-gray-500 mt-1">
        Licensed under <span class="text-pink-500/80 uppercase">GPL-3.0</span>
      </p>
      <p class="text-[10px] text-gray-600 mt-2">&copy; 2025 SoupDevs</p>
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
