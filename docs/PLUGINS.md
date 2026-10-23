# Writing plugins

Plugins change how BooruRamen behaves without changing its source: what the
feed searches for, which fetched posts it keeps, how it ranks them, and what
the app's screens show. This guide covers everything a plugin can do. For
building the app itself, see [DEVELOPMENT.md](DEVELOPMENT.md).

- [Quick start](#quick-start)
- [How plugins work](#how-plugins-work)
- [The plugin definition](#the-plugin-definition)
- [The api object](#the-api-object)
- [Settings](#settings)
- [Content filters](#content-filters)
- [Hooks reference](#hooks-reference)
- [Testing a plugin](#testing-a-plugin)

## Quick start

A plugin is a JavaScript module whose default export is a plugin definition.
Bundled plugins live in `src/plugins/bundled/<name>/index.js` and are picked
up automatically:

```js
// src/plugins/bundled/hello/index.js
import { definePlugin } from '../../definePlugin.js';

export default definePlugin({
  id: 'hello',
  name: 'Hello',
  description: 'Logs a greeting when it is turned on.',
  setup(api) {
    api.log.info('Hello from a plugin');
    return () => api.log.info('Goodbye');
  },
});
```

Run `npm run dev`, open **Profile → Plugins** and turn it on.

## How plugins work

- The app decides where plugins can take part. Each extension point is a
  **hook** with a name such as `feed:queries`; a plugin subscribes with
  `api.on(name, handler)`.
- A plugin is turned on and off on the Plugins page. Turning it on calls its
  `setup(api)`; turning it off removes every hook, page and style it
  registered and calls the function `setup` returned, if any. No reload is
  needed either way, so `setup` must not leave anything behind that it
  doesn't clean up.
- Bundled plugins start turned off unless their definition sets
  `enabledByDefault: true`. The on/off choice is remembered across launches.
- Plugins are app-wide: they stay on when you switch profiles.
- Errors are contained. A handler that throws, takes longer than 1.5 s or
  returns something the hook can't use is skipped for that call and the
  error is shown on the Plugins page. After 5 errors in a session the plugin
  is turned off. A `setup` that throws or takes longer than 5 s leaves the
  plugin off.

## The plugin definition

```js
definePlugin({
  id: 'my-plugin',          // required: 2-64 of a-z 0-9 . _ -, unique
  name: 'My plugin',        // required: shown on the Plugins page
  version: '1.0.0',
  description: 'One line on what it does.',
  author: 'You',
  apiVersion: 1,            // the plugin API it was written for
  enabledByDefault: false,  // bundled plugins only
  settings: [],             // see Settings
  setup(api) {              // required; may be async
    // register hooks here
    return () => {};        // optional cleanup
  },
});
```

`definePlugin` checks the definition and throws a descriptive error if
something is wrong. A plugin asking for a newer `apiVersion` than the app
provides is refused.

## The api object

`setup` receives one `api` object. It is the only thing a plugin needs.

| Member | What it does |
| --- | --- |
| `api.id` | The plugin's id. |
| `api.apiVersion` | The plugin API version the app provides. |
| `api.on(hook, handler, { priority })` | Subscribe to a hook. Higher `priority` runs first (default 0). Returns an unsubscribe function. |
| `api.onDispose(fn)` | Run `fn` when the plugin is turned off. |
| `api.settings.get(key)` / `.all()` / `.set(key, value)` | Read and write the plugin's declared settings. |
| `api.settings.onChange(fn)` | `fn(key, value)` after a setting changes. |
| `api.storage.get(key, fallback)` / `.set(key, value)` / `.remove(key)` / `.keys()` | A small JSON key-value store kept per plugin across launches. |
| `api.log.info/warn/error(...)` | Console logging prefixed with the plugin's id. |
| `api.policy` | The feed's default content filters, read-only (see below). |
| `api.feed.scorePosts(fn, { priority })` | Shorthand for `feed:score`: `fn(post, context)` returns a ranking multiplier. |
| `api.feed.invalidate()` | Drop queued candidates so the next batch is fetched and ranked afresh, e.g. after a setting changed. |

Everything registered through `api` is removed automatically when the plugin
is turned off.

## Settings

Declare settings and the Plugins page renders a form for them while the
plugin is on. Values are checked against their type before they are stored.

```js
settings: [
  { key: 'strength', type: 'number', label: 'Strength', default: 1, min: 0, max: 3, step: 0.1 },
  { key: 'enabledInDive', type: 'boolean', label: 'Also in Deep Dive', default: false },
  { key: 'mode', type: 'select', label: 'Mode', options: ['soft', { value: 'hard', label: 'Hard' }] },
  { key: 'tags', type: 'tags', label: 'Tags', description: 'Comma or space separated' },
  { key: 'note', type: 'string', label: 'Note' },
],
```

| Type | Value | Notes |
| --- | --- | --- |
| `boolean` | `true`/`false` | |
| `number` | number | Clamped to `min`/`max`. |
| `string` | string | |
| `select` | one of the option values | `options` is required. |
| `tags` | array of lowercase tags | Duplicates removed. |

## Content filters

By default the feed shows **General-rated posts only** and **never shows a
post with a blacklisted tag**; the blacklist is applied to fetched posts on
the device. The app applies both after every plugin hook has run, so hooks
like `feed:posts` and `feed:batch` can't get around them.

Changing them is a deliberate, separate step: the `feed:filters` hook (see
[Hooks reference](#hooks-reference)). They hold until the user turns on a
plugin that uses it. `api.policy` holds the defaults, read-only:

```js
api.policy.ratings                 // ['general']
api.policy.blacklistAlwaysFiltered // true
```

## Hooks reference

Hooks come in two kinds:

- **waterfall** hooks pass a value through every subscribed plugin in turn.
  Return a replacement value, or `undefined` to leave it unchanged. Handlers
  may be async.
- **event** hooks tell plugins something happened. Their return value is
  ignored.

Every hook's `context` is a frozen object. Feed hooks' contexts always
include `deepDive` (true while a Deep Dive is running), `whitelist` and
`blacklist`. Deep Dive is meant to stay focused on its anchor post, so most
plugins should leave dive batches alone:

```js
api.on('feed:queries', (queries, { deepDive }) => {
  if (deepDive) return; // unchanged
  return [...queries, { tags: 'scenery', type: 'my-plugin' }];
});
```

### How a feed batch is built

0. The feed's content filters are settled → **`feed:filters`**
1. The recommendation engine plans its strategy queries → **`feed:queries`**
2. Each query becomes a booru request (whitelist tags, spare-slot blacklist
   exclusions, rating and file type added) → **`feed:request`**
3. Each request's results → **`feed:posts`**
4. The app's content gate drops other ratings, blacklisted tags, seen posts
   and duplicates, using the filters from step 0.
5. Candidates are ranked → **`feed:score`** multipliers are applied
6. The batch is assembled (exploration, diversity) → **`feed:batch`**
7. The content gate runs again, then reported/blocked posts are removed and
   the batch is added to the feed.

### `feed:filters` (waterfall)

The ratings the feed shows and the tags it hides, for the next batch.

- **value**: `{ ratings, blacklist }`, by default `{ ratings: ['general'], blacklist: [...the user's blacklist] }`
- **context**: `{ deepDive, whitelist }`
- **return**: a new `{ ratings, blacklist }`. `ratings` is one or more of
  `'general'`, `'sensitive'`, `'questionable'`, `'explicit'` (or `g`/`s`/`q`/`e`);
  `blacklist` is a list of tags. Anything else is rejected and the defaults
  are kept.

The result is what every request's rating metatag and the content gate use
for that batch.

```js
api.on('feed:filters', filters => ({ ...filters, ratings: [...filters.ratings, 'sensitive'] }));
```

### `feed:queries` (waterfall)

The strategy queries for the next batch.

- **value**: array of `{ tags, type, intent, reason }`. `tags` is a
  space-separated tag string; `type` names the strategy (shown in the debug
  overlay and used for the "why this post" chip).
- **context**: `{ deepDive, whitelist, blacklist }` (`blacklist` is the one
  `feed:filters` settled on, as in the hooks below)
- **return**: a new array. Plain strings are accepted as `{ tags }`. At most
  12 queries are kept, rating metatags (`rating:`, `-rating:`, `is:nsfw`, ...)
  are removed from `tags`, and `type` defaults to `'plugin'`.

Each query keeps its own page cursor, so a query you add is paged deeper on
every batch until it runs dry.

### `feed:request` (waterfall)

The final tag string of one booru request.

- **value**: string, e.g. `'meme cat -spider rating:g -filetype:swf'`
- **context**: `{ deepDive, whitelist, blacklist, strategy, page }`
- **return**: a new tag string. Rating metatags are removed and the feed's
  own rating metatag (from `feed:filters`) is added back. Remember the source's tag limit (Danbooru's
  free tier allows two non-metatag tags); extra tags make the request fail or
  return nothing.

### `feed:posts` (waterfall)

The posts one request returned, before the content gate.

- **value**: array of posts (see [Post fields](#post-fields))
- **context**: `{ deepDive, whitelist, blacklist, strategy, tags }`
- **return**: a new array. You can drop posts, annotate them (use keys
  starting with `_yourPluginId` to avoid collisions) or add posts from
  elsewhere. Every post, added or not, then passes the content gate, so an
  added post with another rating or a blacklisted tag is dropped.

### `feed:score` (waterfall)

Ranking multipliers, one per candidate.

- **value**: array of numbers, all `1` before the first plugin
- **context**: `{ deepDive, whitelist, blacklist, posts, recent }`: `posts[i]`
  is the candidate `value[i]` belongs to; `recent` is the last few posts the
  user saw
- **return**: an array of the same length. Each weight is clamped to
  `[0, 4]`; the engine multiplies its own score by it. `0` sinks a post to
  the bottom of the batch (use `feed:posts` to remove one).

`api.feed.scorePosts(fn)` is the easy way in. Weights from several plugins
multiply:

```js
api.feed.scorePosts(post => (post.tag_string.split(' ').includes('scenery') ? 1.5 : 1));
```

The multiplier changes ranking only. What the user does with a post is
learned as usual, so a plugin can't teach the engine false interests.

### `feed:batch` (waterfall)

The posts about to be added to the feed, in order.

- **value**: array of posts
- **context**: `{ deepDive, whitelist, blacklist }`
- **return**: the posts in the order you want. Only posts from the value are
  kept; anything else (and duplicates) is dropped. Posts you leave out are
  not shown in this batch.

### `post:interaction` (event)

A like, dislike, favorite, watch time (short watch time is how a skip shows up) or revisit was recorded.

- **payload**: `{ postId, type, value, post, deepDive }`. `type` is e.g.
  `'like'`, `'dislike'`, `'favorite'`, `'timeSpent'`, `'revisit'`.

### `feed:postShown` (event)

A post became the current post in the feed.

- **payload**: `{ post, index, deepDive }`

### Post fields

Posts are normalized across sources. The fields plugins usually need:

| Field | Meaning |
| --- | --- |
| `id`, `source` | Identity. `source` is the booru's base URL. |
| `tag_string` | All tags, space-separated. |
| `tag_string_artist` / `_character` / `_copyright` / `_general` / `_meta` | Tags by category, where the source provides them. |
| `rating` | `'g'`, `'s'`, `'q'` or `'e'`. |
| `score`, `fav_count` | Booru popularity. |
| `file_ext`, `file_url`, `preview_file_url` | Media. |
| `created_at` | Upload time. |
| `_strategy` | The query type that found the post. |
| `_score` | The engine's score (set at assembly). |

## Testing a plugin

The host can be used directly in a [vitest](https://vitest.dev) test, without
the app:

```js
import { PluginHost } from '../src/plugins/PluginHost.js';
import myPlugin from '../src/plugins/bundled/my-plugin/index.js';

const host = new PluginHost();
await host.start();
await host.register(myPlugin);
await host.setEnabled(myPlugin.id, true);
```

`tests/pluginHost.test.js` shows more.
