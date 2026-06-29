import { defineStore } from 'pinia'
import StorageService from '../services/StorageService'

export const useSettingsStore = defineStore('settings', {
    state: () => ({
        // Default values - will be overwritten by initialize()
        autoScroll: false,
        autoScrollSeconds: 5,
        autoScrollWaitForVideo: true,
        autoScrollSpeed: 'medium',
        disableScrollAnimation: false,
        disableHistory: false,
        autoplayVideos: true,
        loopVideos: true,
        mediaType: { images: false, videos: true },
        ratings: ['general'],
        // Which ratings are enabled in profile settings (controls visibility in sidebar)
        enabledRatings: ['general'],
        whitelistTags: ['meme'],
        blacklistTags: [],
        activeSource: { type: 'danbooru', url: 'https://danbooru.donmai.us', name: 'Danbooru' },
        customSources: [],
        debugMode: false,
        avoidedTags: [],
        // Download settings
        downloadLocation: '~/Downloads/BooruRamen',
        downloadLiked: false,
        downloadFavorited: false,
        downloadSeparateFolders: false,
        // Age confirmation: stores DOB once verified
        confirmedDateOfBirth: null,
        settingsVersion: 0,
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
                    avoidedTags: saved.settings && saved.settings.avoidedTags ? saved.settings.avoidedTags : this.avoidedTags,
                    enabledRatings: saved.settings && saved.settings.enabledRatings ? saved.settings.enabledRatings : this.enabledRatings,
                    downloadLocation: saved.settings && saved.settings.downloadLocation !== undefined ? saved.settings.downloadLocation : this.downloadLocation,
                    downloadLiked: saved.settings && saved.settings.downloadLiked !== undefined ? saved.settings.downloadLiked : this.downloadLiked,
                    downloadFavorited: saved.settings && saved.settings.downloadFavorited !== undefined ? saved.settings.downloadFavorited : this.downloadFavorited,
                    downloadSeparateFolders: saved.settings && saved.settings.downloadSeparateFolders !== undefined ? saved.settings.downloadSeparateFolders : this.downloadSeparateFolders,
                    confirmedDateOfBirth: saved.settings && saved.settings.confirmedDateOfBirth ? saved.settings.confirmedDateOfBirth : this.confirmedDateOfBirth
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

        toggleEnabledRating(rating) {
            const index = this.enabledRatings.indexOf(rating)
            if (index > -1) {
                this.enabledRatings.splice(index, 1)
            } else {
                this.enabledRatings.push(rating)
            }
            // Sync: also toggle in active ratings
            const activeIndex = this.ratings.indexOf(rating)
            if (index > -1 && activeIndex > -1) {
                // Disabling: also turn off in sidebar
                this.ratings.splice(activeIndex, 1)
            } else if (index === -1 && activeIndex === -1) {
                // Enabling: auto-enable in sidebar too
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
            await StorageService.saveAppSettings({
                settings: {
                    autoScroll: this.autoScroll,
                    autoScrollSeconds: this.autoScrollSeconds,
                    autoScrollWaitForVideo: this.autoScrollWaitForVideo,
                    autoScrollSpeed: this.autoScrollSpeed,
                    disableScrollAnimation: this.disableScrollAnimation,
                    disableHistory: this.disableHistory,
                    autoplayVideos: this.autoplayVideos,
                    loopVideos: this.loopVideos,
                    mediaType: this.mediaType,
                    ratings: this.ratings,
                    enabledRatings: this.enabledRatings,
                    whitelistTags: this.whitelistTags,
                    blacklistTags: this.blacklistTags,
                    activeSource: this.activeSource,
                    customSources: this.customSources,
                    debugMode: this.debugMode,
                    avoidedTags: this.avoidedTags,
                    downloadLocation: this.downloadLocation,
                    downloadLiked: this.downloadLiked,
                    downloadFavorited: this.downloadFavorited,
                    downloadSeparateFolders: this.downloadSeparateFolders,
                    confirmedDateOfBirth: this.confirmedDateOfBirth
                }
            })
            this.settingsVersion++
        }
    }
})
