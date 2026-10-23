import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// Answers keyed by URL prefix; anything else is a 404.
const answers = vi.hoisted(() => new Map());
const requested = vi.hoisted(() => []);
vi.mock('../src/services/httpClient.js', () => ({
  httpFetch: async url => {
    requested.push(url);
    const match = [...answers.keys()].find(prefix => url.startsWith(prefix));
    const answer = match ? answers.get(match) : { status: 404, body: '' };
    const { status = 200, body, headers = {} } = answer;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: name => headers[name.toLowerCase()] ?? null },
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  },
}));

const {
  searchPluginRepos, listRepoPlugins, fetchPluginSource, readPluginInfo, CATALOG_TOPIC,
} = await import('../src/plugins/catalog.js');

beforeEach(() => {
  answers.clear();
  requested.length = 0;
});

describe('searchPluginRepos', () => {
  it('searches the topic and skips archived repositories', async () => {
    answers.set('https://api.github.com/search/repositories', { body: { items: [
      { full_name: 'a/plugins', name: 'plugins', owner: { login: 'a' }, description: 'Some', html_url: 'https://github.com/a/plugins', stargazers_count: 4, default_branch: 'main' },
      { full_name: 'b/old', name: 'old', owner: { login: 'b' }, archived: true },
    ] } });
    const repos = await searchPluginRepos();
    expect(requested[0]).toContain(encodeURIComponent(`topic:${CATALOG_TOPIC}`));
    expect(repos).toEqual([expect.objectContaining({ fullName: 'a/plugins', owner: 'a', stars: 4, branch: 'main', url: 'https://github.com/a/plugins' })]);
  });

  it('explains a rate limit', async () => {
    answers.set('https://api.github.com/search', { status: 403, body: {}, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 120) } });
    await expect(searchPluginRepos()).rejects.toThrow(/rate limit.*2 minutes/);
  });
});

describe('listRepoPlugins', () => {
  it('lists only the .js files in the plugins folder', async () => {
    answers.set('https://api.github.com/repos/a/plugins/contents/plugins?ref=main', { body: [
      { type: 'file', name: 'one.js', path: 'plugins/one.js', html_url: 'https://github.com/a/plugins/blob/main/plugins/one.js', download_url: 'https://raw.githubusercontent.com/a/plugins/main/plugins/one.js', size: 10 },
      { type: 'file', name: 'README.md', path: 'plugins/README.md', download_url: 'x' },
      { type: 'dir', name: 'lib.js', path: 'plugins/lib.js' },
    ] });
    const files = await listRepoPlugins({ fullName: 'a/plugins', branch: 'main' });
    expect(files).toEqual([{ file: 'one.js', path: 'plugins/one.js', url: 'https://github.com/a/plugins/blob/main/plugins/one.js', downloadUrl: 'https://raw.githubusercontent.com/a/plugins/main/plugins/one.js', size: 10 }]);
  });

  it('returns nothing for a repository without the folder', async () => {
    expect(await listRepoPlugins({ fullName: 'a/empty' })).toEqual([]);
  });
});

describe('fetchPluginSource', () => {
  it('downloads the file and refuses one too large to be a plugin', async () => {
    answers.set('https://raw.githubusercontent.com/a/', { body: 'export default {}' });
    expect(await fetchPluginSource({ downloadUrl: 'https://raw.githubusercontent.com/a/x.js', size: 17 })).toBe('export default {}');
    await expect(fetchPluginSource({ downloadUrl: 'https://raw.githubusercontent.com/a/x.js', size: 10 * 1024 * 1024 })).rejects.toThrow(/too large/);
  });
});

describe('readPluginInfo', () => {
  it('reads the definition without running it', () => {
    globalThis.__catalogRan = false;
    const info = readPluginInfo(`globalThis.__catalogRan = true;
export default definePlugin({
  id: 'my-plugin',
  name: "My \\"best\\" plugin",
  version: '1.2.0',
  description: \`Does things\`,
  setup(api) { api.on('feed:posts', posts => posts.map(post => ({ ...post, name: 'other' }))); },
});`);
    expect(info).toEqual({ id: 'my-plugin', name: 'My "best" plugin', version: '1.2.0', description: 'Does things', author: '' });
    expect(globalThis.__catalogRan).toBe(false);
  });

  it('reads the documented example', () => {
    const info = readPluginInfo(readFileSync(new URL('../docs/examples/tag-count.plugin.js', import.meta.url), 'utf8'));
    expect(info).toMatchObject({ id: 'tag-count', name: 'Tag Count' });
    expect(info.description).toBeTruthy();
  });
});
