/*
 * BooruRamen - A personalized booru browser
 * Copyright (C) 2025 SoupDevs
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { httpFetch } from './httpClient.js';

const BASE_URL = 'https://danbooru.donmai.us';

const getPosts = async ({ tags, page, limit, sort, sortOrder, skipSort }) => {
  const hasOrder = tags.includes('order:');
  let queryTags = tags;

  if (!hasOrder && !skipSort) {
    // SMART SORT: Only add order tag if we have room (limit is 2 expensive tags)
    // "Free" tags: rating, filetype, status
    const tagList = tags.split(' ');
    const expensiveTags = tagList.filter(t =>
      !t.startsWith('rating:') &&
      !t.startsWith('filetype:') &&
      !t.startsWith('-filetype:') &&
      !t.startsWith('status:') &&
      t.trim() !== ''
    );

    const expensiveCount = expensiveTags.length;

    if (expensiveCount < 2) {
      // We have room for an order tag
      if (sort === 'score') {
        queryTags = `${tags} order:score`; // Implies desc
      } else if (sort === 'popular') {
        queryTags = `${tags} order:popular`;
      } else {
        queryTags = `${tags}`; // Default ID
      }
    } else {
      // No room for specific order, rely on default (ID/Date)
      // This ensures "tag1 tag2" (2 expensive) doesn't become "tag1 tag2 order:score" (3 expensive -> Blocked)
    }
  }

  const params = new URLSearchParams({
    tags: queryTags,
    page,
    limit,
  });

  const url = `${BASE_URL}/posts.json?${params.toString()}`;
  console.log('Danbooru Fetch:', url);

  try {
    const response = await httpFetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.filter(post => post.id && post.file_url);
  } catch (error) {
    console.error('Error fetching posts from Danbooru:', error);
    return [];
  }
};

export default {
  getPosts,
};