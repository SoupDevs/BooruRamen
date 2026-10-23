/*
 * BooruRamen - A personalized booru browser
 * Copyright (C) 2025 SoupDevs
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './assets/tailwind.css'
import router from './router'
import { cleanupPendingDeletes } from './services/ProfileService'
import { finishPendingVerification } from './services/cloudflareVerify'
import { startPlugins, setUiRouter } from './plugins'

// Retry profile database deletions that were interrupted by a reload
cleanupPendingDeletes()

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)
app.use(router)
setUiRouter(router)
// Coming back from a Cloudflare check: keep the clearance before the feed
// starts fetching, so its first requests already carry it. Plugins start
// before the feed too, so their hooks shape its first batch. Neither can
// keep the app from mounting.
Promise.allSettled([
  finishPendingVerification(),
  startPlugins()
    // Opened straight onto a plugin page: its route exists only now.
    .then(() => router.isReady())
    .then(() => { if (!router.currentRoute.value.matched.length) return router.replace(router.currentRoute.value.fullPath) })
    .catch(error => console.error('[Plugins] Start failed:', error)),
]).finally(() => app.mount('#app'))
