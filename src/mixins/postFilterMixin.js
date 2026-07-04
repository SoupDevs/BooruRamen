/*
 * BooruRamen - A personalized booru browser
 * Copyright (C) 2025 DottsGit
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import StorageService from '../services/StorageService';
export const postFilterMixin = {
  methods: {
    async filterPostsBySettings(posts) {
      const appSettings = await StorageService.loadAppSettings();
      if (!appSettings || !appSettings.settings) {
        return posts;
      }

      const { settings } = appSettings;

      const ratingCodeMap = {
        'general': 'g',
        'sensitive': 's',
        'questionable': 'q',
        'explicit': 'e'
      };
      const allowedRatingCodes = (settings.ratings || ['general']).map(r => ratingCodeMap[r]);

      return posts.filter(post => {
        if (!post) return false;

        // Filter by Media Type
        const isVideo = ['mp4', 'webm'].includes(post.file_ext);
        const isImage = !isVideo;
        if ((isImage && !settings.mediaType.images) || (isVideo && !settings.mediaType.videos)) {
          return false;
        }

        // Filter by Rating
        if (!allowedRatingCodes.includes(post.rating)) {
          return false;
        }

        const postTags = new Set(post.tag_string.split(' '));

        // Filter by Whitelist Tags
        if (settings.whitelistTags && settings.whitelistTags.length > 0) {
          if (!settings.whitelistTags.every(tag => postTags.has(tag))) {
            return false;
          }
        }

        // Filter by Blacklist Tags
        if (settings.blacklistTags && settings.blacklistTags.length > 0) {
          if (settings.blacklistTags.some(tag => postTags.has(tag))) {
            return false;
          }
        }

        return true;
      });
    }
  }
};