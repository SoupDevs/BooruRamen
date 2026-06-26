/*
 * BooruRamen - A personalized booru browser
 * Copyright (C) 2025 DottsGit
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
/**
 * StorageService.js
 * Handles persistent storage of user data and interactions using IndexedDB via Dexie.js
 */

import { db, migrateFromLocalStorage } from './db.js';

// Run migration on module load
migrateFromLocalStorage();

/**
 * Convert Vue Proxy objects to plain objects for IndexedDB storage.
 * IndexedDB cannot clone Vue reactive Proxy objects directly.
 */
const toPlainObject = (obj) => {
  if (obj === null || obj === undefined) return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    console.warn('Failed to serialize object:', e);
    return obj;
  }
};

/**
 * Store user interaction with a post
 * @param {Object} interaction - The interaction data
 * @param {string} interaction.postId - ID of the post
 * @param {string} interaction.type - Type of interaction ('view', 'like', 'dislike', 'favorite', 'timeSpent')
 * @param {number} interaction.value - Value of the interaction (1 for boolean actions, milliseconds for timeSpent)
 * @param {Object} interaction.metadata - Additional metadata for the interaction
 */
const storeInteraction = async (interaction) => {
  if (!interaction.postId || !interaction.type) {
    console.error('Invalid interaction data:', interaction);
    return false;
  }

  // Derive source from metadata if available, defaulting to null/undefined
  const source = interaction.metadata && interaction.metadata.post ? interaction.metadata.post.source : null;
  const timestamp = Date.now();

  try {
    // Check if interaction already exists
    const existing = await db.interactions
      .where('[postId+type+source]')
      .equals([interaction.postId, interaction.type, source])
      .first();

    if (existing) {
      // Update existing interaction
      await db.interactions.update(existing.id, toPlainObject({
        ...interaction,
        source,
        timestamp,
      }));
    } else {
      // Add new interaction
      const id = await db.interactions.add(toPlainObject({
        ...interaction,
        source,
        timestamp,
      }));
    }
    return true;
  } catch (error) {
    console.error('[Storage] Error storing interaction:', error);
    return false;
  }
};

/**
 * Get user interactions, optionally filtered by type
 */
const getInteractions = async (type = null) => {
  try {
    if (type) {
      return await db.interactions.where('type').equals(type).toArray();
    }
    return await db.interactions.toArray();
  } catch (error) {
    console.error('Error getting interactions:', error);
    return [];
  }
};

/**
 * Get recent interactions since a specific timestamp
 */
const getRecentInteractions = async (sinceTimestamp) => {
  try {
    const timestamp = Number(sinceTimestamp) || 0;
    console.log(`[Storage] Fetching interactions since ${timestamp} (${new Date(timestamp).toISOString()})`);

    const results = await db.interactions
      .where('timestamp')
      .above(timestamp)
      .toArray();

    // Double check with JS filter in case of index issues
    const filtered = results.filter(i => i.timestamp > timestamp);
    console.log(`[Storage] Found ${filtered.length} interactions (Raw: ${results.length})`);

    return filtered;
  } catch (error) {
    console.error('Error getting recent interactions:', error);
    return [];
  }
};

/**
 * Get interactions by post ID
 */
const getPostInteractions = async (postId) => {
  try {
    return await db.interactions.where('postId').equals(postId).toArray();
  } catch (error) {
    console.error('Error getting post interactions:', error);
    return [];
  }
};

/**
 * Store user preferences
 */
const storePreferences = async (preferences) => {
  try {
    const current = await db.preferences.get('singleton') || { id: 'singleton' };
    await db.preferences.put(toPlainObject({ ...current, ...preferences }));
    return true;
  } catch (error) {
    console.error('Error storing preferences:', error);
    return false;
  }
};

/**
 * Get user preferences
 */
const getPreferences = async () => {
  try {
    const prefs = await db.preferences.get('singleton');
    return prefs ? { ...prefs, id: undefined } : {};
  } catch (error) {
    console.error('Error getting preferences:', error);
    return {};
  }
};

/**
 * Track posts that have been viewed
 * @param {string|number} postId - The post ID
 * @param {Object} postData - The full post data object
 * @param {string} source - The source URL (e.g., 'https://danbooru.donmai.us')
 */
const trackPostView = async (postId, postData, source = null) => {
  // Only track view if history is not disabled in settings
  const settings = await loadAppSettings();
  if (settings && settings.settings && settings.settings.disableHistory) {
    return;
  }

  // Create composite key consistent with FeedView.getCompositeKey
  const key = source ? `${source}|${postId}` : String(postId);

  try {
    await db.viewHistory.put(toPlainObject({
      key,
      lastViewed: Date.now(),
      data: postData
    }));
    return true;
  } catch (error) {
    console.error('Error tracking post view:', error);
    return false;
  }
};

/**
 * Check if a post has been viewed before
 * @param {string|number} postId - The post ID
 * @param {string} source - The source URL (optional)
 */
