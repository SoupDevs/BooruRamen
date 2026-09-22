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
 * ShareService.js
 * Post sharing helpers: the canonical link for a post, the caption that goes
 * with it, and the web share-intent URLs for the platforms offered in the
 * share sheet. Web intents need no API keys and behave the same in the
 * Android webview as they do in a desktop browser.
 */

import { isTauri } from './DownloadService';

/**
 * The link to a post. Posts that came from a source that reports its own
 * post page carry it in post_url; older stored posts fall back to the
 * numeric URL on the default source.
 */
export function getPostShareUrl(post) {
  if (!post) return '';
  if (post.post_url) return post.post_url;
  if (!post.id) return '';
  return `https://danbooru.donmai.us/posts/${post.id}`;
}

/** Short label for where a post came from, e.g. "danbooru.donmai.us". */
export function getShareSourceLabel(post) {
  if (!post) return 'BooruRamen';
  const source = post.source;
  if (!source) return 'BooruRamen';
  try {
    return new URL(source).hostname.replace(/^www\./, '');
  } catch {
    return String(source);
  }
}

/**
 * Whether this platform expects a share sheet rather than a silently
 * copied link. Phones do; the desktop app keeps one-tap copy.
 */
export function isMobilePlatform() {
  if (typeof navigator === 'undefined') return false;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || '');
}

/** Caption used by the networks that accept share text. */
export function getShareText(post) {
  return `Check out this post on ${getShareSourceLabel(post)}`;
}

/**
 * Image to pin for Pinterest: the largest URL the post carries.
 */
function getShareImageUrl(post) {
  if (!post) return '';
  return post.large_file_url || post.sample_file_url || post.file_url || '';
}

/**
 * Share targets for a post, in display order. Each target is a plain web
 * intent URL: opening it hands the post to the platform's composer (or its
 * native app) without the user leaving BooruRamen's own session.
 */
export function buildShareTargets(post) {
  const url = getPostShareUrl(post);
  if (!url) return [];

  const text = getShareText(post);
  const media = getShareImageUrl(post);
  const enc = encodeURIComponent;

  return [
    {
      id: 'x',
      label: 'X',
      badge: 'X',
      color: '#FFFFFF',
      textColor: '#0F1419',
      url: `https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(text)}`,
    },
    {
      id: 'reddit',
      label: 'Reddit',
      badge: 'R',
      color: '#FF4500',
      url: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(text)}`,
    },
    {
      id: 'bluesky',
      label: 'Bluesky',
      badge: 'B',
      color: '#0285FF',
      url: `https://bsky.app/intent/compose?text=${enc(`${text}\n${url}`)}`,
    },
    {
      id: 'telegram',
      label: 'Telegram',
      badge: 'T',
      color: '#229ED9',
      url: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`,
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      badge: 'W',
      color: '#25D366',
      url: `https://api.whatsapp.com/send?text=${enc(`${text} ${url}`)}`,
    },
    {
      id: 'facebook',
      label: 'Facebook',
      badge: 'f',
      color: '#1877F2',
      url: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
    },
    {
      id: 'pinterest',
      label: 'Pinterest',
      badge: 'P',
      color: '#E60023',
      url: `https://www.pinterest.com/pin/create/button/?url=${enc(url)}&media=${enc(media)}&description=${enc(text)}`,
    },
    {
      id: 'tumblr',
      label: 'Tumblr',
      badge: 't',
      color: '#36465D',
      url: `https://www.tumblr.com/widgets/share/tool?canonicalUrl=${enc(url)}`,
    },
  ];
}

/**
 * Open a URL in the system browser (Tauri opener on desktop/Android, a new
 * tab in a plain browser). Webviews ignore target=_blank, which is why this
 * never goes through window.open first.
 */
export async function openExternalUrl(url) {
  if (!url) return;
  if (isTauri()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch (e) {
      console.error('[Share] Failed to open via Tauri opener:', e);
    }
  }
  window.open(url, '_blank', 'noopener');
}

/**
 * Copy text to the clipboard. The async clipboard API is the primary path;
 * the hidden-textarea fallback covers webviews where it is unavailable or
 * rejects without a permission prompt.
 */
export async function copyToClipboard(text) {
  if (!text) return false;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path
    }
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}