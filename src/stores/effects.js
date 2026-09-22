import { defineStore } from 'pinia'
import { useSettingsStore } from './settings'
import { postKey } from '../services/postKey'

// A burst is visual feedback for one interaction: it is picked up by whichever
// view is showing that post and played once. Entries expire on their own so a
// burst for a post that is not on screen (scrolled out of the feed window,
// viewed from another route) can never animate later, when that row mounts.
const BURST_TTL_MS = 1200

let burstSequence = 0

export const useEffectsStore = defineStore('effects', {
    state: () => ({
        // post key -> { id, type }, where type is like | dislike | favorite
        bursts: {}
    }),

    actions: {
        /**
         * Ask for a burst over a post's media. The interaction buttons live in
         * App and the media lives inside the active view, so the request
         * travels through the store and the view renders whatever belongs to
         * the posts it is currently showing.
         */
        triggerBurst(post, type) {
            if (!post || !this.isBurstEnabled(type)) return

            const key = postKey(post)
            if (!key) return

            const id = ++burstSequence
            // Replaced rather than mutated: every view that asked for a burst
            // re-renders, whether or not its post has one yet.
            this.bursts = { ...this.bursts, [key]: { id, type } }

            setTimeout(() => {
                const current = this.bursts[key]
                if (!current || current.id !== id) return
                const next = { ...this.bursts }
                delete next[key]
                this.bursts = next
            }, BURST_TTL_MS)
        },

        /** Burst for a post, or null when there is nothing to play. */
        burstFor(post) {
            const key = postKey(post)
            return key ? this.bursts[key] || null : null
        },

        isBurstEnabled(type) {
            const settings = useSettingsStore()
            if (type === 'like') return settings.showLikeAnimation
            if (type === 'dislike') return settings.showDislikeAnimation
            if (type === 'favorite') return settings.showFavoriteAnimation
            return false
        }
    }
})