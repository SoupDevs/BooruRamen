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
    v-if="origin"
    class="fixed left-0 right-0 z-[70] flex justify-center px-4 pointer-events-none"
    :style="{ top: 'calc(0.75rem + env(safe-area-inset-top, 0))' }"
  >
    <div class="pointer-events-auto max-w-md w-full bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-4">
      <div class="flex items-start gap-3">
        <ShieldAlert class="w-5 h-5 text-pink-400 flex-shrink-0 mt-0.5" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold">{{ host }} wants a Cloudflare check</p>
          <p class="text-xs text-gray-400 mt-1">
            <template v-if="again">
              The last check didn't stick. It may have expired, or the site may not accept it from the app. If this keeps happening, try another VPN server.
            </template>
            <template v-else>
              Cloudflare is blocking the app, often because of a VPN. You can open the site here, complete the check, and the app will come back on its own.
            </template>
          </p>
          <div class="flex gap-2 mt-3">
            <button class="px-3 py-1.5 rounded bg-pink-600 hover:bg-pink-500 text-sm font-medium" @click="verify">
              Complete the check
            </button>
            <button class="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm" @click="dismiss">
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ShieldAlert } from 'lucide-vue-next';
import {
  cloudflareState,
  dismissCloudflareBlock,
  startCloudflareVerification,
  wasVerified,
} from '../services/cloudflareVerify.js';

export default {
  name: 'CloudflareVerifyBanner',
  components: { ShieldAlert },
  computed: {
    origin() {
      return cloudflareState.blocked[0] || null;
    },
    host() {
      try {
        return new URL(this.origin).host;
      } catch {
        return this.origin;
      }
    },
    again() {
      return wasVerified(this.origin);
    },
  },
  methods: {
    async verify() {
      try {
        await startCloudflareVerification(this.origin);
      } catch (e) {
        console.error('[Cloudflare] Could not open the check:', e);
      }
    },
    dismiss() {
      dismissCloudflareBlock(this.origin);
    },
  },
};
</script>
