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
      <transition name="slide" mode="out-in">
        <!-- Root: Category List -->
        <div v-if="currentPage === 'root'" key="root">
          <div class="space-y-2">
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
                  <div class="text-xs text-gray-400">Sources, tags, ratings</div>
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

            <!-- Ratings (inline, no sub-page) -->
            <div class="p-4 bg-gray-800 rounded-lg">
              <div class="mb-3">
                <label class="font-medium">Ratings</label>
                <p class="text-xs text-gray-400 mt-1">
                  Enable rating categories to make their toggles available in the feed settings sidebar.
                </p>
              </div>
              <!-- 18+ Warning -->
              <div
                v-if="showRatingWarning"
                class="mb-3 p-3 bg-yellow-900/40 border border-yellow-600/50 rounded-lg"
              >
                <div class="flex items-start gap-2">
                  <svg viewBox="0 0 24 24" class="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  </svg>
                  <div class="text-xs text-yellow-300">
                    <p class="font-semibold">Age Restricted Content</p>
                    <p class="mt-1 text-yellow-400">Enabling ratings beyond General may allow 18+ sexual or other adult content. You must be 18 or older to enable these ratings.</p>
                  </div>
                </div>
              </div>
              <div class="space-y-3">
                <div
                  v-for="rating in allRatings"
                  :key="rating.id"
                  class="flex items-center justify-between"
                >
                  <div>
                    <span class="text-sm font-medium capitalize">{{ rating.label }}</span>
                    <p class="text-xs text-gray-500">{{ rating.description }}</p>
                  </div>
                  <button
                    @click="toggleEnabledRating(rating.id)"
                    class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                    :class="enabledRatings.includes(rating.id) ? 'bg-pink-600' : 'bg-gray-600'"
                  >
                    <span
                      class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                      :class="enabledRatings.includes(rating.id) ? 'translate-x-6' : 'translate-x-1'"
                    ></span>
                  </button>
                </div>
              </div>
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
                <div v-for="(source, idx) in customSources" :key="source.name" class="flex items-center justify-between bg-gray-900 p-2 rounded relative group">
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full flex-shrink-0" :class="getStatusClass(source.url)"></span>
                    <span class="text-sm font-medium">{{ source.name }}</span>
                    <span class="text-xs text-gray-500">({{ source.type }})</span>
                    <span v-if="!supportsVideo(source)" class="text-xs text-yellow-400 italic">Images Only</span>
                  </div>
                  <div class="flex items-center gap-3">
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
                <select v-model="newSource.type" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-white">
                  <option value="danbooru">Danbooru Type</option>
                  <option value="gelbooru">Gelbooru Type</option>
                  <option value="moebooru">Moebooru Type</option>
                </select>
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
                  placeholder="e.g. ~/Downloads/BooruRamen"
                  class="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-pink-500 focus:outline-none"
                  @change="saveDownloadSettings"
                />
                <button
                  @click="browseDownloadFolder"
                  class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white text-sm font-medium transition whitespace-nowrap"
                >
                  Browse
                </button>
              </div>
              <p v-if="folderStatus" class="text-xs mt-2" :class="folderStatus.ok ? 'text-green-400' : 'text-red-400'">{{ folderStatus.message }}</p>
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
        <p class="text-gray-300 mb-6">{{ modalMessage }}</p>
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

    <!-- Refresh Feed Modal -->
    <div v-if="showRefreshModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-80 backdrop-blur-sm">
      <div class="bg-gray-800 rounded-lg max-w-sm w-full p-6 shadow-xl border border-gray-700">
        <h3 class="text-xl font-bold mb-2">Start fresh?</h3>
        <p class="text-gray-300 mb-6">We'll clear your history and reset your recommendations so you can discover new content.</p>
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
import StorageService from '../services/StorageService';
import RecommendationSystem, { COMMON_TAGS } from '../services/RecommendationSystem';

