import { defineStore } from 'pinia'
import StorageService from '../services/StorageService'

export const useSettingsStore = defineStore('settings', {
    state: () => ({
        // Default values - will be overwritten by initialize()
        autoScroll: false,
        autoScrollSeconds: 5,
        autoScrollSpeed: 'medium',
        disableHistory: false,
        autoplayVideos: true,
        mediaType: { images: true, videos: true },
        ratings: ['general'],
        whitelistTags: [],
        blacklistTags: [],
        activeSource: { type: 'danbooru', url: 'https://danbooru.donmai.us', name: 'Danbooru' },
        customSources: [],
        debugMode: false,
        avoidedTags: [],
        initialized: false
    }),

    actions: {
        async initialize() {
            if (this.initialized) return

            const saved = await StorageService.loadAppSettings()

            if (saved) {
                this.$patch({
                    ...saved.settings,
                    debugMode: saved.settings && saved.settings.debugMode !== undefined ? saved.settings.debugMode : this.debugMode,
                    activeSource: saved.settings && saved.settings.activeSource ? saved.settings.activeSource : this.activeSource,
                    customSources: saved.settings && saved.settings.customSources ? saved.settings.customSources : this.customSources,
                    avoidedTags: saved.settings && saved.settings.avoidedTags ? saved.settings.avoidedTags : this.avoidedTags
                })
            }

            this.initialized = true
        },

        updateSettings(partialSettings) {
            this.$patch(partialSettings)
            this.saveSettings()
        },

        toggleRating(rating) {
            const index = this.ratings.indexOf(rating)
            if (index > -1) {
                this.ratings.splice(index, 1)
            } else {
                this.ratings.push(rating)
            }
            this.saveSettings()
        },

        addWhitelistTag(tag) {
            if (tag && !this.whitelistTags.includes(tag)) {
                this.whitelistTags.push(tag)
                this.saveSettings()
            }
        },

        removeWhitelistTag(index) {
            this.whitelistTags.splice(index, 1)
            this.saveSettings()
        },

        addBlacklistTag(tag) {
            if (tag && !this.blacklistTags.includes(tag)) {
                this.blacklistTags.push(tag)
                this.saveSettings()
            }
        },

        removeBlacklistTag(index) {
            this.blacklistTags.splice(index, 1)
            this.saveSettings()
        },

        setMediaType(type, value) {
            this.mediaType[type] = value
            this.saveSettings()
        },

        async saveSettings() {
            // Debounce could be added here if needed, but for now direct save is okay 
            // as interactions aren't super high frequency (like scroll)
            await StorageService.saveAppSettings({
                settings: {
                    autoScroll: this.autoScroll,
                    autoScrollSeconds: this.autoScrollSeconds,
                    autoScrollSpeed: this.autoScrollSpeed,
                    disableHistory: this.disableHistory,
                    autoplayVideos: this.autoplayVideos,
                    mediaType: this.mediaType,
                    ratings: this.ratings,
                    whitelistTags: this.whitelistTags,
                    blacklistTags: this.blacklistTags,
                    activeSource: this.activeSource,
                    customSources: this.customSources,
                    debugMode: this.debugMode,
                    avoidedTags: this.avoidedTags
                }
            })
        }
    }
})
