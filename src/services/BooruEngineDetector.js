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
 * BooruEngineDetector.js
 *
 * Works out which booru engine a user-supplied URL is running.
 *
 * A "custom booru" setting was previously resolved by matching the URL against
 * a hardcoded host list, so anything else silently fell through to whatever the
 * dropdown said and then failed at request time. Detection instead probes the
 * candidate APIs in order of how common they are, and accepts the first one
 * that answers with a recognizable post payload.
 *
 * Probes are cheap: a single limit=1 request per candidate, stopped as soon as
 * one succeeds or identifies itself with an auth challenge. The user can always
 * override the result with the manual dropdown, so a false negative costs
 * nothing but a retry.
 */

import { httpFetch } from './httpClient.js';
import { toDevProxiedUrl } from './BooruAdapters.js';

/**
 * Engines, in probe order. `danbooru` and `moebooru` have distinctive JSON
 * shapes; `gelbooru` covers the large family of Gelbooru 0.2 / Shimmie
 * derivatives whose API surface is the same even when the site differs.
 */
export const ENGINES = [
    {
        type: 'danbooru',
        label: 'Danbooru Type',
        buildUrl: (base) => `${base}/posts.json?limit=1`,
    },
    {
        type: 'gelbooru',
        label: 'Gelbooru Type',
        buildUrl: (base) =>
            `${base}/index.php?page=dapi&s=post&q=index&json=1&limit=1`,
    },
    {
        type: 'moebooru',
        label: 'Moebooru Type',
        buildUrl: (base) => `${base}/post.json?limit=1`,
    },
];

/** Normalize a user-typed booru URL into an origin the probes can use. */
export function normalizeBooruUrl(rawUrl) {
    if (!rawUrl) return '';
    let value = rawUrl.trim();
    if (!/^https?:\/\//i.test(value)) {
        value = `https://${value}`;
    }
    try {
        const parsed = new URL(value);
        // Drop any path/query the user pasted: every supported API lives at the
        // site root, and a stray "/index.php" would double up with the probe URL.
        return `${parsed.protocol}//${parsed.host}`;
    } catch {
        return '';
    }
}

/** Credentials appended to a probe when the engine reads them from the query. */
function withCredentials(engineType, url, opts) {
    if (!opts || !opts.userId || !opts.apiKey) return url;
    const separator = url.includes('?') ? '&' : '?';
    if (engineType === 'gelbooru') {
        return `${url}${separator}user_id=${encodeURIComponent(opts.userId)}&api_key=${encodeURIComponent(opts.apiKey)}`;
    }
    if (engineType === 'moebooru') {
        return `${url}${separator}login=${encodeURIComponent(opts.userId)}&password_hash=${encodeURIComponent(opts.apiKey)}`;
    }
    if (engineType === 'danbooru') {
        return `${url}${separator}login=${encodeURIComponent(opts.userId)}&api_key=${encodeURIComponent(opts.apiKey)}`;
    }
    return url;
}

function parseJson(body) {
    try {
        return JSON.parse(body);
    } catch {
        return undefined;
    }
}

/** Does this payload look like a post listing from the given engine? */
function payloadMatchesEngine(type, data) {
    if (!data) return false;

    // Gelbooru dapi wraps results: {"@attributes": {...}, "post": [...]}.
    // Some forks return a bare array with the same post fields.
    const gelbooruList =
        Array.isArray(data) ? data : data.post ? [].concat(data.post) : null;

    switch (type) {
        case 'gelbooru': {
            // An empty-but-well-formed dapi envelope still identifies the engine:
            // only this family serves this endpoint with these keys.
            const isEnvelope =
                data !== null && typeof data === 'object' && !Array.isArray(data);
            if (isEnvelope && ('@attributes' in data || 'post' in data)) {
                return true;
            }
            if (!gelbooruList || gelbooruList.length === 0) return false;
            const post = gelbooruList[0];
            // Filename fields (directory/image) are what separate this family
            // from the others; the URL fields confirm it is a post listing.
            const hasFilenameFields =
                post.directory !== undefined || post.image !== undefined;
            const hasMediaFields =
                post.preview_url !== undefined ||
                post.sample_url !== undefined ||
                post.file_url !== undefined;
            return Boolean(hasFilenameFields && hasMediaFields);
        }
        case 'danbooru': {
            if (!Array.isArray(data) || data.length === 0) return false;
            const post = data[0];
            // Danbooru-only keys; every other engine lacks all three.
            return Boolean(
                post.file_url !== undefined &&
                (post.tag_string !== undefined ||
                    post.preview_file_url !== undefined ||
                    post.image_width !== undefined)
            );
        }
        case 'moebooru': {
            if (!Array.isArray(data) || data.length === 0) return false;
            const post = data[0];
            // Moebooru reports dimensions as width/height and the uploader as
            // 'author' rather than 'uploader_name'. It shares file_url and md5
            // with Danbooru, so the probe URL (not the payload) is the primary
            // signal there; these fields settle it either way.
            return Boolean(
                post.file_url !== undefined &&
                post.width !== undefined &&
                (post.author !== undefined || post.preview_url !== undefined)
            );
        }
        default:
            return false;
    }
}

