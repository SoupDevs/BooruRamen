import { describe, it, expect } from 'vitest';
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
        expect((await httpError(res)).message).toBe('HTTP error! status: 403 (blocked by Cloudflare)');
    });

    it('falls back to the bare status', async () => {
        expect((await httpError(new Response('', { status: 500 }))).message).toBe('HTTP error! status: 500');
    });
});
