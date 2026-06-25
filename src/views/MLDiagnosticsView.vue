<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 DottsGit

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div class="p-4 text-white pb-20 h-full overflow-y-auto">
    <div class="max-w-4xl mx-auto space-y-6">
      <h1 class="text-3xl font-bold">ML Recommendation Diagnostics</h1>
      <p class="text-gray-400 text-sm">
        Test the ML recommendation engine, simulate user interactions, and observe learning in real-time.
      </p>

      <!-- Status Overview -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="bg-gray-800 p-4 rounded-lg">
          <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">ML Model</h3>
          <div class="flex items-center gap-2">
            <span :class="mlStats?.mlScorer?.isTrained ? 'bg-green-500' : 'bg-yellow-500'" class="w-3 h-3 rounded-full"></span>
            <span>{{ mlStats?.mlScorer?.isTrained ? 'Trained' : 'Cold Start (heuristic)' }}</span>
          </div>
          <p class="text-xs text-gray-500 mt-1">
            Interactions: {{ mlStats?.mlScorer?.interactionCount || 0 }}
          </p>
        </div>

        <div class="bg-gray-800 p-4 rounded-lg">
          <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Tag Embeddings</h3>
          <p class="text-lg font-mono">{{ mlStats?.tagEmbeddings?.totalTags || 0 }}</p>
          <p class="text-xs text-gray-500">tags with embeddings</p>
          <p class="text-xs text-gray-500">
            {{ mlStats?.tagEmbeddings?.cooccurrencePairs || 0 }} co-occurrence pairs
          </p>
        </div>

        <div class="bg-gray-800 p-4 rounded-lg">
          <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Bandit</h3>
          <p class="text-lg font-mono">{{ mlStats?.bandit?.bestStrategy?.type || 'N/A' }}</p>
          <p class="text-xs text-gray-500">
            Best strategy (expected: {{ (mlStats?.bandit?.bestStrategy?.expectedReward || 0).toFixed(2) }})
          </p>
          <p class="text-xs text-gray-500">
            Sessions: {{ mlStats?.bandit?.sessionCount || 0 }}
          </p>
        </div>
      </div>

      <!-- Training Progress -->
      <div class="bg-gray-800 p-4 rounded-lg" v-if="mlStats && mlStats.mlScorer">
        <h3 class="text-lg font-bold mb-3">Training Progress</h3>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <p class="text-sm text-gray-400">Last Loss</p>
            <p class="text-2xl font-mono" :class="getLossClass(mlStats.mlScorer.lastLoss)">
              {{ mlStats.mlScorer.lastLoss != null ? mlStats.mlScorer.lastLoss.toFixed(4) : 'N/A' }}
            </p>
          </div>
          <div>
            <p class="text-sm text-gray-400">Avg Loss</p>
            <p class="text-2xl font-mono">
              {{ mlStats.mlScorer.avgLoss?.toFixed(4) || 'N/A' }}
            </p>
          </div>
          <div>
            <p class="text-sm text-gray-400">Pending Samples</p>
            <p class="text-2xl font-mono">{{ mlStats.mlScorer.pendingSamples || 0 }}</p>
          </div>
          <div>
            <p class="text-sm text-gray-400">Model Size</p>
            <p class="text-2xl font-mono">{{ formatBytes(mlStats.mlScorer.modelSize || 0) }}</p>
          </div>
        </div>

        <!-- Loss History -->
        <div class="mt-4" v-if="lossHistory.length > 1">
          <p class="text-sm text-gray-400 mb-2">Loss History ({{ lossHistory.length }} batches)</p>
          <div class="h-24 flex items-end gap-px">
            <div
              v-for="(loss, i) in lossHistory"
              :key="i"
              class="flex-1 rounded-t transition-all duration-300"
              :class="getLossBarClass(loss)"
              :style="{ height: Math.max(4, (loss / maxLoss) * 100) + '%' }"
              :title="'Batch ' + (i+1)"
            ></div>
          </div>
        </div>
      </div>

      <!-- Bandit Arms -->
      <div class="bg-gray-800 p-4 rounded-lg" v-if="mlStats && mlStats.bandit && mlStats.bandit.arms">
        <h3 class="text-lg font-bold mb-3">Bandit Strategy Arms</h3>
        <div class="space-y-2">
          <div
            v-for="(arm, type) in mlStats.bandit.arms"
            :key="type"
            class="flex items-center gap-3 p-2 bg-gray-700 rounded"
          >
            <span class="w-20 text-sm font-mono capitalize shrink-0">{{ type }}</span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <div class="flex-1 bg-gray-900 rounded-full h-2 overflow-hidden">
                  <div
                    class="h-full bg-pink-500 transition-all duration-300"
                    :style="{ width: (arm.expectedReward * 100) + '%' }"
                  ></div>
                </div>
                <span class="text-xs font-mono w-12 text-right shrink-0">{{ (arm.expectedReward * 100).toFixed(0) }}%</span>
              </div>
              <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-1">
                <span>α: {{ arm.alpha.toFixed(1) }}</span>
                <span>β: {{ arm.beta.toFixed(1) }}</span>
                <span>Attempts: {{ arm.attempts }}</span>
                <span>Successes: {{ arm.successes }}</span>
                <span v-if="arm.consecutiveFailures > 0" class="text-red-400">
                  Failures: {{ arm.consecutiveFailures }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Simulation Controls -->
      <div class="bg-gray-800 p-4 rounded-lg">
        <h3 class="text-lg font-bold mb-3">Simulate Interactions</h3>
        <p class="text-sm text-gray-400 mb-4">
          Simulate user behavior to train the ML model. Each "like" or "favorite" trains the model.
          After {{ trainThreshold }} interactions, the ML scorer activates.
        </p>

        <div class="flex flex-wrap gap-3 mb-4">
          <button
            @click="simulateInteractions(5, 'like')"
            class="px-4 py-2 bg-pink-600 hover:bg-pink-500 rounded text-sm font-medium transition-colors"
          >
            +5 Likes
          </button>
          <button
            @click="simulateInteractions(5, 'favorite')"
            class="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded text-sm font-medium transition-colors"
          >
            +5 Favorites
          </button>
          <button
            @click="simulateInteractions(5, 'dislike')"
            class="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm font-medium transition-colors"
          >
            +5 Dislikes
          </button>
          <button
            @click="simulateInteractions(10, 'mixed')"
            class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors"
          >
            +10 Mixed
          </button>
          <button
            @click="simulateInteractions(20, 'timeSpent')"
            class="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded text-sm font-medium transition-colors"
          >
            +20 Time Spent
          </button>
        </div>

        <div class="flex gap-3">
          <button
            @click="resetML"
            class="px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-sm font-medium transition-colors"
          >
            Reset ML State
          </button>
          <button
            @click="refreshStats"
            class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium transition-colors"
          >
            Refresh Stats
          </button>
        </div>
      </div>

      <!-- Scoring Test -->
      <div class="bg-gray-800 p-4 rounded-lg">
        <h3 class="text-lg font-bold mb-3">Score Comparison</h3>
        <p class="text-sm text-gray-400 mb-4">
          Compare heuristic vs ML scores for sample posts. Posts are generated from common booru tags.
        </p>

        <button
          @click="generateAndScorePosts"
          class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium transition-colors mb-4"
        >
          Generate & Score 10 Sample Posts
        </button>

        <div v-if="scoredPosts.length > 0" class="space-y-2">
          <div class="grid grid-cols-12 gap-2 text-xs text-gray-500 uppercase tracking-wider px-2 pb-1 border-b border-gray-700">
            <div class="col-span-1">#</div>
            <div class="col-span-4">Tags (sample)</div>
            <div class="col-span-2 text-right">Heuristic</div>
            <div class="col-span-2 text-right">ML Score</div>
            <div class="col-span-2 text-right">Blended</div>
            <div class="col-span-1 text-right">ML?</div>
          </div>
          <div
            v-for="(item, i) in scoredPosts"
            :key="i"
            class="grid grid-cols-12 gap-2 items-center p-2 bg-gray-700 rounded text-sm"
          >
            <div class="col-span-1 text-gray-500">{{ i + 1 }}</div>
            <div class="col-span-4 truncate text-xs font-mono" :title="item.tags">
              {{ item.tags }}
            </div>
            <div class="col-span-2 text-right font-mono">
              {{ item.heuristic.toFixed(3) }}
            </div>
            <div class="col-span-2 text-right font-mono" :class="getMLScoreClass(item.mlScore)">
              {{ item.mlScore > 0 ? item.mlScore.toFixed(3) : 'N/A' }}
            </div>
            <div class="col-span-2 text-right font-mono text-pink-400">
              {{ item.blended.toFixed(3) }}
            </div>
            <div class="col-span-1 text-right">
              <span v-if="item.mlActive" class="text-green-400">✓</span>
              <span v-else class="text-gray-600">—</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Tag Similarity Test -->
      <div class="bg-gray-800 p-4 rounded-lg">
        <h3 class="text-lg font-bold mb-3">Tag Embedding Similarity</h3>
        <p class="text-sm text-gray-400 mb-4">
          Find tags most similar to a given tag based on co-occurrence patterns in your interaction history.
        </p>

        <div class="flex gap-3 mb-4">
          <input
            v-model="similarityQuery"
            @input="findSimilarTags"
            type="text"
            placeholder="Enter a tag (e.g., hatsune_miku)"
            class="flex-1 bg-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-pink-500 focus:outline-none"
          />
        </div>

        <div v-if="similarTags.length > 0" class="space-y-1">
          <div
            v-for="item in similarTags"
            :key="item.tag"
            class="flex items-center gap-3 p-2 bg-gray-700 rounded"
          >
            <span class="flex-1 text-sm font-mono">{{ item.tag }}</span>
            <div class="w-32 bg-gray-900 rounded-full h-2 overflow-hidden">
              <div
                class="h-full bg-blue-500"
                :style="{ width: ((item.similarity + 1) / 2 * 100) + '%' }"
              ></div>
            </div>
            <span class="text-xs font-mono w-16 text-right">
              {{ item.similarity.toFixed(3) }}
            </span>
          </div>
        </div>
        <div v-else-if="similarityQuery" class="text-gray-500 text-sm">
          No similar tags found. Try a tag you've interacted with.
        </div>
      </div>

      <!-- Event Log -->
      <div class="bg-gray-800 p-4 rounded-lg">
        <div class="flex justify-between items-center mb-3">
          <h3 class="text-lg font-bold">Event Log</h3>
          <button @click="eventLog = []" class="text-xs text-gray-400 hover:text-white">
            Clear
          </button>
        </div>
        <div class="h-48 overflow-y-auto space-y-1 font-mono text-xs">
          <div
            v-for="(event, i) in eventLog.slice().reverse()"
            :key="i"
            class="flex gap-2"
          >
            <span class="text-gray-600 shrink-0">{{ event.time }}</span>
            <span :class="getEventTypeClass(event.type)">{{ event.message }}</span>
          </div>
          <div v-if="eventLog.length === 0" class="text-gray-600">
            No events yet. Interact with posts or use the simulation buttons.
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import RecommendationSystem from '../services/RecommendationSystem';

// Sample tags for generating test posts
const SAMPLE_TAG_POOLS = [
  'hatsune_miku vocaloid 1girl solo long_hair blue_hair twintails',
  'rem_(re:zero) 1girl solo long_hair maid_headdress',
  'ganyu_(genshin_impact) 1girl solo long_hair horns',
  'saber_(fate) 1girl solo long_hair sword',
  'mikasa_ackerman 1girl solo short_hair survey_corps',
  'nezuko_kamado 1girl solo long_hair demon',
  'saber_(fate) 1girl armor sword',
  'hatsune_miku 1girl solo vocaloid headphones',
  'ganyu_(genshin_impact) 1girl solo purple_eyes',
  'rem_(re:zero) 1girl solo blue_hair maid',
  '1girl solo scenery landscape nature',
  '1girl solo original highres absurdres',
  '2girls group multiple_girls',
  '1boy solo scenery',
  '1girl solo short_hair red_eyes',
];

const RATINGS = ['g', 'g', 'g', 's', 'q'];

export default {
  name: 'MLDiagnosticsView',
  data() {
    return {
      mlStats: null,
      lossHistory: [],
      scoredPosts: [],
      similarityQuery: '',
      similarTags: [],
      eventLog: [],
      trainThreshold: 20,
      pollInterval: null,
    };
  },
  async mounted() {
    try {
      await RecommendationSystem.initialize();
      this.log('success', 'Recommendation system initialized');
      await this.refreshStats();
      this.pollInterval = setInterval(() => this.refreshStats(), 2000);
    } catch (e) {
      this.log('error', 'Failed to initialize: ' + e.message);
    }
  },
  beforeUnmount() {
    if (this.pollInterval) clearInterval(this.pollInterval);
  },
  methods: {
    log(type, message) {
      const time = new Date().toLocaleTimeString();
      this.eventLog.push({ time, type, message });
      if (this.eventLog.length > 100) this.eventLog.shift();
    },

    async refreshStats() {
      try {
        const stats = await RecommendationSystem.getMLStats();
        if (stats) {
          this.mlStats = stats;
          if (stats.mlScorer?.trainingHistory) {
            this.lossHistory = stats.mlScorer.trainingHistory;
          }
        }
      } catch (e) {
        this.log('error', 'Failed to get stats: ' + e.message);
      }
    },

    async simulateInteractions(count, type) {
      this.log('info', `Simulating ${count} ${type} interactions...`);

      for (let i = 0; i < count; i++) {
        const tags = SAMPLE_TAG_POOLS[Math.floor(Math.random() * SAMPLE_TAG_POOLS.length)];
        const rating = RATINGS[Math.floor(Math.random() * RATINGS.length)];
        const post = {
          id: 100000 + Date.now() + i,
          tag_string: tags,
          tag_string_general: tags,
          tag_string_artist: '',
          tag_string_character: '',
          tag_string_copyright: '',
          tag_string_meta: '',
          rating,
          file_ext: Math.random() > 0.8 ? 'mp4' : 'jpg',
          width: 1920,
          height: 1080,
          score: Math.floor(Math.random() * 500),
          source: 'https://danbooru.donmai.us',
          _strategy: ['anchor', 'pivot', 'reach', 'wildcard'][Math.floor(Math.random() * 4)],
        };

        let interactionType = type;
        let value = 1;

        if (type === 'mixed') {
          const types = ['like', 'favorite', 'dislike', 'view', 'timeSpent'];
          interactionType = types[Math.floor(Math.random() * types.length)];
          value = interactionType === 'timeSpent' ? 5000 + Math.random() * 25000 : 1;
        } else if (type === 'timeSpent') {
          interactionType = 'timeSpent';
          value = 3000 + Math.random() * 27000;
        } else if (interactionType === 'like') {
          value = 1;
        } else if (interactionType === 'favorite') {
          value = 1;
        } else if (interactionType === 'dislike') {
          value = 1;
        }

        try {
          await RecommendationSystem.trackInteraction(
            post.id,
            interactionType,
            value,
            post,
            false
          );
        } catch (e) {
          this.log('error', `Interaction ${i} failed: ${e.message}`);
        }
      }

      // Force profile update after batch
      try {
        await RecommendationSystem.updateUserProfile();
        this.log('ml', `Processed ${count} interactions. Model updating...`);
      } catch (e) {
        this.log('error', 'Profile update failed: ' + e.message);
      }

      await this.refreshStats();
    },

    async resetML() {
      try {
        await RecommendationSystem.resetRecommendations();
        this.log('info', 'ML state reset to defaults');
        this.lossHistory = [];
        this.scoredPosts = [];
        await this.refreshStats();
      } catch (e) {
        this.log('error', 'Reset failed: ' + e.message);
      }
    },

    async generateAndScorePosts() {
      this.log('info', 'Generating sample posts and scoring...');
      const posts = [];

      for (let i = 0; i < 10; i++) {
        const tags = SAMPLE_TAG_POOLS[i % SAMPLE_TAG_POOLS.length];
        const rating = RATINGS[i % RATINGS.length];
        posts.push({
          id: 200000 + i,
          tag_string: tags,
          tag_string_general: tags,
          tag_string_artist: '',
          tag_string_character: '',
          tag_string_copyright: '',
          tag_string_meta: '',
          rating,
          file_ext: i % 5 === 0 ? 'mp4' : 'jpg',
          width: 1920,
          height: 1080,
          score: Math.floor(Math.random() * 500),
          source: 'https://danbooru.donmai.us',
        });
      }

      const results = [];
      for (const post of posts) {
        try {
          const details = await RecommendationSystem.getPostScoreDetails(post);
          const mlScore = details.mlScore || 0;
          const mlActive = details.mlScore !== null && details.mlScore !== undefined;

          results.push({
            tags: post.tag_string.substring(0, 50),
            heuristic: details.totalScore,
            mlScore: mlScore,
            blended: details.totalScore,
            mlActive,
          });
        } catch (e) {
          this.log('error', `Scoring post ${post.id} failed: ${e.message}`);
        }
      }

      // Sort by blended score descending
      results.sort((a, b) => b.blended - a.blended);
      this.scoredPosts = results;
      this.log('ml', `Scored ${results.length} posts. ML active: ${this.mlStats?.mlScorer?.isTrained}`);
    },

    async findSimilarTags() {
      if (!this.similarityQuery.trim()) {
        this.similarTags = [];
        return;
      }

      try {
        this.log('info', `Querying similarity for "${this.similarityQuery}"...`);
        const results = await RecommendationSystem.findSimilarTags(this.similarityQuery, 10);
        this.similarTags = results;
        if (results.length === 0) {
          this.log('info', 'No similar tags found. The tag may not be in your embeddings yet.');
        } else {
          this.log('ml', `Found ${results.length} similar tags`);
        }
      } catch (e) {
        this.log('error', 'Similarity query failed: ' + e.message);
      }
    },

    formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      return (bytes / 1024).toFixed(1) + ' KB';
    },

    getLossClass(loss) {
      if (loss == null) return 'text-gray-500';
      if (loss < 0.3) return 'text-green-400';
      if (loss < 0.5) return 'text-yellow-400';
      return 'text-red-400';
    },

    getLossBarClass(loss) {
      if (loss < 0.3) return 'bg-green-500';
      if (loss < 0.5) return 'bg-yellow-500';
      return 'bg-red-500';
    },

    getMLScoreClass(score) {
      if (score > 0.6) return 'text-green-400';
      if (score > 0.3) return 'text-yellow-400';
      return 'text-gray-500';
    },

    getEventTypeClass(type) {
      const map = {
        success: 'text-green-400',
        info: 'text-yellow-400',
        error: 'text-red-400',
        ml: 'text-pink-400',
      };
      return map[type] || 'text-gray-400';
    },

    get maxLoss() {
      return Math.max(0.5, ...this.lossHistory);
    },
  },
};
