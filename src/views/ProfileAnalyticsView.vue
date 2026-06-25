<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 DottsGit

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div class="p-4 text-white pb-20 h-full overflow-y-auto"> <!-- Added h-full and overflow-y-auto -->
    <div class="max-w-7xl mx-auto space-y-6">
      
      <!-- Header & Toggles -->
      <div class="space-y-4">
        <h1 class="text-3xl font-bold">Profile Analytics</h1>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Include Tags -->
          <div class="bg-gray-800 p-4 rounded-lg">
            <h2 class="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">Include Tags</h2>
            <div class="flex flex-wrap gap-2">
              <button 
                v-for="(active, type) in toggles" 
                :key="type"
                @click="toggles[type] = !active"
                :class="[
                  'px-4 py-2 rounded-full text-sm font-medium transition-colors',
                  active 
                    ? 'bg-pink-600 text-white hover:bg-pink-500' 
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                ]"
              >
                {{ capitalize(type) }}
              </button>
            </div>
          </div>

          <!-- Filters -->
          <div class="bg-gray-800 p-4 rounded-lg">
            <h2 class="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">Filters</h2>
            <div class="flex flex-col gap-3">
               <div class="flex items-center gap-2">
                 <button 
                  @click="hideCommonTags = !hideCommonTags"
                  :class="[
                    'px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap',
                    hideCommonTags 
                      ? 'bg-purple-600 text-white hover:bg-purple-500' 
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  ]"
                >
                  Hide Tags
                </button>
                <input 
                  type="text" 
                  v-model.lazy="commonTagsInput"
                  placeholder="Tags to hide (space separated)"
                  class="bg-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-purple-500 focus:outline-none"
                >
               </div>
               <p class="text-xs text-gray-500">Separate tags with spaces</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="flex justify-center py-12">
        <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-pink-500"></div>
      </div>

      <!-- Content Grid -->
      <div v-else class="grid gap-4 auto-rows-min" style="grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));">
        
        <!-- Top Tags - Recommendation System Scores (1x1) -->
        <div class="bg-gray-800 rounded-lg p-4 h-80 flex flex-col">
          <h3 class="text-lg font-bold mb-4 flex items-center gap-2">
            <span>🏆</span> Top Tags
          </h3>
          <div class="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
            <div v-for="(score, tag, index) in recommendationTagScores" :key="tag" class="flex justify-between items-center p-2 bg-gray-700 rounded hover:bg-gray-600 transition">
              <div class="flex items-center gap-2 truncate">
                <span class="text-gray-500 text-xs font-mono w-6">{{ index + 1 }}</span>
                <span class="text-gray-200 truncate">{{ tag }}</span>
              </div>
              <span class="bg-gray-900 px-2 py-1 rounded text-xs font-mono text-emerald-400">{{ formatScore(score) }}</span>
            </div>
            <div v-if="Object.keys(recommendationTagScores).length === 0" class="text-center text-gray-500 mt-10">
              No data available
            </div>
          </div>
        </div>

        <!-- Distribution Pie Chart (1x1) -->
        <div class="bg-gray-800 rounded-lg p-4 h-80 flex flex-col">
           <h3 class="text-lg font-bold mb-4 flex items-center gap-2">
            <span>🍰</span> Tag Distribution
          </h3>
          <div class="flex-1 flex items-center justify-center relative min-h-0">
             <!-- SVG Pie Chart -->
             <svg viewBox="0 0 100 100" class="h-full w-full max-h-40 filter drop-shadow-xl" v-if="pieData.length > 0">
                <circle v-for="(slice, index) in pieSlices" :key="index"
                  cx="50" cy="50" r="40"
                  fill="transparent"
                  :stroke="slice.color"
                  :stroke-width="20"
                  :stroke-dasharray="slice.dashArray"
                  :stroke-dashoffset="slice.dashOffset"
                  class="transition-all duration-1000 ease-out hover:opacity-90"
                />
             </svg>
             
             <div v-if="pieData.length === 0" class="text-gray-500">No data available</div>
          </div>
          <div class="mt-4 flex flex-wrap justify-center gap-3 text-xs">
              <div v-for="slice in pieData" :key="slice.label" class="flex items-center gap-1">
                  <span class="w-3 h-3 rounded-full" :style="{ backgroundColor: slice.color }"></span>
                  <span class="text-gray-300">{{ slice.label }} ({{ slice.percentage }}%)</span>
              </div>
          </div>
        </div>

        <!-- Most Liked Tags (1x1) -->
        <div class="bg-gray-800 rounded-lg p-4 h-80 flex flex-col">
          <h3 class="text-lg font-bold mb-4 flex items-center gap-2">
            <span>�</span> Most Liked Tags
          </h3>
          <div class="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
            <div v-for="(count, tag, index) in topTags" :key="tag" class="flex justify-between items-center p-2 bg-gray-700 rounded hover:bg-gray-600 transition">
              <div class="flex items-center gap-2 truncate">
                <span class="text-gray-500 text-xs font-mono w-6">{{ index + 1 }}</span>
                <span class="text-gray-200 truncate">{{ tag }}</span>
              </div>
              <span class="bg-gray-900 px-2 py-1 rounded text-xs font-mono text-pink-400">{{ count }}</span>
            </div>
            <div v-if="Object.keys(topTags).length === 0" class="text-center text-gray-500 mt-10">
              No data available
            </div>
          </div>
        </div>

        <!-- Tag Pairs (1x1) -->
        <div class="bg-gray-800 rounded-lg p-4 h-80 flex flex-col">
          <h3 class="text-lg font-bold mb-4 flex items-center gap-2">
            <span>🔗</span> Top Tag Pairs
          </h3>
          <div class="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
             <div v-for="(count, pair, index) in topTagPairs" :key="pair" class="flex justify-between items-center p-2 bg-gray-700 rounded hover:bg-gray-600 transition">
              <div class="flex items-center gap-2 truncate max-w-[70%]">
                <span class="text-gray-500 text-xs font-mono w-6">{{ index + 1 }}</span>
                <span class="text-gray-200 text-sm truncate">{{ pair }}</span>
              </div>
              <span class="bg-gray-900 px-2 py-1 rounded text-xs font-mono text-blue-400">{{ count }}</span>
            </div>
            <div v-if="Object.keys(topTagPairs).length === 0" class="text-center text-gray-500 mt-10">
              No data available
            </div>
          </div>
        </div>

        <!-- Highest Like Rate (1x1) -->
        <div class="bg-gray-800 rounded-lg p-4 h-80 flex flex-col">
          <div class="flex justify-between items-start mb-4">
             <h3 class="text-lg font-bold flex items-center gap-2">
                <span>❤️</span> Highest Like Rate
             </h3>
             <div class="flex flex-col items-end">
                <span class="text-xs text-gray-400">Min views</span>
                <input 
                    type="number" 
                    v-model.number="minViews.likes" 
                    class="w-12 bg-gray-700 text-white text-xs px-1 py-0.5 rounded border border-gray-600 focus:border-pink-500 focus:outline-none text-center"
                    min="1"
                >
             </div>
          </div>
          <div class="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
             <div v-for="(item, index) in likeRates" :key="item.tag" class="flex justify-between items-center p-2 bg-gray-700 rounded hover:bg-gray-600 transition">
              <div class="flex items-center gap-2 truncate max-w-[70%]">
                <span class="text-gray-500 text-xs font-mono w-6">{{ index + 1 }}</span>
                <div class="flex flex-col truncate">
                   <span class="text-gray-200 font-medium truncate">{{ item.tag }}</span>
                   <span class="text-xs text-gray-500">{{ item.likes }}/{{ item.views }} viewed</span>
                </div>
              </div>
              <span class="bg-gray-900 px-2 py-1 rounded text-xs font-mono text-red-500 font-bold">{{ item.rate }}%</span>
            </div>
             <div v-if="likeRates.length === 0" class="text-center text-gray-500 mt-10">
              No data available
            </div>
          </div>
        </div>

        <!-- Highest Favorite Rate (1x1) -->
        <div class="bg-gray-800 rounded-lg p-4 h-80 flex flex-col">
          <div class="flex justify-between items-start mb-4">
             <h3 class="text-lg font-bold flex items-center gap-2">
                <span>⭐</span> Highest Favorite Rate
             </h3>
             <div class="flex flex-col items-end">
                <span class="text-xs text-gray-400">Min views</span>
                <input 
                    type="number" 
                    v-model.number="minViews.favorites" 
                    class="w-12 bg-gray-700 text-white text-xs px-1 py-0.5 rounded border border-gray-600 focus:border-yellow-500 focus:outline-none text-center"
                    min="1"
                >
             </div>
          </div>
          <div class="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
             <div v-for="(item, index) in favoriteRates" :key="item.tag" class="flex justify-between items-center p-2 bg-gray-700 rounded hover:bg-gray-600 transition">
              <div class="flex items-center gap-2 truncate max-w-[70%]">
                <span class="text-gray-500 text-xs font-mono w-6">{{ index + 1 }}</span>
                <div class="flex flex-col truncate">
                   <span class="text-gray-200 font-medium truncate">{{ item.tag }}</span>
                   <span class="text-xs text-gray-500">{{ item.favorites }}/{{ item.views }} viewed</span>
                </div>
              </div>
              <span class="bg-gray-900 px-2 py-1 rounded text-xs font-mono text-yellow-500 font-bold">{{ item.rate }}%</span>
            </div>
            <div v-if="favoriteRates.length === 0" class="text-center text-gray-500 mt-10">
              No data available
            </div>
          </div>
        </div>

        <!-- Highest Dislike Rate (1x1) -->
        <div class="bg-gray-800 rounded-lg p-4 h-80 flex flex-col">
          <div class="flex justify-between items-start mb-4">
             <h3 class="text-lg font-bold flex items-center gap-2">
                <span>💔</span> Highest Dislike Rate
             </h3>
             <div class="flex flex-col items-end">
                <span class="text-xs text-gray-400">Min views</span>
                <input 
                    type="number" 
                    v-model.number="minViews.dislikes" 
                    class="w-12 bg-gray-700 text-white text-xs px-1 py-0.5 rounded border border-gray-600 focus:border-indigo-500 focus:outline-none text-center"
                    min="1"
                >
             </div>
          </div>
          <div class="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
             <div v-for="(item, index) in dislikeRates" :key="item.tag" class="flex justify-between items-center p-2 bg-gray-700 rounded hover:bg-gray-600 transition">
              <div class="flex items-center gap-2 truncate max-w-[70%]">
                <span class="text-gray-500 text-xs font-mono w-6">{{ index + 1 }}</span>
                <div class="flex flex-col truncate">
                   <span class="text-gray-200 font-medium truncate">{{ item.tag }}</span>
                   <span class="text-xs text-gray-500">{{ item.dislikes }}/{{ item.views }} viewed</span>
                </div>
              </div>
              <span class="bg-gray-900 px-2 py-1 rounded text-xs font-mono text-gray-400 font-bold">{{ item.rate }}%</span>
            </div>
            <div v-if="dislikeRates.length === 0" class="text-center text-gray-500 mt-10">
              No data available
            </div>
          </div>
        </div>

        <!-- Most Disliked Tags (1x1) -->
        <div class="bg-gray-800 rounded-lg p-4 h-80 flex flex-col">
          <h3 class="text-lg font-bold mb-4 flex items-center gap-2">
            <span>👎</span> Most Disliked Tags
          </h3>
          <div class="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
             <div v-for="(count, tag, index) in topDislikedTags" :key="tag" class="flex justify-between items-center p-2 bg-gray-700 rounded hover:bg-gray-600 transition">
              <div class="flex items-center gap-2 truncate">
                <span class="text-gray-500 text-xs font-mono w-6">{{ index + 1 }}</span>
                <span class="text-gray-200 truncate">{{ tag }}</span>
              </div>
              <span class="bg-gray-900 px-2 py-1 rounded text-xs font-mono text-gray-400">{{ count }}</span>
            </div>
            <div v-if="Object.keys(topDislikedTags).length === 0" class="text-center text-gray-500 mt-10">
              No data available
            </div>
          </div>
        </div>

        <!-- Video Analytics (1x1) -->
        <div class="bg-gray-800 rounded-lg p-4 h-80 flex flex-col">
          <h3 class="text-lg font-bold mb-4 flex items-center gap-2">
            <span>🎥</span> Video Analytics
          </h3>
          <div class="flex-1 flex flex-col justify-center items-center gap-6">
             <div class="text-center">
                 <div class="text-4xl font-bold text-white mb-2">{{ videoStats.avgWatchTime }}s</div>
                 <div class="text-sm text-gray-400">Avg Watch Time</div>
             </div>
             <div class="w-full h-px bg-gray-700"></div>
             <div class="text-center">
                 <div class="text-2xl font-bold text-white mb-2">{{ videoStats.totalVideosWatched }}</div>
                 <div class="text-sm text-gray-400">Videos Watched</div>
             </div>
             <!-- Future: Completion rate? -->
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<script>
import StorageService from '../services/StorageService';
import RecommendationSystem, { COMMON_TAGS } from '../services/RecommendationSystem';