/**
 * A 200 response whose body is a message (not a post payload) asking for
 * authentication still identifies a Gelbooru-family endpoint: its dapi answers
 * exactly this way when the key is missing.
 */
function payloadDemandsAuth(data) {
    return typeof data === 'string' && /auth|api.?key|user.?id/i.test(data);
}

/**
 * Probe a booru URL and report the engine it appears to run.
 *
 * @param {string} rawUrl - URL as typed by the user.
 * @param {Object} [opts]
 * @param {string} [opts.userId] - Optional credentials for engines that only
 *   answer authenticated queries; without them the probe looks like a failure.
 * @param {string} [opts.apiKey]
 * @returns {Promise<{type: string|null, url: string, requiresAuth?: boolean, error?: string}>}
 */
export async function detectBooruEngine(rawUrl, opts = {}) {
    const normalized = normalizeBooruUrl(rawUrl);
    if (!normalized) {
        return { type: null, url: '', error: 'Enter a valid URL first.' };
    }

    for (const engine of ENGINES) {
        const probeUrl = withCredentials(engine.type, engine.buildUrl(normalized), opts);

        try {
            const response = await httpFetch(toDevProxiedUrl(probeUrl), { method: 'GET' });

            // An auth challenge on the dapi endpoint is itself a signature: the
            // endpoint exists and belongs to a family that gates its API.
            if (engine.type === 'gelbooru' && response.status === 401) {
                return {
                    type: 'gelbooru',
                    url: resolvedOrigin(response, normalized),
                    requiresAuth: true,
                };
            }
            if (!response.ok) continue;

            const data = parseJson(await response.text());

            if (payloadMatchesEngine(engine.type, data)) {
                return {
                    type: engine.type,
                    url: resolvedOrigin(response, normalized),
                    requiresAuth: payloadDemandsAuth(data) || undefined,
                };
            }
            if (engine.type === 'gelbooru' && payloadDemandsAuth(data)) {
                return {
                    type: 'gelbooru',
                    url: resolvedOrigin(response, normalized),
                    requiresAuth: true,
                };
            }
        } catch {
            // A probe failure just means "not this engine"; try the next one.
            continue;
        }
    }

    return {
        type: null,
        url: normalized,
        error: `Could not identify the engine at ${normalized}. It may need an API key, or pick the type manually.`,
    };
}

/**
 * The address the probe actually ended on. A booru that redirects its API to a
 * dedicated host (a common setup) should be saved as that host so later
 * requests skip the redirect hop entirely.
 *
 * In development the request goes through the app's own proxy, so its header
 * reports the final target; in the packaged app the response URL is the real one.
 */
function resolvedOrigin(response, fallback) {
    const reported = readFinalOrigin(response);
    if (reported) return reported;
    try {
        const finalUrl = response.url ? new URL(response.url) : null;
        if (finalUrl && finalUrl.host) {
            return `${finalUrl.protocol}//${finalUrl.host}`;
        }
    } catch {
        // Fall through to the normalized input.
    }
    return fallback;
}

function readFinalOrigin(response) {
    try {
        const value = response.headers && response.headers.get
            ? response.headers.get('x-booru-final-origin')
            : null;
        if (!value) return '';
        const parsed = new URL(value);
        return `${parsed.protocol}//${parsed.host}`;
    } catch {
        return '';
    }
}

export default { detectBooruEngine, normalizeBooruUrl, ENGINES };