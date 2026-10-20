import { afterEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('../src/stores/settings', () => ({ useSettingsStore: () => ({ downloadDirectory: '/downloads' }) }));

import { refererForMediaUrl } from '../src/services/mediaUrl.js';
import * as DownloadService from '../src/services/DownloadService.js';

afterEach(() => { delete globalThis.window; vi.restoreAllMocks(); invoke.mockClear(); });

describe('download referer', () => {
  it('names the referer only for hotlink-protected media', () => {
    expect(refererForMediaUrl('https://img3.gelbooru.com/images/aa/bb/x.jpg')).toBe('https://gelbooru.com/');
    expect(refererForMediaUrl('https://cdn.donmai.us/original/aa/bb/x.jpg')).toBeNull();
    expect(refererForMediaUrl('http://img3.gelbooru.com/images/x.jpg')).toBeNull();
  });

  it('passes the referer to the native download', async () => {
    globalThis.window = { __TAURI_INTERNALS__: {} };
    await DownloadService.downloadPost({ id: 1, file_url: 'https://img3.gelbooru.com/images/aa/bb/x.jpg', file_ext: 'jpg' });
    const call = invoke.mock.calls.find(([command]) => command === 'download_file');
    expect(call[1].referer).toBe('https://gelbooru.com/');
  });
});
