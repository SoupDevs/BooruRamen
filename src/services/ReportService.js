/*
 * BooruRamen - A personalized booru browser
 * Copyright (C) 2025 SoupDevs
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
/**
 * ReportService.js
 * Stores and queries reported/blocked posts, artists, and uploaders.
 * Reported content is excluded from the feed.
 */

import { db } from './db.js';

const normalizeName = (name) => String(name || '').trim().toLowerCase();

/**
 * Composite key for a post, consistent with FeedView.getCompositeKey
 */
const getPostKey = (post) => {
  if (!post) return '';
  return post.source ? `${post.source}|${post.id}` : String(post.id);
};

/**
 * Artist tags of a post (Danbooru-style tag_string_artist, space separated)
 */
const getArtistTags = (post) => {
  if (!post || !post.tag_string_artist) return [];
  return post.tag_string_artist.split(' ').map(normalizeName).filter(t => t.length > 0);
};

/**
 * Uploader name of a post. owner (Gelbooru) / author (Moebooru) cover posts
 * stored before those fields were mapped to uploader_name.
 */
const getUploaderName = (post) => {
  if (!post) return '';
  return post.uploader_name || post.owner || post.author || '';
};

const addReport = async (type, value, extra = {}) => {
  if (!value) return false;
  try {
    const existing = await db.reports
      .where('[type+value]')
      .equals([type, value])
      .first();
    if (existing) return true;
    await db.reports.add({ type, value, timestamp: Date.now(), ...extra });
    return true;
  } catch (error) {
    console.error(`[Reports] Error reporting ${type}:`, error);
    return false;
  }
};

/**
 * Report/block a post. Stores the full post data so it can be shown in the
 * Reported Posts view.
 */
const reportPost = async (post) => {
  if (!post || !post.id) return false;
  let postData = post;
  try {
    // Strip Vue reactivity so IndexedDB can clone the object
    postData = JSON.parse(JSON.stringify(post));
  } catch (e) {
    console.warn('[Reports] Failed to serialize post:', e);
  }
  return addReport('post', getPostKey(post), { postData });
};

const reportArtist = async (name) => addReport('artist', normalizeName(name));

const reportUploader = async (name) => addReport('uploader', normalizeName(name));

const removeReport = async (type, value) => {
  try {
    await db.reports.where('[type+value]').equals([type, value]).delete();
    return true;
  } catch (error) {
    console.error(`[Reports] Error removing ${type} report:`, error);
    return false;
  }
};

const getReports = async (type) => {
  try {
    return await db.reports.where('type').equals(type).toArray();
  } catch (error) {
    console.error(`[Reports] Error getting ${type} reports:`, error);
    return [];
  }
};

/**
 * Reported posts, newest first, as full post objects
 */
const getReportedPosts = async () => {
  const reports = await getReports('post');
  return reports
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(r => r.postData)
    .filter(p => p && p.id);
};

const getReportedArtists = async () => {
  const reports = await getReports('artist');
  return reports.sort((a, b) => b.timestamp - a.timestamp).map(r => r.value);
};

const getReportedUploaders = async () => {
  const reports = await getReports('uploader');
  return reports.sort((a, b) => b.timestamp - a.timestamp).map(r => r.value);
};

/**
 * Load everything the feed needs to exclude blocked content, as Sets for
 * synchronous per-post checks.
 */
const getBlockSets = async () => {
  try {
    const reports = await db.reports.toArray();
    const postKeys = new Set();
    const artists = new Set();
    const uploaders = new Set();
    for (const report of reports) {
      if (report.type === 'post') postKeys.add(report.value);
      else if (report.type === 'artist') artists.add(report.value);
      else if (report.type === 'uploader') uploaders.add(report.value);
    }
    return { postKeys, artists, uploaders };
  } catch (error) {
    console.error('[Reports] Error loading block sets:', error);
    return { postKeys: new Set(), artists: new Set(), uploaders: new Set() };
  }
};

/**
 * True if the post itself, one of its artists, or its uploader is blocked
 */
const isBlocked = (post, { postKeys, artists, uploaders }) => {
  if (!post) return false;
  if (postKeys.has(getPostKey(post))) return true;
  if (artists.size > 0) {
    // Artists are regular tags, so check the full tag string: this also covers
    // sources that don't split out tag_string_artist
    const tags = (post.tag_string || '').toLowerCase().split(' ');
    if (tags.some(tag => artists.has(tag))) return true;
    if (getArtistTags(post).some(tag => artists.has(tag))) return true;
  }
  if (uploaders.size > 0) {
    const uploader = normalizeName(getUploaderName(post));
    if (uploader && uploaders.has(uploader)) return true;
  }
  return false;
};

const filterPosts = (posts, blockSets) => {
  if (!posts || posts.length === 0) return [];
  return posts.filter(post => !isBlocked(post, blockSets));
};

const clearAllReports = async () => {
  try {
    await db.reports.clear();
    return true;
  } catch (error) {
    console.error('[Reports] Error clearing reports:', error);
    return false;
  }
};

export default {
  getPostKey,
  getArtistTags,
  getUploaderName,
  reportPost,
  reportArtist,
  reportUploader,
  removeReport,
  getReports,
  getReportedPosts,
  getReportedArtists,
  getReportedUploaders,
  getBlockSets,
  isBlocked,
  filterPosts,
  clearAllReports,
};