import BooruService from '../services/BooruService';
import { DanbooruAdapter, GelbooruAdapter, MoebooruAdapter } from '../services/BooruAdapters';
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
      pendingAction: null,
      showRefreshModal: false,
      avoidedTagsInput: '',
      saveMessage: '',

      // Navigation
      navigationStack: [],

      // Source Management
      predefinedSources: [],
      localActiveSources: [],
      showAddSource: false,
      newSource: { name: '', url: '', type: 'gelbooru' },
      sourceSaveMessage: '',
      editingAuth: null,
      isTestingAuth: false,
      authTestResult: null,
      testResults: [],
      sourceStatus: {},
      authStatus: {},

      // Folder picker status
      folderStatus: null,

      // Rating definitions
      allRatings: [
        { id: 'general', label: 'General', description: 'Safe for all ages' },
        { id: 'sensitive', label: 'Sensitive', description: 'May contain slightly suggestive content' },
        { id: 'questionable', label: 'Questionable', description: 'May contain explicit themes' },
        { id: 'explicit', label: 'Explicit', description: 'Contains adult content' },
      ],
    };
  },
  computed: {
    ...mapWritableState(useSettingsStore, [
      'disableHistory', 'debugMode', 'customSources', 'activeSource',
      'enabledRatings', 'downloadLocation', 'downloadLiked', 'downloadFavorited', 'downloadSeparateFolders'
    ]),
    appVersion() {
      return __APP_VERSION__;
    },
    currentPage() {
      return this.navigationStack.length > 0
        ? this.navigationStack[this.navigationStack.length - 1]
        : 'root';
    },
    currentTitle() {
      const titles = {
        root: 'Settings',
        content: 'Content',
        sources: 'Sources',
        download: 'Download',
        advanced: 'Advanced',
      };
      return titles[this.currentPage] || 'Settings';
    },
    showRatingWarning() {
      return this.enabledRatings.some(r => r !== 'general');
    },
  },
  async mounted() {
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
    this.predefinedSources.forEach(source => {
      if (sourceConfigs[source.url]) {
        source.userId = sourceConfigs[source.url].userId;
        source.apiKey = sourceConfigs[source.url].apiKey;
      }
    });

    this.checkAllSourceStatus();
    this.checkAllAuthStatus();
  },
  methods: {
    ...mapActions(useSettingsStore, ['updateSettings', 'saveSettings', 'toggleEnabledRating']),

    // Navigation
    navigateTo(page) {
      this.navigationStack.push(page);
    },
    goBack() {
      if (this.navigationStack.length > 0) {
        this.navigationStack.pop();
      }
    },

    toggleHistory() {
      this.disableHistory = !this.disableHistory;
      this.saveSettings();
    },
    toggleDebugMode() {
      this.debugMode = !this.debugMode;
      this.saveSettings();
    },

    // Download settings
    saveDownloadSettings() {
      this.saveSettings();
    },
    async browseDownloadFolder() {
      // Use the File System Access API if available (Chromium browsers)
      if (window.showDirectoryPicker) {
        try {
          const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
          this.downloadLocation = dirHandle.name;
          this.folderStatus = { ok: true, message: `Selected: ${dirHandle.name}` };
          this.saveDownloadSettings();
        } catch (err) {
          // User cancelled the picker
          if (err.name !== 'AbortError') {
            this.folderStatus = { ok: false, message: 'Could not open folder picker. Enter the path manually.' };
          }
        }
      } else {
        // Fallback: prompt the user
        const path = prompt('Enter download folder path:', this.downloadLocation || '~/Downloads/BooruRamen');
        if (path !== null) {
          this.downloadLocation = path;
          this.saveDownloadSettings();
        }
      }
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
        this.customSources.push({ ...this.newSource, userId: '', apiKey: '' });
        this.newSource = { name: '', url: '', type: 'gelbooru' };
        this.showAddSource = false;
        this.saveSettings();
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
      this.predefinedSources.forEach(s => {
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
    confirmAction(title, message, action) {
      this.modalTitle = title;
      this.modalMessage = message;
      this.pendingAction = action;
      this.showModal = true;
    },
    executeAction() {
      if (this.pendingAction) {
        this.pendingAction();
        this.pendingAction = null;
      }
      this.showModal = false;
    },
    closeModal() {
      this.showModal = false;
      this.pendingAction = null;
    },
    showRefreshFeedModal() {
      this.showRefreshModal = true;
    },
    closeRefreshModal() {
      this.showRefreshModal = false;
    },
    async executeRefreshFeed() {
      await RecommendationSystem.resetRecommendations();
      this.showRefreshModal = false;
      this.$router.replace({ name: 'Home', query: { ...this.$route.query, refresh: Date.now().toString() } });
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
        async () => { await StorageService.clearHistory(); }
      );
    },
    wipeLikes() {
      this.confirmAction(
        'Clear Likes',
        'Are you sure you want to clear all your liked posts?',
        async () => { await StorageService.clearLikes(); }
      );
    },
    wipeFavorites() {
      this.confirmAction(
        'Clear Favorites',
        'Are you sure you want to clear all your favorited posts?',
        async () => { await StorageService.clearFavorites(); }
      );
    },
    wipeDownloads() {
      this.confirmAction(
        'Clear Downloads Folder',
        'Are you sure you want to clear the downloads folder?',
        async () => { await StorageService.clearDownloads(); }
      );
    },
    wipeAll() {
      this.confirmAction(
        'Clear All Data',
        'Are you sure you want to clear ALL your data?',
        async () => {
          await StorageService.clearAllData();
          window.location.reload();
        }
      );
    },
  },
};
</script>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.slide-enter-from {
  transform: translateX(30px);
  opacity: 0;
}
.slide-leave-to {
  transform: translateX(-30px);
  opacity: 0;
}
</style>