const hasViewedPost = async (postId, source = null) => {
  const key = source ? `${source}|${postId}` : String(postId);
  try {
    const entry = await db.viewHistory.get(key);
    return !!entry;
  } catch (error) {
    console.error('Error checking viewed post:', error);
    return false;
  }
};

/**
 * Get viewed posts history
 * Returns object keyed by composite key for compatibility
 */
const getViewedPosts = async () => {
  try {
    const entries = await db.viewHistory.toArray();
    const result = {};
    for (const entry of entries) {
      result[entry.key] = {
        lastViewed: entry.lastViewed,
        data: entry.data
      };
    }
    return result;
  } catch (error) {
    console.error('Error getting viewed posts:', error);
    return {};
  }
};

/**
 * Get user's most interacted tags
 */
const getMostInteractedTags = async (limit = 10) => {
  try {
    const interactions = await db.interactions.toArray();

    // Initialize tag counters
    const tagCounts = {};

    // Count positive interactions with each tag
    interactions.forEach(interaction => {
      // Only count positive interactions
      const isPositive = (
        (interaction.type === 'like' && interaction.value > 0) ||
        (interaction.type === 'favorite' && interaction.value > 0) ||
        (interaction.type === 'timeSpent' && interaction.value > 5000) // 5 seconds
      );

      if (isPositive && interaction.metadata && interaction.metadata.post) {
        const post = interaction.metadata.post;

        // Process all tags
        if (post.tag_string) {
          post.tag_string.split(' ').forEach(tag => {
            if (!tagCounts[tag]) {
              tagCounts[tag] = 0;
            }
            tagCounts[tag]++;
          });
        }
      }
    });

    // Convert to array, sort by count, and take top 'limit'
    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag]) => tag);
  } catch (error) {
    console.error('Error getting most interacted tags:', error);
    return [];
  }
};

/**
 * Clear all stored data
 */
const clearAllData = async () => {
  try {
    await db.interactions.clear();
    await db.preferences.clear();
    await db.viewHistory.clear();
    await db.appSettings.clear();
    await db.tagCache.clear();
    return true;
  } catch (error) {
    console.error('Error clearing all data:', error);
    return false;
  }
};

/**
 * Clear only the post history
 */
const clearHistory = async () => {
  try {
    await db.viewHistory.clear();
    return true;
  } catch (error) {
    console.error('Error clearing history:', error);
    return false;
  }
};

/**
 * Clear only the 'like' interactions
 */
const clearLikes = async () => {
  try {
    await db.interactions.where('type').equals('like').delete();
    return true;
  } catch (error) {
    console.error('Error clearing likes:', error);
    return false;
  }
};

/**
 * Clear only the 'favorite' interactions
 */
const clearFavorites = async () => {
  try {
    await db.interactions.where('type').equals('favorite').delete();
    return true;
  } catch (error) {
    console.error('Error clearing favorites:', error);
    return false;
  }
};

/**
 * Export analytics data for recommendations
 */
const exportAnalytics = async () => {
  try {
    const interactions = await db.interactions.toArray();
    const preferences = await getPreferences();
    const historyCount = await db.viewHistory.count();

    return {
      interactionCount: interactions.length,
      uniquePostsViewed: historyCount,
      topTags: await getMostInteractedTags(5),
      preferences
    };
  } catch (error) {
    console.error('Error exporting analytics:', error);
    return {
      interactionCount: 0,
      uniquePostsViewed: 0,
      topTags: [],
      preferences: {}
    };
  }
};

const saveAppSettings = async (settings) => {
  try {
    await db.appSettings.put(toPlainObject({ id: 'singleton', ...settings }));
    return true;
  } catch (error) {
    console.error('Failed to save app settings:', error);
    return false;
  }
};

const loadAppSettings = async () => {
  try {
    const settings = await db.appSettings.get('singleton');
    if (settings) {
      const { id, ...rest } = settings;
      return rest;
    }
    return null;
  } catch (error) {
    console.error('Failed to load app settings:', error);
    return null;
  }
};

const storeProfileSnapshot = async (snapshot) => {
  try {
    await db.profileSnapshot.put(toPlainObject({ id: 'singleton', ...snapshot }));
    return true;
  } catch (error) {
    console.error('Failed to store profile snapshot:', error);
    return false;
  }
};

const getProfileSnapshot = async () => {
  try {
    const snapshot = await db.profileSnapshot.get('singleton');
    if (snapshot) {
      const { id, ...rest } = snapshot;
      return rest;
    }
    return null;
  } catch (error) {
    console.error('Failed to get profile snapshot:', error);
    return null;
  }
};

export default {
  storeInteraction,
  getInteractions,
  getRecentInteractions,
  getPostInteractions,
  storePreferences,
  getPreferences,
  trackPostView,
  hasViewedPost,
  getViewedPosts,
  getMostInteractedTags,
  clearAllData,
  clearHistory,
  clearLikes,
  clearFavorites,
  exportAnalytics,
  saveAppSettings,
  loadAppSettings,
  storeProfileSnapshot,
  getProfileSnapshot,
};