export default {
  name: 'ProfileAnalyticsView',
  data() {
    return {
      toggles: {
        general: true,
        artist: true,
        character: true,
        copyright: true,
        meta: false // Danbooru meta tags
      },
      hideCommonTags: true,
      minViews: {
        likes: 25,
        favorites: 25,
        dislikes: 25
      },
      loading: true,
      rawHistory: [],
      rawInteractions: [],
      processedData: {
        tagCounts: {},
        tagPairCounts: {},
        tagViews: {},
        tagLikes: {},
        tagFavorites: {},
        tagDislikes: {},
        videoTimes: []
      },
      loadedTagScores: {},
      commonTagsInput: COMMON_TAGS.join(' ')
    };
  },
  computed: {
    parsedCommonTags() {
        if (!this.commonTagsInput) return [];
        return this.commonTagsInput.split(' ').map(t => t.trim()).filter(Boolean);
    },

    // Filter tags based on toggles
    // We will re-compute the display lists from processedData + toggles
    
    activeCategories() {
       return Object.keys(this.toggles).filter(k => this.toggles[k]);
    },

    recommendationTagScores() {
        // Filter out hidden tags
        const filtered = Object.entries(this.loadedTagScores)
            .filter(([tag]) => this.isTagHidden(tag) === false)
            .slice(0, 50);
        return Object.fromEntries(filtered);
    },

    topTags() {
        const sorted = Object.entries(this.processedData.tagCounts)
            .filter(([tag]) => this.isTagHidden(tag) === false)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 50);
        return Object.fromEntries(sorted);
    },

    topDislikedTags() {
        const sorted = Object.entries(this.processedData.tagDislikes)
            .filter(([tag]) => this.isTagHidden(tag) === false)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 50);
        return Object.fromEntries(sorted);
    },

    topTagPairs() {
         const sorted = Object.entries(this.processedData.tagPairCounts)
            .filter(([pair]) => {
                const parts = pair.split(' + ');
                return parts.every(t => !this.isTagHidden(t));
            })
            .sort((a, b) => b[1] - a[1])
            .slice(0, 50);
        return Object.fromEntries(sorted);
    },



    pieData() {
        // Use loaded tag scores for the pie chart (top 10 tags)
        const sorted = Object.entries(this.loadedTagScores)
             .filter(([tag]) => !this.isTagHidden(tag))
             .filter(([, score]) => score > 0)
            .sort((a, b) => b[1] - a[1]);
        
        if (sorted.length === 0) return [];

        const top10 = sorted.slice(0, 10);
        
        const data = top10.map(([label, value], index) => ({
            label, 
            value, 
            color: this.getPieColor(index)
        }));

        const total = data.reduce((sum, d) => sum + d.value, 0);
        return data.map(d => ({ ...d, percentage: ((d.value / total) * 100).toFixed(1) }));
    },

    pieSlices() {
        let cumulativePercent = 0;
        return this.pieData.map(slice => {
            const percent = parseFloat(slice.percentage);
            const dashArray = `${percent * 2.51} 251.2`; // 2 * PI * 40 ≈ 251.2
            const dashOffset = -cumulativePercent * 2.51;
            cumulativePercent += percent;
            return { ...slice, dashArray, dashOffset };
        });
    },

    likeRates() {
        return this.calculateRates(this.processedData.tagLikes, this.minViews.likes);
    },

    favoriteRates() {
        return this.calculateRates(this.processedData.tagFavorites, this.minViews.favorites);
    },

    dislikeRates() {
        return this.calculateRates(this.processedData.tagDislikes, this.minViews.dislikes);
    },

    videoStats() {
        const count = this.processedData.videoTimes.length;
        if (count === 0) return { avgWatchTime: 0, totalVideosWatched: 0 };
        
        const totalTime = this.processedData.videoTimes.reduce((a, b) => a + b, 0);
        return {
            avgWatchTime: (totalTime / count / 1000).toFixed(1),
            totalVideosWatched: count
        };
    }
  },
  async mounted() {
    // Ensure recommendation system is initialized (loads from IndexedDB)
    await RecommendationSystem.initialize();
    await this.calculateAnalytics();
  },
  methods: {
    capitalize(s) {
      return s.charAt(0).toUpperCase() + s.slice(1);
    },
    formatScore(score) {
      // Display raw recommendation score (not percentage - that was misleading)
      return score.toFixed(2);
    },
    getPieColor(i) {
        const colors = [
            '#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', // pink, violet, blue, emerald, amber
            '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#6366f1'  // red, cyan, lime, orange, indigo
        ];
        return colors[i % colors.length];
    },
    isTagHidden(tag) {
        if (this.hideCommonTags && this.parsedCommonTags.includes(tag)) return true;

        // Tag categorization logic
        // We need to look up the tag type. 
        // Since we aggregated counts but maybe not types in the simple map, we might need a tagTypeMap.
        const type = this.processedData.tagTypeMap[tag] || 'general';
        // Note: Danbooru types: 0=general, 1=artist, 3=copyright, 4=character, 5=meta
        // We mapped them to strings in processing
        return !this.toggles[type];
    },
    calculateRates(interactionMap, minViewThreshold = 3) {
        return Object.entries(interactionMap)
            .filter(([tag]) => !this.isTagHidden(tag))
            .map(([tag, count]) => {
                const views = this.processedData.tagViews[tag] || 0;
                if (views < minViewThreshold) return null;
                return {
                    tag,
                    favorites: count, // or likes
                    likes: count, // reused structure
                    dislikes: count, // reused structure
                    views,
                    rate: ((count / views) * 100).toFixed(1)
                };
            })
            .filter(Boolean)
            .sort((a, b) => parseFloat(b.rate) - parseFloat(a.rate))
            .slice(0, 50);
    },
    async calculateAnalytics() {
      this.loading = true;
      
      this.loadedTagScores = await RecommendationSystem.summarizeTagScores(50);
      
      // 1. Fetch Data
      // view history: { postId: { lastViewed, data: post } }
      const history = await StorageService.getViewedPosts(); 
      // interactions: [ { type, postId, value, metadata } ]
      const interactions = await StorageService.getInteractions();

      const tagCounts = {};
      const tagPairCounts = {};
      const tagViews = {};
      const tagTypeMap = {}; // tag -> 'general' | 'artist' | ...
      
      const tagLikes = {};
      const tagFavorites = {};
      const tagDislikes = {};
      const videoTimes = [];

      // Process View History for Tops & Pairs
      Object.values(history).forEach(entry => {
          const post = entry.data;
          if (!post) return;

          // Categorize and Collect Tags
          const tags = this.extractTagsWithType(post);
          
          // Count Tags & Views
          tags.forEach(({ name, type }) => {
              tagCounts[name] = (tagCounts[name] || 0) + 1;
              tagViews[name] = (tagViews[name] || 0) + 1;
              tagTypeMap[name] = type;
          });

          // Tag Pairs (nCr pairs) - Only within same post
          // Limit to avoid n^2 explosion on heavy tags? Danbooru posts can have 50+ tags.
          // Let's only pair "Copyright+Character" or "Artist+Character" or similar valuable pairs?
          // or just all pairs but maybe limit to top 20 tags in the post?
          // For simplicity, let's take all tags but filter significantly in display? 
          // Actually, let's just do pairs for now.
          for (let i = 0; i < tags.length; i++) {
              for (let j = i + 1; j < tags.length; j++) {
                  // Sort to ensure A+B is same as B+A
                  const pair = [tags[i].name, tags[j].name].sort().join(' + ');
                  tagPairCounts[pair] = (tagPairCounts[pair] || 0) + 1;
              }
          }
      });

      // Process Interactions for Rates
      const likes = interactions.filter(i => i.type === 'like' && i.value > 0);
      likes.forEach(i => {
          const post = i.metadata?.post;
          if(post) {
             const tags = this.extractTagsWithType(post);
             tags.forEach(({ name }) => {
                 tagLikes[name] = (tagLikes[name] || 0) + 1;
             });
          }
      });

      const favorites = interactions.filter(i => i.type === 'favorite' && i.value > 0);
      favorites.forEach(i => {
           const post = i.metadata?.post;
          if(post) {
             const tags = this.extractTagsWithType(post);
             tags.forEach(({ name }) => {
                 tagFavorites[name] = (tagFavorites[name] || 0) + 1;
             });
          }
      });

      const dislikes = interactions.filter(i => i.type === 'dislike' && i.value > 0);
      dislikes.forEach(i => {
           const post = i.metadata?.post;
          if(post) {
             const tags = this.extractTagsWithType(post);
             tags.forEach(({ name }) => {
                 tagDislikes[name] = (tagDislikes[name] || 0) + 1;
             });
          }
      });

      // Process Time Spent (Video)
      const timeSpent = interactions.filter(i => i.type === 'timeSpent' && i.metadata?.post?.file_ext && ['mp4','webm'].includes(i.metadata.post.file_ext));
      timeSpent.forEach(i => {
          if (i.value > 0) videoTimes.push(i.value);
      });

      this.processedData = {
          tagCounts,
          tagPairCounts,
          tagViews,
          tagTypeMap,
          tagLikes,
          tagFavorites,
          tagDislikes,
          videoTimes,
      };
      
      this.loading = false;
    },
    extractTagsWithType(post) {
        // Danbooru JSON typically has tag_string_general, tag_string_character etc.
        const tags = [];
        
        const processStr = (str, type) => {
            if (!str) return;
            str.split(' ').forEach(t => {
                if (t.trim()) tags.push({ name: t.trim(), type });
            });
        };

        if (post.tag_string_general) processStr(post.tag_string_general, 'general');
        else if (post.tag_string) processStr(post.tag_string, 'general'); // Fallback if detailed fields missing

        processStr(post.tag_string_artist, 'artist');
        processStr(post.tag_string_character, 'character');
        processStr(post.tag_string_copyright, 'copyright');
        processStr(post.tag_string_meta, 'meta');

        return tags;
    }
  }
};
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: rgba(31, 41, 55, 0.5); 
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(75, 85, 99, 0.8); 
  border-radius: 3px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(107, 114, 128, 1); 
}
</style>
