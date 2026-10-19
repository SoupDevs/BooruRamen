import { describe, expect, it } from 'vitest';
import { isTypingTarget, shortcutFor } from '../src/services/keyboardShortcuts.js';

const key = (code, extra = {}) => ({ code, target: { tagName: 'DIV' }, ...extra });

describe('keyboard shortcuts', () => {
  it('maps the post and navigation keys', () => {
    expect(shortcutFor(key('KeyL'))).toBe('like');
    expect(shortcutFor(key('KeyF'))).toBe('favorite');
    expect(shortcutFor(key('KeyD'))).toBe('dislike');
    expect(shortcutFor(key('ArrowDown'))).toBe('next');
    expect(shortcutFor(key('KeyK'))).toBe('previous');
    expect(shortcutFor(key('KeyQ'))).toBeNull();
  });

  it('leaves typing and browser shortcuts alone', () => {
    expect(shortcutFor(key('KeyL', { target: { tagName: 'INPUT' } }))).toBeNull();
    expect(shortcutFor(key('KeyL', { target: { tagName: 'TEXTAREA' } }))).toBeNull();
    expect(shortcutFor(key('KeyL', { target: { tagName: 'DIV', isContentEditable: true } }))).toBeNull();
    expect(shortcutFor(key('KeyF', { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key('KeyL', { metaKey: true }))).toBeNull();
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
  });
});
