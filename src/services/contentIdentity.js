import { postKey } from './postKey.js';

// Only original-file hashes count as exact duplicates. A perceptual hash is
// useful for learning composition, but can collide on unrelated images.
export function contentKeys(post) {
  if (!post) return [];
  const keys = [];
  const md5 = [post.md5, post.hash, post.imageAnalysis?.md5].map(value => String(value || '').toLowerCase()).find(value => /^[a-f0-9]{32}$/.test(value));
  if (md5) keys.push(`md5:${md5}`);
  const sha = post.imageAnalysis?.sha256;
  if (/^[a-f0-9]{64}$/.test(sha || '')) keys.push(`sha256:${sha}`);
  if (post.file_url) keys.push(`file:${post.file_url}`);
  return keys;
}

export function analysisKey(post) {
  return contentKeys(post).find(key => key.startsWith('md5:')) || `post:${postKey(post)}`;
}

export function excludeDuplicateContent(posts, excluded = new Set()) {
  const seen = new Set(excluded);
  return posts.filter(post => {
    const keys = [postKey(post), ...contentKeys(post)];
    const duplicate = keys.some(key => seen.has(key));
    keys.forEach(key => seen.add(key));
    return !duplicate;
  });
}
