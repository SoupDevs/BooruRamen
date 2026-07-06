import { defineStore } from 'pinia'
import StorageService from '../services/StorageService'
import { applyTheme, DEFAULT_CUSTOM_THEME } from '../services/ThemeService'

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
        // Tag query overrides: applied to every outgoing search query
        tagAlwaysInclude: [],
        tagNeverInclude: [],
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
        downloadSeparateFolders: true,
        // Age confirmation: stores DOB once verified
        confirmedDateOfBirth: null,
        // Theming: preset id ('default', 'blackwhite', 'terminal', 'claude')
        // or 'custom', in which case customTheme supplies colors and font
        theme: 'default',
        customTheme: { ...DEFAULT_CUSTOM_THEME },
        settingsVersion: 0,
        initialized: false
    }),

    actions: {
        async initialize() {
            if (this.initialized) return
            // Multiple callers (App + views) can race here on cold start; share one load
            if (this._initPromise) return this._initPromise
            this._initPromise = this._doInitialize()
            return this._initPromise
        },

        async _doInitialize() {
            const saved = await StorageService.loadAppSettings()

            if (saved) {
                this.$patch({
                    ...saved.settings,
                    debugMode: saved.settings && saved.settings.debugMode !== undefined ? saved.settings.debugMode : this.debugMode,
                    activeSource: saved.settings && saved.settings.activeSource ? saved.settings.activeSource : this.activeSource,
                    customSources: saved.settings && saved.settings.customSources ? saved.settings.customSources : this.customSources,
                    avoidedTags: saved.settings && saved.settings.avoidedTags ? saved.settings.avoidedTags : this.avoidedTags,
                    // Ratings are no longer user-configurable: always query general
                    ratings: ['general'],
                    tagAlwaysInclude: saved.settings && Array.isArray(saved.settings.tagAlwaysInclude) ? saved.settings.tagAlwaysInclude : this.tagAlwaysInclude,
                    tagNeverInclude: saved.settings && Array.isArray(saved.settings.tagNeverInclude) ? saved.settings.tagNeverInclude : this.tagNeverInclude,
                    downloadLocation: saved.settings && saved.settings.downloadLocation !== undefined ? saved.settings.downloadLocation : this.downloadLocation,
                    downloadLiked: saved.settings && saved.settings.downloadLiked !== undefined ? saved.settings.downloadLiked : this.downloadLiked,
                    downloadFavorited: saved.settings && saved.settings.downloadFavorited !== undefined ? saved.settings.downloadFavorited : this.downloadFavorited,
                    downloadSeparateFolders: saved.settings && saved.settings.downloadSeparateFolders !== undefined ? saved.settings.downloadSeparateFolders : this.downloadSeparateFolders,
                    confirmedDateOfBirth: saved.settings && saved.settings.confirmedDateOfBirth ? saved.settings.confirmedDateOfBirth : this.confirmedDateOfBirth,
                    theme: saved.settings && saved.settings.theme ? saved.settings.theme : this.theme,
                    customTheme: saved.settings && saved.settings.customTheme ? { ...DEFAULT_CUSTOM_THEME, ...saved.settings.customTheme } : this.customTheme
                })
            }

            applyTheme(this.theme, this.customTheme)
            this.initialized = true
        },

        updateSettings(partialSettings) {
            this.$patch(partialSettings)
            this.saveSettings()
        },

        setTagOverrides({ alwaysInclude, neverInclude }) {
            if (Array.isArray(alwaysInclude)) this.tagAlwaysInclude = alwaysInclude
            if (Array.isArray(neverInclude)) this.tagNeverInclude = neverInclude
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

        setTheme(themeId) {
            this.theme = themeId
            applyTheme(this.theme, this.customTheme)
            this.saveSettings()
        },

        setCustomThemeValue(key, value) {
            this.customTheme = { ...this.customTheme, [key]: value }
            if (this.theme === 'custom') {
                applyTheme(this.theme, this.customTheme)
            }
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
                    tagAlwaysInclude: this.tagAlwaysInclude,
                    tagNeverInclude: this.tagNeverInclude,
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
                    confirmedDateOfBirth: this.confirmedDateOfBirth,
                    theme: this.theme,
                    customTheme: { ...this.customTheme }
                }
            })
            this.settingsVersion++
        }
    }
})
