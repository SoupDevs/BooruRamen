import { defineStore } from 'pinia'
import StorageService from '../services/StorageService'
import RecommendationSystem, { deepDiveState } from '../services/RecommendationSystem'

export const useInteractionsStore = defineStore('interactions', {
    state: () => ({
        // We can keep a local cache of recent interactions if needed for reactivity
        // For now, these might be loaded on demand or we trust the components to check.
        // However, to make it truly reactive, we should probably keep track of the current view's posts interactions.
        // Storing ALL interactions in memory might be too much if there are 1000s, but 1000 items is fine.
        recentInteractions: [],
        initialized: false
    }),

    actions: {
        async initialize() {
            if (this.initialized) return
            this.recentInteractions = await StorageService.getInteractions()
            this.initialized = true
        },

        async logInteraction(interaction) {
            const diving = interaction.metadata?.deepDive ?? deepDiveState.active
            // Route real UI interactions through the session learner before
            // persistence; recording here separately would lose its weight.
            try {
                await RecommendationSystem.trackInteraction(interaction.postId, interaction.type, interaction.value, interaction.metadata?.post, false, { deepDive: diving })
            } catch (error) {
                console.warn('[Interactions] Session learner unavailable:', error.message)
                // A worker failure must not lose the user's explicit actions.
                await StorageService.storeInteraction({ ...interaction, metadata: { ...interaction.metadata, profileWeight: diving ? 0.015 : 0.15, deepDive: diving } })
            }

            // Update local state for reactivity
            const existingIndex = this.recentInteractions.findIndex(
                i => i.postId === interaction.postId && i.type === interaction.type && i.source === interaction.source
            )

            if (existingIndex > -1) {
                this.recentInteractions[existingIndex] = {
                    ...this.recentInteractions[existingIndex],
                    ...interaction,
                    timestamp: Date.now()
                }
            } else {
                this.recentInteractions.push({
                    ...interaction,
                    timestamp: Date.now()
                })
            }
        },

        getPostStatus(post) {
            // Helper to get all status flags for a post
            // This mimics the logic in App.vue updateCurrentPost
            if (!post) return { liked: false, disliked: false, favorited: false }

            // We can look at our local state instead of reading from storage again
            // filtering by postId. 
            // Note: StorageService.getPostInteractions just filters the full list.

            // Optimization: If we keep recentInteractions up to date, we can filter it.
            const interactions = this.recentInteractions.filter(i => i.postId === post.id)

            return {
                liked: interactions.some(i => i.type === 'like' && i.value > 0),
                disliked: interactions.some(i => i.type === 'dislike' && i.value > 0),
                favorited: interactions.some(i => i.type === 'favorite' && i.value > 0)
            }
        }
    }
})
