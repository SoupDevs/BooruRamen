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
 * postKey.js
 * One definition of a post's identity across the app.
 *
 * The same post can come back from several sources (and the same numeric id
 * exists on unrelated boorus), so the key includes the source whenever the
 * post carries one. Feed state, video element lookups and the media burst
 * overlay all key off this, which is why it lives on its own instead of in a
 * single view.
 */

export function postKey(post) {
  if (!post) return '';
  return post.source ? `${post.source}|${post.id}` : String(post.id);
}
