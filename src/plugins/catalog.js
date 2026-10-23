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
 * catalog.js
 * Finds plugins published on GitHub: repositories with the
 * "booruramen-plugins" topic, and the .js files in their plugins/ folder.
 *
 * Nothing found here is run. The plugin's name and description are read
 * from the file's text; its code runs only once the user installs it.
 */
import { httpFetch } from '../services/httpClient.js';
import { MAX_PLUGIN_SOURCE } from './installer.js';

export const CATALOG_TOPIC = 'booruramen-plugins';
export const CATALOG_FOLDER = 'plugins';

const API = 'https://api.github.com';
const TIMEOUT_MS = 15000;

async function getJson(url) {
  const response = await httpFetch(url, { timeoutMs: TIMEOUT_MS, headers: { Accept: 'application/vnd.github+json' } });
  if (response.ok) return response.json();
  // Without a token GitHub allows 10 searches a minute and 60 other calls
  // an hour per IP address.
  if ((response.status === 403 || response.status === 429) && response.headers?.get?.('x-ratelimit-remaining') === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const wait = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : null;
    throw new Error(`GitHub's rate limit was reached${wait ? `; try again in about ${wait} minute${wait === 1 ? '' : 's'}` : '; try again later'}`);
  }
  if (response.status === 404) return null;
  throw new Error(`GitHub answered ${response.status}`);
}

/**
 * Repositories with the catalog topic, most starred first.
 * @returns {Promise<Array<{ fullName, name, owner, description, url, stars, branch, updatedAt }>>}
 */
export async function searchPluginRepos() {
  const data = await getJson(`${API}/search/repositories?q=${encodeURIComponent(`topic:${CATALOG_TOPIC}`)}&sort=stars&order=desc&per_page=50`);
  return (data?.items || []).filter(repo => !repo.archived && !repo.disabled).map(repo => ({
    fullName: repo.full_name,
    name: repo.name,
    owner: repo.owner?.login || '',
    description: repo.description || '',
    url: repo.html_url,
    stars: repo.stargazers_count || 0,
    branch: repo.default_branch,
    updatedAt: repo.pushed_at || repo.updated_at || '',
  }));
}

/**
 * The .js files directly inside a repository's plugins/ folder.
 * @param {{ fullName: string, branch?: string }} repo
 * @returns {Promise<Array<{ file, path, url, downloadUrl, size }>>}
 */
export async function listRepoPlugins(repo) {
  const ref = repo.branch ? `?ref=${encodeURIComponent(repo.branch)}` : '';
  const entries = await getJson(`${API}/repos/${repo.fullName}/contents/${CATALOG_FOLDER}${ref}`);
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(entry => entry.type === 'file' && /\.m?js$/i.test(entry.name) && entry.download_url)
    .map(entry => ({ file: entry.name, path: entry.path, url: entry.html_url, downloadUrl: entry.download_url, size: entry.size || 0 }));
}

/** A plugin file's text. */
export async function fetchPluginSource(plugin) {
  if (plugin.size > MAX_PLUGIN_SOURCE) throw new Error('The file is too large to be a plugin');
  const response = await httpFetch(plugin.downloadUrl, { timeoutMs: TIMEOUT_MS });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_PLUGIN_SOURCE) throw new Error('The file is too large to be a plugin');
  return text;
}

// The first `key: 'literal'` in the file. Plugin definitions put id, name,
// version, description and author before setup(), so the first match is
// the definition's own.
function readString(source, key) {
  const match = source.match(new RegExp(`(?:^|[\\s{,])${key}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1)[^\\\\\\n])*)\\1`));
  if (!match) return '';
  return match[2].replace(/\\(.)/g, '$1').trim();
}

/**
 * What the Plugins browser shows about a file, read without running it.
 * @param {string} source
 * @returns {{ id: string, name: string, version: string, description: string, author: string }}
 */
export function readPluginInfo(source) {
  const text = String(source || '');
  return {
    id: readString(text, 'id'),
    name: readString(text, 'name'),
    version: readString(text, 'version'),
    description: readString(text, 'description'),
    author: readString(text, 'author'),
  };
}
