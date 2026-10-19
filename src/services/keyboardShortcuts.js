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
 * Desktop keyboard shortcuts. One table so the feed (navigation) and the app
 * shell (post actions) agree on which keys are taken.
 */
const SHORTCUTS = {
  ArrowDown: 'next',
  KeyJ: 'next',
  ArrowUp: 'previous',
  KeyK: 'previous',
  KeyL: 'like',
  KeyF: 'favorite',
  KeyD: 'dislike',
  KeyI: 'details',
  KeyM: 'mute',
  Escape: 'close',
};

/** Is the user typing into a field? Shortcuts must leave those keys alone. */
export function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(target.isContentEditable);
}

/**
 * The shortcut action for a keydown event, or null. Modified keys (Ctrl+F,
 * Cmd+L, ...) stay with the browser.
 */
export function shortcutFor(event) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  return SHORTCUTS[event.code] || null;
}
