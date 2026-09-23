<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div class="p-4 text-white h-full overflow-y-auto">
    <!-- Header with back button and centered title -->
    <div class="relative flex items-center justify-center mb-6">
      <button
        v-if="navigationStack.length > 0"
        @click="goBack"
        class="absolute left-0 text-pink-500 hover:text-pink-400 flex items-center gap-1"
      >
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        <span class="text-sm">Back</span>
      </button>
      <router-link
        v-else
        to="/profile"
        class="absolute left-0 text-pink-500 hover:text-pink-400 flex items-center gap-1"
      >
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        <span class="text-sm">Profile</span>
      </router-link>
      <h1 class="text-xl font-bold">{{ currentTitle }}</h1>
    </div>

    <!-- Main content area with transition -->
    <div class="max-w-2xl mx-auto">
      <transition :name="slideDirection" mode="out-in">
        <!-- Root: Category List -->
        <div v-if="currentPage === 'root'" key="root">
          <div class="space-y-2">
            <button
              @click="navigateTo('ui')"
              class="w-full flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors group"
            >
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-purple-600/20 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2a10 10 0 100 20 2 2 0 002-2v-1a2 2 0 012-2h1a5 5 0 005-5c0-5.523-4.477-10-10-10z"/>
                    <circle cx="7.5" cy="11.5" r="1"/>
                    <circle cx="10.5" cy="7" r="1"/>
                    <circle cx="15" cy="7.5" r="1"/>
                  </svg>
                </div>
                <div class="text-left">
                  <div class="font-medium">UI</div>
                  <div class="text-xs text-gray-400">Theme, colors, gestures</div>
                </div>
              </div>
              <svg viewBox="0 0 24 24" class="w-5 h-5 text-gray-500 group-hover:text-gray-300" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>

            <button
              @click="navigateTo('content')"
              class="w-full flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors group"
            >
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-pink-600/20 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" class="w-5 h-5 text-pink-400" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                  </svg>
                </div>
                <div class="text-left">
                  <div class="font-medium">Content</div>
                  <div class="text-xs text-gray-400">Sources, tags, query overrides</div>
                </div>
              </div>
              <svg viewBox="0 0 24 24" class="w-5 h-5 text-gray-500 group-hover:text-gray-300" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>

            <button
              @click="navigateTo('download')"
              class="w-full flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors group"
            >
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                  </svg>
                </div>
                <div class="text-left">
                  <div class="font-medium">Download</div>
                  <div class="text-xs text-gray-400">Save location, auto-download</div>
                </div>
              </div>
              <svg viewBox="0 0 24 24" class="w-5 h-5 text-gray-500 group-hover:text-gray-300" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>

            <button
              @click="navigateTo('advanced')"
              class="w-full flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors group"
            >
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-yellow-600/20 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" class="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.585 2.071.436 2.573-1.066z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </div>
                <div class="text-left">
                  <div class="font-medium">Advanced</div>
                  <div class="text-xs text-gray-400">Debug, history, clear data</div>
                </div>
              </div>
              <svg viewBox="0 0 24 24" class="w-5 h-5 text-gray-500 group-hover:text-gray-300" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- UI Settings -->
        <div v-else-if="currentPage === 'ui'" key="ui">
          <div class="space-y-4">
            <!-- Theme selector & customizer -->
            <div class="p-4 bg-gray-800 rounded-lg">
              <div class="mb-3">
                <label class="font-medium">Theme</label>
                <p class="text-xs text-gray-400 mt-1">
                  Pick a preset, or build your own with custom colors and fonts.
                  Changes apply instantly.
                </p>
              </div>

              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="preset in themePresets"
                  :key="preset.id"
                  @click="selectTheme(preset.id)"
                  class="rounded-lg border p-3 text-left transition-colors"
                  :class="theme === preset.id ? 'border-pink-500 ring-1 ring-pink-500' : 'border-gray-700 hover:border-gray-500'"
                >
                  <div
                    class="h-10 rounded flex items-center justify-between px-2 mb-2 border"
                    :style="{ backgroundColor: preset.preview.bg, borderColor: preset.preview.border }"
                  >
                    <span
                      class="text-sm font-bold"
                      :style="{ color: preset.preview.text, fontFamily: preset.preview.font }"
                    >Aa</span>
                    <span class="flex gap-1">
                      <span class="w-3 h-3 rounded-full" :style="{ backgroundColor: preset.preview.accent }"></span>
                      <span class="w-3 h-3 rounded-full border" :style="{ backgroundColor: preset.preview.surface, borderColor: preset.preview.border }"></span>
                    </span>
                  </div>
                  <div class="text-sm font-medium">{{ preset.label }}</div>
                  <div class="text-xs text-gray-400">{{ preset.description }}</div>
                </button>
              </div>

              <!-- Custom theme editor -->
              <div v-if="theme === 'custom'" class="mt-4 pt-4 border-t border-gray-700 space-y-3">
                <div
                  v-for="field in customColorFields"
                  :key="field.key"
                  class="flex items-center justify-between"
                >
                  <div>
                    <label class="text-sm font-medium">{{ field.label }}</label>
                    <p class="text-xs text-gray-500">{{ field.hint }}</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-gray-400 font-mono uppercase">{{ customTheme[field.key] }}</span>
                    <input
                      type="color"
                      :value="customTheme[field.key]"
                      @input="setCustomThemeValue(field.key, $event.target.value)"
                      class="w-9 h-9 rounded cursor-pointer bg-transparent border border-gray-600"
                    />
                  </div>
                </div>

                <div class="flex items-center justify-between">
                  <div>
                    <label class="text-sm font-medium">Font</label>
                    <p class="text-xs text-gray-500">Used across the whole app</p>
                  </div>
                  <select
                    :value="customTheme.font"
                    @change="setCustomThemeValue('font', $event.target.value)"
                    class="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:border-pink-500 focus:outline-none"
                  >
                    <option v-for="font in fontOptions" :key="font.id" :value="font.id">{{ font.label }}</option>
                  </select>
                </div>

                <div class="flex justify-end">
                  <button
                    @click="resetCustomTheme"
                    class="text-sm text-gray-400 hover:text-white underline"
                  >
                    Reset custom theme
                  </button>
                </div>
              </div>
            </div>

            <!-- Gestures & animations -->
            <div class="p-4 bg-gray-800 rounded-lg">
              <div class="mb-3">
                <label class="font-medium">Feed Buttons, Gestures &amp; Animations</label>
                <p class="text-xs text-gray-400 mt-1">
                  Choose which action buttons the feed shows, which gestures are armed —
                  every gesture and button works on its own, there is no master mode —
                  and the feedback drawn over a post's media.
                </p>
              </div>

              <div class="space-y-2">
                <!-- Action buttons shown in the feed's right-hand column -->
                <p class="text-xs text-gray-500 font-semibold uppercase tracking-wide px-3 pt-1">Action buttons</p>
                <div
                  v-for="option in feedButtonOptions"
                  :key="option.key"
                  class="flex items-center justify-between p-3 rounded-lg bg-gray-900 cursor-pointer hover:bg-gray-750"
                  :data-button-toggle="option.key"
                  @click="toggleInteraction(option.key)"
                >
                  <div class="flex flex-col">
                    <label class="text-sm font-medium cursor-pointer">{{ option.label }}</label>
                    <span class="text-xs text-gray-400">{{ option.hint }}</span>
                  </div>
                  <div
                    class="relative inline-flex h-6 w-11 items-center rounded-full"
                    :class="isInteractionEnabled(option.key) ? 'bg-pink-600' : 'bg-gray-600'"
                  >
                    <span
                      class="inline-block h-4 w-4 transform rounded-full bg-white transition"
                      :class="isInteractionEnabled(option.key) ? 'translate-x-6' : 'translate-x-1'"
                    ></span>
                  </div>
                </div>

                <!-- Feed gestures, each independently armed -->
                <p class="text-xs text-gray-500 font-semibold uppercase tracking-wide px-3 pt-2">Gestures</p>
                <div
                  v-for="option in feedGestureOptions"
                  :key="option.key"
                  class="flex items-center justify-between p-3 rounded-lg bg-gray-900 cursor-pointer hover:bg-gray-750"
                  :data-gesture-toggle="option.key"
                  @click="toggleInteraction(option.key)"
                >
                  <div class="flex flex-col">
                    <label class="text-sm font-medium cursor-pointer">{{ option.label }}</label>
                    <span class="text-xs text-gray-400">{{ option.hint }}</span>
                  </div>
                  <div
                    class="relative inline-flex h-6 w-11 items-center rounded-full"
                    :class="isInteractionEnabled(option.key) ? 'bg-pink-600' : 'bg-gray-600'"
                  >
                    <span
                      class="inline-block h-4 w-4 transform rounded-full bg-white transition"
                      :class="isInteractionEnabled(option.key) ? 'translate-x-6' : 'translate-x-1'"
                    ></span>
                  </div>
                </div>

                <!-- Feedback animations over a post's media -->
                <p class="text-xs text-gray-500 font-semibold uppercase tracking-wide px-3 pt-2">Feedback animations</p>
                <div
                  v-for="option in interactionOptions"
                  :key="option.key"
                  class="flex items-center justify-between p-3 rounded-lg bg-gray-900 cursor-pointer hover:bg-gray-750"
                  @click="toggleInteraction(option.key)"
                >
                  <div class="flex flex-col">
                    <label class="text-sm font-medium cursor-pointer">{{ option.label }}</label>
                    <span class="text-xs text-gray-400">{{ option.hint }}</span>
                  </div>
                  <div
                    class="relative inline-flex h-6 w-11 items-center rounded-full"
                    :class="isInteractionEnabled(option.key) ? 'bg-pink-600' : 'bg-gray-600'"
                  >
                    <span
                      class="inline-block h-4 w-4 transform rounded-full bg-white transition"
                      :class="isInteractionEnabled(option.key) ? 'translate-x-6' : 'translate-x-1'"
                    ></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Content Settings -->
        <div v-else-if="currentPage === 'content'" key="content">
          <div class="space-y-2">
            <!-- Sources (navigate to sub-page) -->
            <button
              @click="navigateTo('sources')"
              class="w-full flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors group"
            >
              <div class="text-left">
                <div class="font-medium">Sources</div>
                <div class="text-xs text-gray-400">Select booru sources to search from</div>
              </div>
              <svg viewBox="0 0 24 24" class="w-5 h-5 text-gray-500 group-hover:text-gray-300" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>

            <!-- Reported & Blocked (navigate to sub-page) -->
            <button
              @click="navigateTo('reported')"
              class="w-full flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors group"
            >
              <div class="text-left">
                <div class="font-medium">Reported &amp; Blocked</div>
                <div class="text-xs text-gray-400">Reported posts, artists, and uploaders</div>
              </div>
              <svg viewBox="0 0 24 24" class="w-5 h-5 text-gray-500 group-hover:text-gray-300" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>

            <!-- Avoided Query Tags (inline, no sub-page) -->
            <div class="p-4 bg-gray-800 rounded-lg">
              <div class="mb-2">
                <label class="font-medium">Avoided Query Tags</label>
                <p class="text-xs text-gray-400 mt-1">
                  These tags are excluded from search queries to prevent generic results.
                  Separate with spaces.
                </p>
              </div>
              <textarea
                v-model="avoidedTagsInput"
                class="w-full h-32 bg-gray-900 border border-gray-700 rounded p-2 text-sm text-gray-200 focus:border-pink-500 focus:outline-none mb-3"
                placeholder="e.g. 1girl, solo, comic..."
                @keydown.space.stop
              ></textarea>
              <div class="flex justify-between items-center">
                <button
                  @click="resetAvoidedTags"
                  class="text-sm text-gray-400 hover:text-white underline"
                >
                  Reset to Defaults
                </button>
                <button
                  @click="saveAvoidedTags"
                  class="px-4 py-2 bg-pink-600 hover:bg-pink-700 rounded text-white text-sm font-medium transition"
                >
                  Save Tags
                </button>
              </div>
              <p v-if="saveMessage" class="text-green-400 text-xs mt-2 text-right">{{ saveMessage }}</p>
            </div>

            <!-- Tag Query Overrides (inline, no sub-page) -->
            <div class="p-4 bg-gray-800 rounded-lg">
              <div class="mb-3">
                <label class="font-medium">Tag Query Overrides</label>
                <p class="text-xs text-gray-400 mt-1">
                  Modify every search query right before it is sent to the booru source.
                  Separate tags with spaces.
                </p>
              </div>
              <div class="mb-3">
                <label class="text-sm font-medium">Always Include</label>
                <p class="text-xs text-gray-500 mt-0.5 mb-1">Added to the query if not already present.</p>
                <textarea
                  v-model="alwaysIncludeInput"
                  class="w-full h-16 bg-gray-900 border border-gray-700 rounded p-2 text-sm text-gray-200 focus:border-pink-500 focus:outline-none"
                  placeholder="e.g. meme animated..."
                  @keydown.space.stop
                ></textarea>
              </div>
              <div class="mb-3">
                <label class="text-sm font-medium">Never Include</label>
                <p class="text-xs text-gray-500 mt-0.5 mb-1">Removed from the query before it is sent.</p>
                <textarea
                  v-model="neverIncludeInput"
                  class="w-full h-16 bg-gray-900 border border-gray-700 rounded p-2 text-sm text-gray-200 focus:border-pink-500 focus:outline-none"
                  placeholder="e.g. meme comic..."
                  @keydown.space.stop
                ></textarea>
              </div>
              <div class="flex justify-end">
                <button
                  @click="saveTagOverrides"
                  class="px-4 py-2 bg-pink-600 hover:bg-pink-700 rounded text-white text-sm font-medium transition"
                >
                  Save Overrides
                </button>
              </div>
              <p v-if="overrideSaveMessage" class="text-green-400 text-xs mt-2 text-right">{{ overrideSaveMessage }}</p>
            </div>
          </div>
        </div>

        <!-- Sources Sub-page -->
        <div v-else-if="currentPage === 'sources'" key="sources">
          <div class="space-y-4">
            <div class="p-4 bg-gray-800 rounded-lg">
              <h2 class="text-lg font-medium mb-3">Booru Sources</h2>
              <p class="text-xs text-gray-400 mb-4">Select one or more sources to search from. Aggregating multiple sources may be slower.</p>

              <div class="space-y-2 mb-4">
                <!-- Predefined Sources -->
                <div v-for="source in predefinedSources" :key="source.name">
                  <div class="mb-2">
                    <div class="flex items-center justify-between bg-gray-900 p-2 rounded">
                      <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full flex-shrink-0" :class="getStatusClass(source.url)"></span>
                        <span class="text-sm font-medium">{{ source.name }}</span>
                        <span class="text-xs text-gray-500">({{ source.type }})</span>
                        <span v-if="!supportsVideo(source)" class="text-xs text-yellow-400 italic">Images Only</span>
                        <span v-if="requiresAuth(source)" class="text-xs text-yellow-400 italic">API Auth Required</span>
                      </div>
                      <div class="flex items-center gap-3">
                        <button
                          v-if="showAuthButton(source)"
                          @click="toggleAuth(source)"
                          class="text-gray-500 hover:text-white"
                          :class="getAuthClass(source.url)"
                          title="Configure Authentication"
                        >
                          <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                          </svg>
                        </button>
                        <button
                          @click="toggleSource(source)"
                          class="w-5 h-5 rounded border flex items-center justify-center transition-colors"
                          :class="isSourceActive(source) ? 'bg-pink-600 border-pink-600' : 'border-gray-600 hover:border-gray-500'"
                        >
                          <svg v-if="isSourceActive(source)" viewBox="0 0 24 24" class="w-3 h-3 fill-white" stroke="currentColor" stroke-width="3">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div v-if="editingAuth === source.url" class="bg-gray-800 p-2 rounded mt-2 text-xs space-y-2 border border-gray-700">
                      <p class="text-gray-400">Authentication (Optional)</p>
                      <input v-model="source.userId" placeholder="User ID" class="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white" />
                      <input v-model="source.apiKey" placeholder="API Key" type="password" class="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white" />
                      <div class="flex justify-end mt-2">
                        <button
                          @click="testAuth(source)"
                          class="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-xs transition-colors"
                          :disabled="isTestingAuth"
                        >
                          <span v-if="isTestingAuth">Testing...</span>
                          <span v-else>Test Authentication</span>
                          <Check v-if="authTestResult && authTestResult.url === source.url && authTestResult.success" class="w-3 h-3 text-green-500" />
                          <AlertCircle v-if="authTestResult && authTestResult.url === source.url && !authTestResult.success" class="w-3 h-3 text-red-500" />
                        </button>
                      </div>
                      <p v-if="authTestResult && authTestResult.url === source.url" class="text-xs mt-1" :class="authTestResult.success ? 'text-green-400' : 'text-red-400'">
                        {{ authTestResult.message }}
                      </p>
                    </div>
                  </div>
                </div>

                <!-- Custom Sources -->
                <div v-for="(source, idx) in customSources" :key="source.name + idx">
                  <div class="flex items-center justify-between bg-gray-900 p-2 rounded relative group">
                    <div class="flex items-center gap-2">
                      <span class="w-2 h-2 rounded-full flex-shrink-0" :class="getStatusClass(source.url)"></span>
                      <span class="text-sm font-medium">{{ source.name }}</span>
                      <span class="text-xs text-gray-500">({{ source.type }})</span>
                      <span v-if="!supportsVideo(source)" class="text-xs text-yellow-400 italic">Images Only</span>
                    </div>
                    <div class="flex items-center gap-3">
                      <!-- Same key affordance as the built-in sources: a custom booru
                           may want credentials even when the engine's free tier
                           works without them. -->
                      <button
                        @click="toggleAuth(source)"
                        class="text-gray-500 hover:text-white"
                        :class="getAuthClass(source.url)"
                        title="Configure Authentication"
                      >
                        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                        </svg>
                      </button>
                      <button
                        @click="toggleSource(source)"
                        class="w-5 h-5 rounded border flex items-center justify-center transition-colors"
                        :class="isSourceActive(source) ? 'bg-pink-600 border-pink-600' : 'border-gray-600 hover:border-gray-500'"
                      >
                        <svg v-if="isSourceActive(source)" viewBox="0 0 24 24" class="w-3 h-3 fill-white" stroke="currentColor" stroke-width="3">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </button>
                      <button @click="removeCustomSource(idx)" class="text-gray-500 hover:text-red-500">
                        <X class="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div v-if="editingAuth === source.url" class="bg-gray-800 p-2 rounded mt-2 mb-2 text-xs space-y-2 border border-gray-700">
                    <p class="text-gray-400">Authentication (Optional)</p>
                    <input v-model="source.userId" placeholder="User ID" class="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white" />
                    <input v-model="source.apiKey" placeholder="API Key" type="password" class="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white" />
                    <div class="flex justify-end mt-2">
                      <button
                        @click="testAuth(source)"
                        class="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-xs transition-colors"
                        :disabled="isTestingAuth"
                      >
                        <span v-if="isTestingAuth">Testing...</span>
                        <span v-else>Test Authentication</span>
                        <Check v-if="authTestResult && authTestResult.url === source.url && authTestResult.success" class="w-3 h-3 text-green-500" />
                        <AlertCircle v-if="authTestResult && authTestResult.url === source.url && !authTestResult.success" class="w-3 h-3 text-red-500" />
                      </button>
                    </div>
                    <p v-if="authTestResult && authTestResult.url === source.url" class="text-xs mt-1" :class="authTestResult.success ? 'text-green-400' : 'text-red-400'">
                      {{ authTestResult.message }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Add Custom Source -->
              <button
                @click="showAddSource = !showAddSource"
                class="text-xs text-pink-500 hover:text-pink-400 mb-2 block"
              >
                {{ showAddSource ? '- Cancel' : '+ Add Custom Source' }}
              </button>

              <div v-if="showAddSource" class="bg-gray-900 p-3 rounded mb-3 space-y-2">
                <input v-model="newSource.name" placeholder="Name (e.g. MyBooru)" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-white" />
                <input v-model="newSource.url" placeholder="URL (e.g. https://site.com)" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-white" />
                <div class="flex gap-2">
                  <select v-model="newSource.type" class="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-white">
                    <option value="danbooru">Danbooru Type</option>
                    <option value="gelbooru">Gelbooru Type</option>
                    <option value="moebooru">Moebooru Type</option>
                  </select>
                  <!-- Probes the URL for a recognizable API and selects the
                       matching engine in the dropdown above. -->
                  <button
                    @click="detectSourceEngine"
                    class="flex items-center justify-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-white transition-colors whitespace-nowrap"
                    :disabled="isDetectingEngine || !newSource.url"
                  >
                    <svg v-if="isDetectingEngine" class="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    <span>{{ isDetectingEngine ? 'Detecting...' : 'Auto-detect' }}</span>
                  </button>
                </div>
                <p v-if="engineDetectError" class="text-xs text-red-400">{{ engineDetectError }}</p>
                <p v-if="engineDetectSuccess" class="text-xs text-green-400">{{ engineDetectSuccess }}</p>
                <button @click="addCustomSource" class="w-full bg-pink-600 hover:bg-pink-700 text-white rounded py-1.5 text-xs font-medium">Add Source</button>
              </div>

              <div class="flex justify-between items-center mt-4">
                <span class="text-green-400 text-xs">{{ sourceSaveMessage }}</span>
                <div class="flex gap-2">
                  <button @click="testConnection" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white text-sm font-medium transition">
                    Test Authentication (All Sources)
                  </button>
                  <button @click="saveSources" class="px-4 py-2 bg-pink-600 hover:bg-pink-700 rounded text-white text-sm font-medium transition">
                    Save Sources
                  </button>
                </div>
              </div>

              <!-- Connection Test Results -->
              <div v-if="testResults.length > 0" class="mt-4 p-3 bg-gray-900 rounded border border-gray-700">
                <h4 class="text-sm font-bold text-gray-300 mb-2">Authentication Test Results</h4>
                <div v-for="(res, idx) in testResults" :key="idx" class="flex items-start gap-2 mb-1 last:mb-0 text-xs">
                  <Check v-if="res.success" class="text-green-500 w-4 h-4 mt-0.5" />
                  <X v-else class="text-red-500 w-4 h-4 mt-0.5" />
                  <div>
                    <span class="font-bold text-gray-400">{{ res.source }}: </span>
                    <span :class="res.success ? 'text-green-400' : 'text-red-400'">{{ res.message }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Reported & Blocked Sub-page -->
        <div v-else-if="currentPage === 'reported'" key="reported">
          <div class="space-y-4">
            <!-- Reported Posts -->
            <router-link
              to="/reported"
              class="w-full flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors group"
            >
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-red-600/20 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 21v-4a4 4 0 014-4h10M3 3v4a4 4 0 004 4h10M14 3l7 7-7 7"/>
                  </svg>
                </div>
                <div class="text-left">
                  <div class="font-medium">Reported Posts</div>
                  <div class="text-xs text-gray-400">Posts you've reported and blocked from the feed</div>
                </div>
              </div>
              <svg viewBox="0 0 24 24" class="w-5 h-5 text-gray-500 group-hover:text-gray-300" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </router-link>

            <!-- Reported Artists -->
            <div class="p-4 bg-gray-800 rounded-lg">
              <div class="mb-2">
                <label class="font-medium">Reported Artists</label>
                <p class="text-xs text-gray-400 mt-1">
                  Posts with these artist tags never appear in your feed.
                </p>
              </div>
              <div class="flex mb-2">
                <input
                  v-model="newReportedArtist"
                  @keyup.enter="addReportedArtist"
                  type="text"
                  placeholder="Add artist tag..."
                  class="flex-1 bg-gray-900 border border-gray-700 rounded-l px-3 py-1.5 text-sm text-gray-200 focus:border-pink-500 focus:outline-none"
                />
                <button
                  @click="addReportedArtist"
                  class="bg-pink-600 hover:bg-pink-700 px-3 py-1.5 rounded-r text-sm font-medium transition"
                >
                  Add
                </button>
              </div>
              <div class="flex flex-wrap gap-2 mt-2">
                <div
                  v-for="artist in reportedArtists"
                  :key="artist"
                  class="bg-gray-700 px-2 py-1 rounded text-xs flex items-center"
                >
                  {{ artist }}
                  <button @click="removeReportedArtist(artist)" class="ml-1.5 text-gray-400 hover:text-white">
                    <X class="h-3 w-3" />
                  </button>
                </div>
                <p v-if="reportedArtists.length === 0" class="text-xs text-gray-500">No reported artists.</p>
              </div>
            </div>

            <!-- Reported Uploaders -->
            <div class="p-4 bg-gray-800 rounded-lg">
              <div class="mb-2">
                <label class="font-medium">Reported Uploaders</label>
                <p class="text-xs text-gray-400 mt-1">
                  Posts uploaded by these users never appear in your feed.
                </p>
              </div>
              <div class="flex mb-2">
                <input
                  v-model="newReportedUploader"
                  @keyup.enter="addReportedUploader"
                  type="text"
                  placeholder="Add uploader name..."
                  class="flex-1 bg-gray-900 border border-gray-700 rounded-l px-3 py-1.5 text-sm text-gray-200 focus:border-pink-500 focus:outline-none"
                />
                <button
                  @click="addReportedUploader"
                  class="bg-pink-600 hover:bg-pink-700 px-3 py-1.5 rounded-r text-sm font-medium transition"
                >
                  Add
                </button>
              </div>
              <div class="flex flex-wrap gap-2 mt-2">
                <div
                  v-for="uploader in reportedUploaders"
                  :key="uploader"
                  class="bg-gray-700 px-2 py-1 rounded text-xs flex items-center"
                >
                  {{ uploader }}
                  <button @click="removeReportedUploader(uploader)" class="ml-1.5 text-gray-400 hover:text-white">
                    <X class="h-3 w-3" />
                  </button>
                </div>
                <p v-if="reportedUploaders.length === 0" class="text-xs text-gray-500">No reported uploaders.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Download Settings -->
        <div v-else-if="currentPage === 'download'" key="download">
          <div class="space-y-4">
            <!-- Download Location -->
            <div class="p-4 bg-gray-800 rounded-lg">
              <div class="mb-2">
                <label class="font-medium">Download Location</label>
                <p class="text-xs text-gray-400 mt-1">Choose where downloaded files are saved.</p>
              </div>
              <div class="flex gap-2">
                <input
                  v-model="downloadLocation"
                  type="text"
                  placeholder="~/Downloads/BooruRamen"
                  class="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-pink-500 focus:outline-none"
                  @change="saveDownloadSettings"
                />
                <button
                  v-if="!isAndroid"
                  @click="browseDownloadFolder"
                  class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white text-sm font-medium transition whitespace-nowrap"
                >
                  Browse
                </button>
              </div>
              <p v-if="folderStatus" class="text-xs mt-2" :class="folderStatus.ok ? 'text-green-400' : 'text-red-400'">{{ folderStatus.message }}</p>
              <p class="text-xs text-gray-500 mt-2">Leave empty to use the default: a BooruRamen folder inside your Downloads folder.</p>
            </div>

            <!-- Save Liked Posts -->
            <div class="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
              <div>
                <span class="font-medium">Save Liked Posts</span>
                <p class="text-xs text-gray-400 mt-1">Automatically download all posts you like.</p>
              </div>
              <button
                @click="downloadLiked = !downloadLiked; saveDownloadSettings()"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                :class="downloadLiked ? 'bg-pink-600' : 'bg-gray-600'"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  :class="downloadLiked ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </button>
            </div>

            <!-- Save Favorited Posts -->
            <div class="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
              <div>
                <span class="font-medium">Save Favorited Posts</span>
                <p class="text-xs text-gray-400 mt-1">Automatically download all posts you favorite.</p>
              </div>
              <button
                @click="downloadFavorited = !downloadFavorited; saveDownloadSettings()"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                :class="downloadFavorited ? 'bg-pink-600' : 'bg-gray-600'"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  :class="downloadFavorited ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </button>
            </div>

            <!-- Separate Folders -->
            <div class="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
              <div>
                <span class="font-medium">Separate Folders</span>
                <p class="text-xs text-gray-400 mt-1">Organize downloads into Liked/ and Favorited/ subfolders.</p>
              </div>
              <button
                @click="downloadSeparateFolders = !downloadSeparateFolders; saveDownloadSettings()"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                :class="downloadSeparateFolders ? 'bg-pink-600' : 'bg-gray-600'"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  :class="downloadSeparateFolders ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </button>
            </div>
          </div>
        </div>

        <!-- Advanced Settings -->
        <div v-else-if="currentPage === 'advanced'" key="advanced">
          <div class="space-y-4">
            <!-- Debug Mode -->
            <div class="flex items-center justify-between p-4 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-750" @click="toggleDebugMode">
              <div class="flex flex-col">
                <label class="font-medium cursor-pointer">Debug Mode</label>
                <span class="text-sm text-gray-400">Show recommendation analytics overlay</span>
              </div>
              <div
                class="relative inline-flex h-6 w-11 items-center rounded-full"
                :class="debugMode ? 'bg-pink-600' : 'bg-gray-600'"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition"
                  :class="debugMode ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </div>
            </div>

            <!-- Disable History -->
            <div class="flex items-center justify-between p-4 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-750" @click="toggleHistory">
              <div class="flex flex-col">
                <label class="font-medium cursor-pointer">Disable View History</label>
                <span class="text-sm text-gray-400">Disabling view history may cause the feed to show previously viewed posts</span>
              </div>
              <div
                class="relative inline-flex h-6 w-11 items-center rounded-full"
                :class="disableHistory ? 'bg-pink-600' : 'bg-gray-600'"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition"
                  :class="disableHistory ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </div>
            </div>

            <!-- Check for Updates -->
            <button @click="checkForUpdates" class="w-full text-center bg-blue-700 hover:bg-blue-600 py-3 rounded-md text-lg transition">
              Check for Updates
            </button>

            <!-- Refresh Feed -->
            <button @click="showRefreshFeedModal" class="w-full text-center bg-blue-700 hover:bg-blue-600 py-3 rounded-md text-lg transition">
              Refresh your feed
            </button>

            <!-- Separator -->
            <div class="border-t border-gray-700"></div>

            <!-- Clear History -->
            <button @click="wipeHistory" class="w-full text-center bg-red-800 hover:bg-red-700 py-3 rounded-md text-lg transition">
              Clear History
            </button>

            <!-- Clear Likes -->
            <button @click="wipeLikes" class="w-full text-center bg-red-800 hover:bg-red-700 py-3 rounded-md text-lg transition">
              Clear Likes
            </button>

            <!-- Clear Favorites -->
            <button @click="wipeFavorites" class="w-full text-center bg-red-800 hover:bg-red-700 py-3 rounded-md text-lg transition">
              Clear Favorites
            </button>

            <!-- Clear Downloads Folder -->
            <button @click="wipeDownloads" class="w-full text-center bg-red-800 hover:bg-red-700 py-3 rounded-md text-lg transition">
              Clear Downloads Folder
            </button>

            <!-- Clear All Data -->
            <button @click="wipeAll" class="w-full text-center bg-red-800 hover:bg-red-700 py-3 rounded-md text-lg transition">
              Clear All Data
            </button>
          </div>
        </div>
      </transition>
    </div>

    <!-- Confirmation Modal -->
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-80 backdrop-blur-sm">
      <div class="bg-gray-800 rounded-lg max-w-sm w-full p-6 shadow-xl border border-gray-700">
        <h3 class="text-xl font-bold mb-2">{{ modalTitle }}</h3>
        <p class="text-gray-300" :class="modalWarning ? 'mb-3' : 'mb-6'">{{ modalMessage }}</p>
        <div v-if="modalWarning" class="flex items-start gap-2 bg-yellow-500/10 border border-yellow-600/40 rounded-md p-3 mb-6">
          <AlertCircle class="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
          <p class="text-yellow-400 text-sm">{{ modalWarning }}</p>
        </div>
        <div class="flex gap-3">
          <button
            @click="closeModal"
            class="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white font-medium transition"
          >
            Cancel
          </button>
          <button
            @click="executeAction"
            class="flex-1 px-4 py-2 bg-pink-600 hover:bg-pink-700 rounded text-white font-medium transition"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>

    <!-- Success Splash Modal -->
    <div v-if="showSuccessModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-80 backdrop-blur-sm">
      <div class="bg-gray-800 rounded-lg max-w-sm w-full p-6 shadow-xl border border-gray-700">
        <div class="flex items-start gap-3 mb-2">
          <div class="w-8 h-8 rounded-full bg-green-600/20 flex items-center justify-center flex-shrink-0">
            <Check class="w-5 h-5 text-green-400" />
          </div>
          <h3 class="text-xl font-bold">{{ successTitle }}</h3>
        </div>
        <p class="text-gray-300 mb-6">{{ successMessage }}</p>
        <button
          @click="showSuccessModal = false"
          class="w-full px-4 py-2 bg-pink-600 hover:bg-pink-700 rounded text-white font-medium transition"
        >
          OK
        </button>
      </div>
    </div>

    <!-- Refresh Feed Modal -->
    <div v-if="showRefreshModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-80 backdrop-blur-sm">
      <div class="bg-gray-800 rounded-lg max-w-sm w-full p-6 shadow-xl border border-gray-700">
        <h3 class="text-xl font-bold mb-2">Start fresh?</h3>
        <p class="text-gray-300 mb-6">We'll reset your recommendations so you can discover new content. Your history, likes, and favorites won't be touched.</p>
        <div class="flex gap-3">
          <button
            @click="closeRefreshModal"
            class="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white font-medium transition"
          >
            Keep Current
          </button>
          <button
            @click="executeRefreshFeed"
            class="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white font-medium transition"
          >
            Start Fresh
          </button>
        </div>
      </div>
    </div>

    <!-- About/License Note -->
    <div class="mt-16 pb-8 text-center border-t border-gray-800 pt-8 opacity-40">
      <p class="text-sm font-semibold text-gray-400">BooruRamen v{{ appVersion }}</p>
      <p class="text-xs text-gray-500 mt-1">
        Licensed under <span class="text-pink-500/80 uppercase">GPL-3.0</span>
      </p>
      <p class="text-[10px] text-gray-600 mt-2">&copy; 2025 SoupDevs</p>
    </div>
  </div>
</template>

<script>/* global __APP_VERSION__ */
import { mapWritableState, mapActions } from 'pinia';
import { useSettingsStore } from '../stores/settings';
import { useInteractionsStore } from '../stores/interactions';
import { usePlayerStore } from '../stores/player';
import { useUpdaterStore } from '../stores/updater';
import StorageService from '../services/StorageService';
import ReportService from '../services/ReportService';
import RecommendationSystem, { COMMON_TAGS } from '../services/RecommendationSystem';

import BooruService from '../services/BooruService';
import { DanbooruAdapter, GelbooruAdapter, MoebooruAdapter } from '../services/BooruAdapters';
import { detectBooruEngine } from '../services/BooruEngineDetector';
import DownloadService from '../services/DownloadService';
import { THEME_PRESETS, FONT_OPTIONS, DEFAULT_CUSTOM_THEME, buildCustomTheme, getThemePreview, applyTheme } from '../services/ThemeService';
import { X, Check, AlertCircle } from 'lucide-vue-next';

export default {
  name: 'ProfileSettingsView',
  components: {
    X, Check, AlertCircle
  },
  data() {
    return {
      showModal: false,
      modalTitle: '',
      modalMessage: '',
      modalWarning: '',
      pendingAction: null,
      pendingSuccessMessage: '',
      showSuccessModal: false,
      successTitle: '',
      successMessage: '',
      showRefreshModal: false,
      avoidedTagsInput: '',
      saveMessage: '',

      // Tag query overrides
      alwaysIncludeInput: '',
      neverIncludeInput: '',
      overrideSaveMessage: '',

      // Navigation
      navigationStack: [],
      slideDirection: 'slide-left',

      // Source Management
      predefinedSources: [],
      localActiveSources: [],
      showAddSource: false,
      newSource: { name: '', url: '', type: 'gelbooru' },
      isDetectingEngine: false,
      engineDetectError: '',
      engineDetectSuccess: '',
      engineDetectTimer: null,
      sourceSaveMessage: '',
      editingAuth: null,
      isTestingAuth: false,
      authTestResult: null,
      testResults: [],
      sourceStatus: {},
      authStatus: {},

      // Folder picker status
      folderStatus: null,

      // Gesture/animation switches; keys are settings-store flags
      interactionOptions: [
        { key: 'showLikeAnimation', label: 'Like Animation', hint: 'White hearts when a post is liked, a muted falling heart when the like is removed' },
        { key: 'showDislikeAnimation', label: 'Dislike Animation', hint: 'Thumbs down when a post is disliked, a muted one when it is removed' },
        { key: 'showFavoriteAnimation', label: 'Favorite Animation', hint: 'Star when a post is favorited, a muted falling star when it is removed' },
      ],
      // Which buttons show in the feed's right-hand action column.
      feedButtonOptions: [
        { key: 'showLikeButton', label: 'Like button', hint: 'Heart button in the feed' },
        { key: 'showDislikeButton', label: 'Dislike button', hint: 'Thumbs-down button in the feed' },
        { key: 'showFavoriteButton', label: 'Favorite button', hint: 'Star button in the feed' },
      ],
      // Feed gestures, each independently switchable — no master mode.
      feedGestureOptions: [
        { key: 'doubleTapToLike', label: 'Double-Tap to Like', hint: 'Double-tap a post to like it' },
        { key: 'swipeRightToFavorite', label: 'Swipe Right to Favorite', hint: 'Swipe a post right to add it to favorites' },
        { key: 'swipeLeftToDislike', label: 'Swipe Left to Dislike', hint: 'Swipe a post left to dislike it' },
        { key: 'holdToSeek', label: 'Hold to Seek Video', hint: 'Hold a video for a second to pause, then drag left or right to scrub' },
      ],

      // Reported & Blocked management
      reportedArtists: [],
      reportedUploaders: [],
      newReportedArtist: '',
      newReportedUploader: '',
    };
  },
  computed: {
    ...mapWritableState(useSettingsStore, [
      'disableHistory', 'debugMode', 'customSources', 'activeSource',
      'tagAlwaysInclude', 'tagNeverInclude',
      'doubleTapToLike', 'showLikeAnimation', 'showDislikeAnimation', 'showFavoriteAnimation',
      'showLikeButton', 'showDislikeButton', 'showFavoriteButton',
      'swipeRightToFavorite', 'swipeLeftToDislike', 'holdToSeek',
      'downloadLocation', 'downloadLiked', 'downloadFavorited', 'downloadSeparateFolders',
      'theme', 'customTheme'
    ]),
    themePresets() {
      const presets = Object.entries(THEME_PRESETS).map(([id, preset]) => ({
        id,
        label: preset.label,
        description: preset.description,
        preview: getThemePreview(preset)
      }));
      const custom = buildCustomTheme(this.customTheme);
      presets.push({
        id: 'custom',
        label: custom.label,
        description: custom.description,
        preview: getThemePreview(custom)
      });
      return presets;
    },
    customColorFields() {
      return [
        { key: 'background', label: 'Background', hint: 'Main app background' },
        { key: 'surface', label: 'Surface', hint: 'Cards, panels, inputs' },
        { key: 'text', label: 'Text', hint: 'Primary text color' },
        { key: 'accent', label: 'Accent', hint: 'Buttons, links, highlights' }
      ];
    },
    fontOptions() {
      return FONT_OPTIONS;
    },
    appVersion() {
      return __APP_VERSION__;
    },
    isAndroid() {
      return DownloadService.isAndroid();
    },
    currentPage() {
      return this.navigationStack.length > 0
        ? this.navigationStack[this.navigationStack.length - 1]
        : 'root';
    },
    currentTitle() {
      const titles = {
        root: 'Settings',
        ui: 'UI',
        content: 'Content',
        sources: 'Sources',
        reported: 'Reported & Blocked',
        download: 'Download',
        advanced: 'Advanced',
      };
      return titles[this.currentPage] || 'Settings';
    },
  },
  async mounted() {
    // Ensure the settings store is loaded before reading override tags
    await useSettingsStore().initialize();
    this.alwaysIncludeInput = (this.tagAlwaysInclude || []).join(' ');
    this.neverIncludeInput = (this.tagNeverInclude || []).join(' ');

    const preferences = await StorageService.getPreferences();

    if (preferences.avoidedTags && Array.isArray(preferences.avoidedTags)) {
      this.avoidedTagsInput = preferences.avoidedTags.join(' ');
    } else {
      this.avoidedTagsInput = COMMON_TAGS.join(' ');
    }

    const defaultSources = [
      { name: 'Danbooru', type: 'danbooru', url: 'https://danbooru.donmai.us' },
      { name: 'Safebooru', type: 'gelbooru', url: 'https://safebooru.org' },
      { name: 'Gelbooru', type: 'gelbooru', url: 'https://gelbooru.com' },
    ];
    this.predefinedSources = defaultSources;

    this.localActiveSources = preferences.activeSources || (this.activeSource ? [this.activeSource] : [defaultSources[0]]);

    const sourceConfigs = preferences.sourceConfigs || {};
    // Restore saved credentials for both built-in and custom sources. The
    // custom list is store-backed, so the credentials have to land on its
    // entries (not on the stored copy) or a key entered for a custom booru
    // would vanish on the next launch.
    if ((this.customSources || []).length === 0 && (preferences.customSources || []).length > 0) {
      this.customSources = preferences.customSources;
    }
    [...this.predefinedSources, ...this.customSources].forEach(source => {
      if (sourceConfigs[source.url]) {
        source.userId = sourceConfigs[source.url].userId;
        source.apiKey = sourceConfigs[source.url].apiKey;
      }
    });

    this.checkAllSourceStatus();
    this.checkAllAuthStatus();
  },
  methods: {
    ...mapActions(useSettingsStore, ['updateSettings', 'saveSettings', 'setTagOverrides', 'setTheme', 'setCustomThemeValue']),

    // Theme management
    selectTheme(themeId) {
      this.setTheme(themeId);
    },
    resetCustomTheme() {
      for (const [key, value] of Object.entries(DEFAULT_CUSTOM_THEME)) {
        this.setCustomThemeValue(key, value);
      }
    },

    // Navigation
    navigateTo(page) {
      this.slideDirection = 'slide-left';
      this.navigationStack.push(page);
      if (page === 'reported') {
        this.loadReports();
      }
    },
    goBack() {
      if (this.navigationStack.length > 0) {
        this.slideDirection = 'slide-right';
        this.navigationStack.pop();
      }
    },

    // Tag query overrides
    saveTagOverrides() {
      const parseTags = (input) => [...new Set(
        input.split(/[\s,]+/).map(t => t.trim()).filter(t => t.length > 0)
      )];
      const alwaysInclude = parseTags(this.alwaysIncludeInput);
      const neverInclude = parseTags(this.neverIncludeInput);
      this.setTagOverrides({ alwaysInclude, neverInclude });
      this.alwaysIncludeInput = alwaysInclude.join(' ');
      this.neverIncludeInput = neverInclude.join(' ');
      this.overrideSaveMessage = 'Overrides saved!';
      setTimeout(() => { this.overrideSaveMessage = ''; }, 3000);
    },

    // Reported & Blocked management
    async loadReports() {
      this.reportedArtists = await ReportService.getReportedArtists();
      this.reportedUploaders = await ReportService.getReportedUploaders();
    },
    async addReportedArtist() {
      const name = this.newReportedArtist.trim().toLowerCase();
      if (!name) return;
      await ReportService.reportArtist(name);
      this.newReportedArtist = '';
      await this.loadReports();
    },
    async removeReportedArtist(name) {
      await ReportService.removeReport('artist', name);
      await this.loadReports();
    },
    async addReportedUploader() {
      const name = this.newReportedUploader.trim().toLowerCase();
      if (!name) return;
      await ReportService.reportUploader(name);
      this.newReportedUploader = '';
      await this.loadReports();
    },
    async removeReportedUploader(name) {
      await ReportService.removeReport('uploader', name);
      await this.loadReports();
    },

    toggleHistory() {
      this.disableHistory = !this.disableHistory;
      this.saveSettings();
    },
    toggleDebugMode() {
      this.debugMode = !this.debugMode;
      this.saveSettings();
    },

    // Gesture/animation switches read and write the store flags mapped above,
    // so a change survives leaving the page and the next launch.
    isInteractionEnabled(key) {
      return !!this[key];
    },
    toggleInteraction(key) {
      this[key] = !this[key];
      this.saveSettings();
    },

    // Update check (result surfaces through the global UpdateSplash)
    checkForUpdates() {
      useUpdaterStore().checkForUpdates({ manual: true });
    },

    // Download settings
    saveDownloadSettings() {
      this.saveSettings();
    },
    async browseDownloadFolder() {
      // In Tauri, use the native folder picker (returns a full path)
      if (DownloadService.isTauri()) {
        try {
          const { open } = await import('@tauri-apps/plugin-dialog');
          const defaultPath = await DownloadService.getDownloadLocation();
          const selected = await open({ directory: true, defaultPath });
          if (selected) {
            this.downloadLocation = selected;
            this.folderStatus = { ok: true, message: `Selected: ${selected}` };
            this.saveDownloadSettings();
          }
        } catch (err) {
          console.error('Folder picker failed:', err);
          this.folderStatus = { ok: false, message: 'Could not open folder picker. Enter the path manually.' };
        }
        return;
      }

      // Browser: the download location is controlled by the browser itself,
      // so a picker here is only informational. Let the user type a path.
      this.folderStatus = { ok: false, message: 'Folder browsing is only available in the app. Enter the path manually.' };
    },

    async saveAvoidedTags() {
      const tags = this.avoidedTagsInput
        .split(/[\s,]+/)
        .map(t => t.trim())
        .filter(t => t.length > 0);
      const uniqueTags = [...new Set(tags)];
      await StorageService.storePreferences({ avoidedTags: uniqueTags });
      this.avoidedTagsInput = uniqueTags.join(' ');
      this.saveMessage = 'Settings saved!';
      setTimeout(() => { this.saveMessage = ''; }, 3000);
    },

    // Source Methods
    isSourceActive(source) {
      return this.localActiveSources.some(s => s.url === source.url);
    },
    toggleSource(source) {
      const index = this.localActiveSources.findIndex(s => s.url === source.url);
      if (index > -1) {
        this.localActiveSources.splice(index, 1);
      } else {
        this.localActiveSources.push(source);
      }
    },
    addCustomSource() {
      if (this.newSource.name && this.newSource.url) {
        // Credentials start empty but the row offers the same auth panel as the
        // built-in sources, so keys can be added now or later.
        this.customSources.push({ ...this.newSource, userId: '', apiKey: '' });
        this.newSource = { name: '', url: '', type: 'gelbooru' };
        this.showAddSource = false;
        this.engineDetectError = '';
        this.engineDetectSuccess = '';
        this.saveSettings();
      }
    },
    /**
     * Probe the URL in the add form and select whichever engine answers.
     * Turns the manual dropdown into a pre-filled suggestion; a failure clears
     * its message after a few seconds and leaves the choice to the user.
     */
    async detectSourceEngine() {
      if (this.isDetectingEngine || !this.newSource.url) return;

      this.isDetectingEngine = true;
      this.engineDetectError = '';
      this.engineDetectSuccess = '';
      this.clearEngineDetectTimer();

      try {
        const result = await detectBooruEngine(this.newSource.url, {
          userId: this.newSource.userId,
          apiKey: this.newSource.apiKey,
        });

        if (result.type) {
          this.newSource.type = result.type;
          this.newSource.url = result.url;
          this.engineDetectSuccess = result.requiresAuth
            ? `Detected ${result.type} engine — this booru requires an API key.`
            : `Detected ${result.type} engine.`;
          this.scheduleEngineDetectClear(3000, 'success');
        } else {
          this.engineDetectError = result.error || 'Could not detect the engine. Select it manually.';
          this.scheduleEngineDetectClear(5000, 'error');
        }
      } catch (e) {
        this.engineDetectError = 'Could not reach that URL. Check it and try again.';
        this.scheduleEngineDetectClear(5000, 'error');
      } finally {
        this.isDetectingEngine = false;
      }
    },
    scheduleEngineDetectClear(delay, which) {
      this.clearEngineDetectTimer();
      this.engineDetectTimer = setTimeout(() => {
        if (which === 'error') this.engineDetectError = '';
        else this.engineDetectSuccess = '';
        this.engineDetectTimer = null;
      }, delay);
    },
    clearEngineDetectTimer() {
      if (this.engineDetectTimer) {
        clearTimeout(this.engineDetectTimer);
        this.engineDetectTimer = null;
      }
    },
    toggleAuth(source) {
      if (this.editingAuth === source.url) {
        this.editingAuth = null;
      } else {
        this.editingAuth = source.url;
      }
    },
    removeCustomSource(index) {
      const sourceToRemove = this.customSources[index];
      this.customSources.splice(index, 1);
      const activeIndex = this.localActiveSources.findIndex(s => s.url === sourceToRemove.url);
      if (activeIndex > -1 && this.localActiveSources.length > 1) {
        this.localActiveSources.splice(activeIndex, 1);
      }
      this.saveSettings();
    },
    async saveSources() {
      if (this.localActiveSources.length === 0) {
        this.confirmAction(
          'No Source Selected',
          'At least one booru source must be selected.',
          () => {}
        );
        return;
      }

      const gelbooruSource = this.localActiveSources.find(
        s => s.type === 'gelbooru' && s.url.toLowerCase().includes('gelbooru.com')
      );
      if (gelbooruSource) {
        const fullSource = this.predefinedSources.find(p => p.url === gelbooruSource.url)
                        || this.customSources.find(c => c.url === gelbooruSource.url)
                        || gelbooruSource;
        if (!fullSource.userId || !fullSource.apiKey) {
          this.confirmAction(
            'Gelbooru Authentication Required',
            'Gelbooru.com requires authentication to function properly. Please click the key icon next to Gelbooru to enter your User ID and API Key.',
            () => {}
          );
          return;
        }
      }

      const preferences = await StorageService.getPreferences();

      this.localActiveSources = this.localActiveSources.map(active => {
        const updatedPredefined = this.predefinedSources.find(p => p.url === active.url);
        const updatedCustom = this.customSources.find(c => c.url === active.url);
        const source = updatedPredefined || updatedCustom || active;
        return { ...active, userId: source.userId, apiKey: source.apiKey };
      });

      const sourceConfigs = preferences.sourceConfigs || {};
      // Persist credentials for custom sources too, so the auth panel on a
      // custom row survives a restart the same way the built-in ones do.
      [...this.predefinedSources, ...this.customSources].forEach(s => {
        if (s.userId || s.apiKey) {
          sourceConfigs[s.url] = { userId: s.userId, apiKey: s.apiKey };
        }
      });

      await StorageService.storePreferences({
        customSources: this.customSources,
        activeSources: this.localActiveSources,
        sourceConfigs: sourceConfigs
      });

      if (this.localActiveSources.length > 0) {
        this.activeSource = this.localActiveSources[0];
      }

      BooruService.setActiveSources(this.localActiveSources);

      this.sourceSaveMessage = 'Sources saved!';
      setTimeout(() => this.sourceSaveMessage = '', 3000);
    },

    async testConnection() {
      this.testResults = [];
      const sourcesToTest = this.localActiveSources.map(active => {
        const predefined = this.predefinedSources.find(p => p.url === active.url);
        const custom = this.customSources.find(c => c.url === active.url);
        const source = predefined || custom || active;
        return { ...active, userId: source.userId, apiKey: source.apiKey };
      });
      this.testResults = await BooruService.testAuthenticationForSources(sourcesToTest);
      for (const result of this.testResults) {
        if (result.url) {
          this.authStatus[result.url] = result.success ? 'authenticated' : 'unauthenticated';
        }
      }
      this.authStatus = { ...this.authStatus };
    },
    resetAvoidedTags() {
      this.avoidedTagsInput = COMMON_TAGS.join(' ');
    },
    confirmAction(title, message, action, warning = '', successMessage = '') {
      this.modalTitle = title;
      this.modalMessage = message;
      this.modalWarning = warning;
      this.pendingAction = action;
      this.pendingSuccessMessage = successMessage;
      this.showModal = true;
    },
    async executeAction() {
      const action = this.pendingAction;
      const successMessage = this.pendingSuccessMessage;
      const title = this.modalTitle;
      this.pendingAction = null;
      this.pendingSuccessMessage = '';
      this.showModal = false;
      if (action) {
        await action();
        if (successMessage) {
          this.successTitle = title;
          this.successMessage = successMessage;
          this.showSuccessModal = true;
        }
      }
    },
    closeModal() {
      this.showModal = false;
      this.pendingAction = null;
      this.pendingSuccessMessage = '';
    },
    showRefreshFeedModal() {
      this.showRefreshModal = true;
    },
    closeRefreshModal() {
      this.showRefreshModal = false;
    },
    async executeRefreshFeed() {
      try {
        await RecommendationSystem.resetRecommendations();
        this.$router.replace({ name: 'Home', query: { ...this.$route.query, refresh: Date.now().toString() } });
      } catch (error) {
        console.error('Failed to reset recommendations:', error);
      } finally {
        this.showRefreshModal = false;
      }
    },
    async testAuth(source) {
      this.isTestingAuth = true;
      this.authTestResult = null;
      try {
        let adapter;
        const credentials = { userId: source.userId, apiKey: source.apiKey };
        if (source.type === 'gelbooru') {
          adapter = new GelbooruAdapter(source.url, credentials);
        } else if (source.type === 'moebooru') {
          adapter = new MoebooruAdapter(source.url);
        } else {
          adapter = new DanbooruAdapter(source.url, credentials);
        }
        const result = await adapter.testAuthentication();
        this.authTestResult = { url: source.url, success: result.success, message: result.message };
        this.authStatus[source.url] = result.success ? 'authenticated' : 'unauthenticated';
        this.authStatus = { ...this.authStatus };
      } catch (error) {
        this.authTestResult = { url: source.url, success: false, message: `Failed: ${error.message}` };
        this.authStatus[source.url] = 'unauthenticated';
        this.authStatus = { ...this.authStatus };
      } finally {
        this.isTestingAuth = false;
      }
    },
    getStatusClass(sourceUrl) {
      const status = this.sourceStatus[sourceUrl];
      if (status === 'success') return 'bg-green-500';
      if (status === 'failed') return 'bg-red-500';
      return 'bg-yellow-500 animate-pulse';
    },
    async checkAllSourceStatus() {
      const allSources = [...this.predefinedSources, ...this.customSources];
      allSources.forEach(source => {
        this.sourceStatus[source.url] = 'pending';
      });
      this.sourceStatus = { ...this.sourceStatus };
      const promises = allSources.map(async source => {
        try {
          const results = await BooruService.testConnectionForSources([source]);
          if (results.length > 0 && results[0].success) {
            this.sourceStatus[source.url] = 'success';
          } else {
            this.sourceStatus[source.url] = 'failed';
          }
        } catch (error) {
          this.sourceStatus[source.url] = 'failed';
        }
        this.sourceStatus = { ...this.sourceStatus };
      });
      await Promise.all(promises);
    },
    supportsVideo(source) {
      if (source.type === 'danbooru') return true;
      if (source.type === 'gelbooru') {
        return source.url.toLowerCase().includes('gelbooru.com');
      }
      return false;
    },
    requiresAuth(source) {
      if (source.type === 'gelbooru' && source.url.toLowerCase().includes('gelbooru.com')) {
        return true;
      }
      return false;
    },
    showAuthButton(source) {
      if (source.type === 'gelbooru' && source.url.toLowerCase().includes('safebooru.org')) {
        return false;
      }
      return true;
    },
    getAuthClass(sourceUrl) {
      const status = this.authStatus[sourceUrl];
      if (status === 'authenticated') return 'text-green-500 hover:text-green-400';
      if (status === 'unauthenticated') return 'text-gray-500 hover:text-white';
      return 'text-gray-500 hover:text-white';
    },
    async checkAllAuthStatus() {
      const allSources = [...this.predefinedSources, ...this.customSources];
      allSources.forEach(source => {
        this.authStatus[source.url] = 'pending';
      });
      this.authStatus = { ...this.authStatus };
      const promises = allSources.map(async source => {
        try {
          const results = await BooruService.testAuthenticationForSources([source]);
          if (results.length > 0 && results[0].success) {
            this.authStatus[source.url] = 'authenticated';
          } else {
            this.authStatus[source.url] = 'unauthenticated';
          }
        } catch (error) {
          this.authStatus[source.url] = 'unauthenticated';
        }
        this.authStatus = { ...this.authStatus };
      });
      await Promise.all(promises);
    },

    // Wipe methods
    wipeHistory() {
      this.confirmAction(
        'Clear History',
        'Are you sure you want to clear your entire viewing history?',
        async () => { await StorageService.clearHistory(); },
        '',
        'Your viewing history has been cleared.'
      );
    },
    wipeLikes() {
      this.confirmAction(
        'Clear Likes',
        'Are you sure you want to clear all your liked posts?',
        async () => { await StorageService.clearLikes(); },
        '',
        'All of your liked posts have been cleared.'
      );
    },
    wipeFavorites() {
      this.confirmAction(
        'Clear Favorites',
        'Are you sure you want to clear all your favorited posts?',
        async () => { await StorageService.clearFavorites(); },
        '',
        'All of your favorited posts have been cleared.'
      );
    },
    async wipeDownloads() {
      if (!DownloadService.isTauri()) {
        // Browser build: the browser manages downloaded files, so there is
        // no app folder to clear — just explain that with a splash.
        this.successTitle = 'Clear Downloads Folder';
        this.successMessage = 'Nothing to clear here: in the browser version, downloaded files are managed by your browser. Clearing the downloads folder is only available in the app.';
        this.showSuccessModal = true;
        return;
      }
      const dir = await DownloadService.getDownloadLocation();
      this.confirmAction(
        'Clear Downloads Folder',
        `Are you sure you want to delete all files in "${dir}"?`,
        async () => {
          await DownloadService.clearDownloads();
          await StorageService.clearDownloads();
        },
        'This action cannot be undone.',
        'The downloads folder has been cleared.'
      );
    },
    wipeAll() {
      this.confirmAction(
        'Clear All Data',
        'Are you sure you want to clear ALL your data? This resets the app to a fresh install.',
        async () => {
          await StorageService.clearAllData();
          // Also wipe all in-memory state so nothing lingers in this session
          // (or silently re-saves itself to the freshly cleared database)
          await RecommendationSystem.factoryReset();
          const settingsStore = useSettingsStore();
          settingsStore.$reset();
          settingsStore.initialized = true;
          applyTheme(settingsStore.theme, settingsStore.customTheme);
          useInteractionsStore().$reset();
          usePlayerStore().$reset();
          BooruService.setActiveSources(
            [{ type: 'danbooru', url: 'https://danbooru.donmai.us', name: 'Danbooru' }],
            false
          );
        },
        '',
        'All app data has been cleared and the app has been reset to defaults.'
      );
    },
  },
};
</script>

<style scoped>
/* Going deeper: current page exits left, new page enters from the right */
.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.slide-left-enter-from {
  transform: translateX(30px);
  opacity: 0;
}
.slide-left-leave-to {
  transform: translateX(-30px);
  opacity: 0;
}
/* Going back up: current page exits right, new page enters from the left */
.slide-right-enter-from {
  transform: translateX(-30px);
  opacity: 0;
}
.slide-right-leave-to {
  transform: translateX(30px);
  opacity: 0;
}
</style>
