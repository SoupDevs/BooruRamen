import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { APP_USER_AGENT, withAppUserAgent, httpError } from '../src/services/httpClient.js';

describe('httpClient', () => {
    it('adds an identifying User-Agent unless one is set', () => {
        expect(APP_USER_AGENT).toMatch(/^BooruRamen\//);
        expect(withAppUserAgent().get('User-Agent')).toBe(APP_USER_AGENT);
        expect(withAppUserAgent({ Accept: 'application/json' }).get('Accept')).toBe('application/json');
        expect(withAppUserAgent({ 'User-Agent': 'custom' }).get('User-Agent')).toBe('custom');
    });

    it('names Danbooru\'s reason for a failed request', async () => {
        const res = new Response(JSON.stringify({ success: false, message: 'Access denied' }), { status: 403 });
        const error = await httpError(res);
        expect(error.message).toBe('HTTP error! status: 403 (Access denied)');
        expect(error.status).toBe(403);
    });

    it('recognises a Cloudflare block page', async () => {
        const res = new Response('<html><title>Just a moment...</title></html>', { status: 403 });
        expect((await httpError(res)).message).toBe("HTTP error! status: 403 (blocked by Cloudflare. If you're on a VPN, try another server or turn it off)");
    });

    it('falls back to the bare status', async () => {
        expect((await httpError(new Response('', { status: 500 }))).message).toBe('HTTP error! status: 500');
    });
});

describe('httpFetch in Tauri', () => {
    const tauriFetch = vi.fn();
    const browserFetch = vi.fn();
    const blocked = () => new Response('<title>Just a moment...</title>', { status: 403, headers: { server: 'cloudflare', 'content-type': 'text/html; charset=UTF-8' } });
    const ok = () => new Response('[]', { status: 200 });

    beforeEach(async () => {
        vi.resetModules();
        vi.doMock('@tauri-apps/plugin-http', () => ({ fetch: tauriFetch }));
        globalThis.window = { __TAURI_INTERNALS__: {} };
        vi.stubGlobal('fetch', browserFetch);
        tauriFetch.mockReset();
        browserFetch.mockReset();
    });

    afterEach(() => {
        delete globalThis.window;
        vi.unstubAllGlobals();
        vi.doUnmock('@tauri-apps/plugin-http');
    });

    it('falls back to the WebView fetch when Cloudflare blocks, and remembers the origin', async () => {
        const { httpFetch } = await import('../src/services/httpClient.js');
        tauriFetch.mockResolvedValue(blocked());
        browserFetch.mockResolvedValue(ok());

        expect((await httpFetch('https://danbooru.donmai.us/posts.json')).status).toBe(200);
        expect(tauriFetch).toHaveBeenCalledTimes(1);

        await httpFetch('https://danbooru.donmai.us/tags.json');
        expect(tauriFetch).toHaveBeenCalledTimes(1);
        expect(browserFetch).toHaveBeenCalledTimes(2);

        tauriFetch.mockResolvedValue(ok());
        await httpFetch('https://yande.re/post.json');
        expect(tauriFetch).toHaveBeenCalledTimes(2);
    });

    it('keeps the native 403 when the WebView fetch fails on CORS', async () => {
        const { httpFetch } = await import('../src/services/httpClient.js');
        tauriFetch.mockResolvedValue(blocked());
        browserFetch.mockRejectedValue(new TypeError('Failed to fetch'));

        expect((await httpFetch('https://example.com/api')).status).toBe(403);
        await httpFetch('https://example.com/api');
        expect(tauriFetch).toHaveBeenCalledTimes(2);
    });

    it('leaves other failures alone', async () => {
        const { httpFetch } = await import('../src/services/httpClient.js');
        tauriFetch.mockResolvedValue(new Response('{}', { status: 403, headers: { server: 'cloudflare', 'content-type': 'application/json' } }));

        expect((await httpFetch('https://danbooru.donmai.us/posts.json')).status).toBe(403);
        expect(browserFetch).not.toHaveBeenCalled();
    });

    it('offers the check when Cloudflare refuses the WebView too', async () => {
        const { httpFetch } = await import('../src/services/httpClient.js');
        const { cloudflareState } = await import('../src/services/cloudflareVerify.js');
        tauriFetch.mockResolvedValue(blocked());
        browserFetch.mockResolvedValue(new Response('<html></html>', { status: 403 }));

        const res = await httpFetch('https://danbooru.donmai.us/posts.json');
        expect(res.headers.get('server')).toBe('cloudflare');
        expect(cloudflareState.blocked).toEqual(['https://danbooru.donmai.us']);

        // Not remembered as a WebView origin: the next request tries natively again.
        await httpFetch('https://danbooru.donmai.us/posts.json');
        expect(tauriFetch).toHaveBeenCalledTimes(2);
    });

    it('sends the WebView clearance cookie and User-Agent once the site is verified', async () => {
        const store = new Map([['cloudflarePendingOrigin', JSON.stringify('https://danbooru.donmai.us')]]);
        vi.stubGlobal('localStorage', {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k),
        });
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/130' });
        const invoke = vi.fn().mockResolvedValue('cf_clearance=abc; other=1');
        vi.doMock('@tauri-apps/api/core', () => ({ invoke }));

        const { finishPendingVerification } = await import('../src/services/cloudflareVerify.js');
        const { httpFetch } = await import('../src/services/httpClient.js');
        expect(await finishPendingVerification()).toBe('https://danbooru.donmai.us');
        expect(store.has('cloudflarePendingOrigin')).toBe(false);

        tauriFetch.mockResolvedValue(ok());
        await httpFetch('https://danbooru.donmai.us/posts.json');
        const headers = tauriFetch.mock.calls[0][1].headers;
        expect(headers.get('Cookie')).toBe('cf_clearance=abc; other=1');
        expect(headers.get('User-Agent')).toMatch(/Android/);

        // Other sites are untouched.
        await httpFetch('https://yande.re/post.json');
        expect(tauriFetch.mock.calls[1][1].headers.get('Cookie')).toBeNull();
        vi.doUnmock('@tauri-apps/api/core');
    });
});
