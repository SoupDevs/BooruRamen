<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div v-if="updater.showSplash" class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black bg-opacity-80 backdrop-blur-sm">
    <div class="bg-gray-800 rounded-lg max-w-sm w-full p-6 shadow-xl border border-gray-700">

      <!-- Checking -->
      <div v-if="updater.status === 'checking'">
        <div class="flex items-center gap-3 mb-2">
          <RefreshCw class="w-6 h-6 text-pink-400 animate-spin" />
          <h3 class="text-xl font-bold">Checking for updates…</h3>
        </div>
        <p class="text-gray-400 text-sm">You're on v{{ appVersion }}</p>
      </div>

      <!-- Update available -->
      <div v-else-if="updater.status === 'available'">
        <div class="flex items-start gap-3 mb-2">
          <div class="w-8 h-8 rounded-full bg-pink-600/20 flex items-center justify-center flex-shrink-0">
            <ArrowDownToLine class="w-5 h-5 text-pink-400" />
          </div>
          <h3 class="text-xl font-bold">Update available</h3>
        </div>
        <p class="text-gray-300 mb-3">
          BooruRamen v{{ updater.latestVersion }} is available. You're on v{{ updater.currentVersion }}.
        </p>
        <div v-if="updater.releaseNotes" class="bg-gray-900 rounded-md p-3 mb-4 max-h-40 overflow-y-auto">
          <p class="text-xs text-gray-400 whitespace-pre-wrap">{{ updater.releaseNotes }}</p>
        </div>
        <div class="flex gap-3">
          <button
            @click="updater.dismiss()"
            class="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white font-medium transition"
          >
            Ignore
          </button>
          <button
            @click="updater.installUpdate()"
            class="flex-1 px-4 py-2 bg-pink-600 hover:bg-pink-700 rounded text-white font-medium transition"
          >
            Update
          </button>
        </div>
      </div>

      <!-- Downloading -->
      <div v-else-if="updater.status === 'downloading'">
        <div class="flex items-center gap-3 mb-2">
          <ArrowDownToLine class="w-6 h-6 text-pink-400 animate-pulse" />
          <h3 class="text-xl font-bold">Downloading update…</h3>
        </div>
        <div class="relative h-2 bg-gray-700 rounded mt-4 mb-2 overflow-hidden">
          <div
            class="absolute top-0 left-0 h-full bg-pink-600 rounded transition-[width]"
            :style="{ width: `${downloadPercent}%` }"
          ></div>
        </div>
        <p class="text-gray-400 text-sm text-center">{{ downloadLabel }}</p>
      </div>

      <!-- Installing -->
      <div v-else-if="updater.status === 'installing'">
        <div class="flex items-center gap-3 mb-2">
          <RefreshCw class="w-6 h-6 text-pink-400 animate-spin" />
          <h3 class="text-xl font-bold">Installing update…</h3>
        </div>
        <p class="text-gray-300" :class="isAndroid ? 'mb-6' : ''">
          {{ isAndroid
            ? 'Follow the system prompts to finish installing the new version.'
            : 'The app will close while the update installs, then reopen automatically.' }}
        </p>
        <!-- On Android the app stays open behind the system installer, so the
             user needs a way back if they cancel the install. -->
        <button
          v-if="isAndroid"
          @click="updater.dismiss()"
          class="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white font-medium transition"
        >
          Close
        </button>
      </div>

      <!-- Install blocked until the user allows it -->
      <div v-else-if="updater.status === 'permissionRequired'">
        <div class="flex items-start gap-3 mb-2">
          <div class="w-8 h-8 rounded-full bg-amber-600/20 flex items-center justify-center flex-shrink-0">
            <ShieldAlert class="w-5 h-5 text-amber-400" />
          </div>
          <h3 class="text-xl font-bold">Allow installs to continue</h3>
        </div>
        <p class="text-gray-300 mb-3">
          Android will not open the installer until you allow installs from
          BooruRamen. The update is already downloaded, so just turn it on and
          come back.
        </p>
        <div class="flex flex-col gap-3">
          <button
            @click="updater.openInstallPermissionSettings()"
            class="w-full px-4 py-2 bg-pink-600 hover:bg-pink-700 rounded text-white font-medium transition"
          >
            Open settings
          </button>
          <button
            @click="updater.installUpdate()"
            class="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white font-medium transition"
          >
            Try again
          </button>
          <button
            @click="updater.dismiss()"
            class="w-full px-4 py-2 text-gray-400 hover:text-gray-200 text-sm transition"
          >
            Close
          </button>
        </div>
      </div>

      <!-- Up to date -->
      <div v-else-if="updater.status === 'upToDate'">
        <div class="flex items-start gap-3 mb-2">
          <div class="w-8 h-8 rounded-full bg-green-600/20 flex items-center justify-center flex-shrink-0">
            <Check class="w-5 h-5 text-green-400" />
          </div>
          <h3 class="text-xl font-bold">You're up to date</h3>
        </div>
        <p class="text-gray-300 mb-6">BooruRamen v{{ updater.currentVersion || appVersion }} is the latest version.</p>
        <button
          @click="updater.dismiss()"
          class="w-full px-4 py-2 bg-pink-600 hover:bg-pink-700 rounded text-white font-medium transition"
        >
          OK
        </button>
      </div>

      <!-- Error -->
      <div v-else-if="updater.status === 'error'">
        <div class="flex items-start gap-3 mb-2">
          <div class="w-8 h-8 rounded-full bg-red-600/20 flex items-center justify-center flex-shrink-0">
            <AlertCircle class="w-5 h-5 text-red-400" />
          </div>
          <h3 class="text-xl font-bold">Update failed</h3>
        </div>
        <p class="text-gray-300 mb-3">{{ updater.error || 'Something went wrong while updating.' }}</p>
        <p v-if="updater.releaseUrl" class="text-gray-400 text-sm mb-6 break-all">
          You can download the latest release manually from {{ updater.releaseUrl }}
        </p>
        <button
          @click="updater.dismiss()"
          class="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white font-medium transition"
        >
          Close
        </button>
      </div>

    </div>
  </div>
</template>

<script>/* global __APP_VERSION__ */
import { RefreshCw, ArrowDownToLine, Check, AlertCircle, ShieldAlert } from 'lucide-vue-next';
import { useUpdaterStore } from '../stores/updater';
import { isAndroid } from '../services/DownloadService';

export default {
  name: 'UpdateSplash',
  components: { RefreshCw, ArrowDownToLine, Check, AlertCircle, ShieldAlert },
  computed: {
    updater() {
      return useUpdaterStore();
    },
    appVersion() {
      return __APP_VERSION__;
    },
    isAndroid() {
      return isAndroid();
    },
    downloadPercent() {
      const progress = this.updater.progress;
      if (!progress || !progress.total) return 0;
      return Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
    },
    downloadLabel() {
      const progress = this.updater.progress;
      if (!progress || !progress.total) return 'Starting download…';
      return `${this.formatSize(progress.downloaded)} of ${this.formatSize(progress.total)} (${this.downloadPercent}%)`;
    },
  },
  methods: {
    formatSize(bytes) {
      if (!bytes) return '0 MB';
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    },
  },
};
</script>
