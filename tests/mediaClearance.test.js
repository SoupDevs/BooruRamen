import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('media on a site the user passed the Cloudflare check for', () => {
    const invoke = vi.fn();

    beforeEach(() => {
        vi.resetModules();
        invoke.mockReset();
        vi.doMock('@tauri-apps/api/core', () => ({
            invoke,
            convertFileSrc: path => `http://asset.localhost/${path}`,
        }));
        const store = new Map([['cloudflareVerifiedOrigins', JSON.stringify(['https://danbooru.donmai.us'])]]);
        vi.stubGlobal('localStorage', {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k),
        });
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/130' });
        globalThis.window = { __TAURI_INTERNALS__: {} };
    });

    afterEach(() => {
        delete globalThis.window;
        vi.unstubAllGlobals();
        vi.doUnmock('@tauri-apps/api/core');
    });

    async function clearanceNeeded() {
        const { clearanceOrigins } = await import('../src/services/cloudflareVerify.js');
        clearanceOrigins.add('https://danbooru.donmai.us');
    }

    it('fetches CDN files natively with the clearance when the site needed it', async () => {
        invoke.mockImplementation(async command => (command === 'cloudflare_cookies' ? 'cf_clearance=abc' : 'cache/1.jpg'));
        await clearanceNeeded();
        const { getDisplayableMediaUrl } = await import('../src/services/mediaUrl.js');

        const url = 'https://cdn.donmai.us/original/aa/bb/aabb.jpg';
        expect(await getDisplayableMediaUrl(url)).toBe('http://asset.localhost/cache/1.jpg');
        expect(invoke).toHaveBeenCalledWith('cache_booru_media', {
            url,
            referer: 'https://danbooru.donmai.us/',
            cookie: 'cf_clearance=abc',
            userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/130',
        });
    });

    it('leaves a verified site to the WebView when its requests get through without the clearance', async () => {
        invoke.mockImplementation(async command => (command === 'cloudflare_cookies' ? 'cf_clearance=abc' : 'cache/1.jpg'));
        const { getDisplayableMediaUrl } = await import('../src/services/mediaUrl.js');

        const url = 'https://cdn.donmai.us/original/aa/bb/aabb.jpg';
        expect(await getDisplayableMediaUrl(url)).toBe(url);
        expect(invoke).not.toHaveBeenCalled();
    });

    it('falls back to the WebView when the native fetch fails', async () => {
        invoke.mockImplementation(async command => {
            if (command === 'cloudflare_cookies') return 'cf_clearance=abc';
            throw new Error('Media request returned HTTP 403 Forbidden');
        });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await clearanceNeeded();
        const { getDisplayableMediaUrl } = await import('../src/services/mediaUrl.js');

        const url = 'https://cdn.donmai.us/original/aa/bb/aabb.jpg';
        expect(await getDisplayableMediaUrl(url)).toBe(url);
    });

    it('leaves other sites, and a site whose clearance is gone, to the WebView', async () => {
        invoke.mockResolvedValue('');
        await clearanceNeeded();
        const { getDisplayableMediaUrl } = await import('../src/services/mediaUrl.js');

        expect(await getDisplayableMediaUrl('https://files.yande.re/image/a.jpg')).toBe('https://files.yande.re/image/a.jpg');
        expect(await getDisplayableMediaUrl('https://cdn.donmai.us/original/a.jpg')).toBe('https://cdn.donmai.us/original/a.jpg');
        expect(invoke).not.toHaveBeenCalledWith('cache_booru_media', expect.anything());
    });
});
