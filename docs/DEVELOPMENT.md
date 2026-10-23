# Development

Notes for building BooruRamen from source and for working on its internals.
For a quick overview of the app, see the [README](../README.md). To extend
the app without changing its source, see [PLUGINS.md](PLUGINS.md).

## Requirements

- Node.js 20.19 or newer (required by Vite 7)
- Rust and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform, for native builds
- JDK and Android Studio (SDK + NDK), for Android builds

## Running in the browser

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Building

Desktop app (compiles the frontend and the Rust backend, then packages an installer):

```bash
npm run tauri build
```

Android:

```bash
npm run android:init     # tauri android init + apply the Android patches
npm run android:build    # apply the patches, then build the APK
```

The release APKs update themselves: the app downloads the newer APK and hands
it to the Android package installer. That needs a permission and a
`FileProvider`, which `tauri android init` knows nothing about, so they are
applied to the generated project by `scripts/android/patch_android_project.mjs`
(the release workflow runs it too).

### Shipping a build without in-app updates

A build whose updates come from a store (Google Play, F-Droid) removes the
mechanism by dropping one feature from `default` in `src-tauri/Cargo.toml`:

```toml
default = []
```

The installer code is then not compiled in, `install_update` reports that the
store owns updates, and the next `patch_android_project.mjs` run strips
`REQUEST_INSTALL_PACKAGES`, the update `FileProvider` and its paths file from
the generated manifest (the download permissions the app needs elsewhere stay
in place).

## Testing

```bash
npm test     # vitest: image learning, tag catalog, model lifecycle, ...
npm run lint
```

With the Vite development server running, open `/tests/image-workers.html` and
click **Run worker smoke test** to verify hashing and actual local ONNX
inference. This downloads the model if it is not already cached. The
`/tests/session-worker.html` fixture checks live session ranking and durable
weights in the recommendation worker using an isolated synthetic database.

## How recommendations work

### Background image learning and tags

The feed shows an end-of-results message when no further matching posts are
available. Exact image hashes prevent the same content from appearing again
across sources. Perceptual hashes and spatial color, brightness, and edge
features provide additional inputs to the recommendation model; perceptual
hashes alone do not hide images.

On first launch, the app offers an optional local
[WD SwinV2 Tagger v3](https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3)
download (468 MB). Declining keeps it disabled. Download, progress, retry,
enable and **Uninstall model** controls are available in
**Profile Settings → Content**. Uninstalling disables tagging, stops active
download/inference, and removes the model cache. The downloaded model is
cached on the device; images are analyzed locally in background workers.
Inferred tags enrich recommendations without changing the source's tags or
search filters. Image descriptors are cached per profile. Existing
recommendation models are migrated while preserving their learned weights.

### Session interests

Feed ranking also blends in a temporary session interest model, up to 25% of
the score as evidence builds. Likes, favorites, skips, watch time, and available
image composition influence this layer immediately, including unseen posts
already queued. It fades with a 5-minute half-life and resets on app restart,
recommendation reset, or 15 minutes of inactivity. Query selection uses the
same blended interests while profile analytics retain only lasting evidence.
Repeated interest in one topic has a limited contribution per session to the
stored profile, embeddings, and ML training. Interests repeated across sessions
can accumulate; the lasting profile uses a 30-day half-life.

### Deep Dive

While viewing a post, open the right sidebar and choose **Deep Dive** to explore
similar content. The selected post remains the anchor as you scroll. Shared
tags, learned tag relationships, and cached image composition supply 90% of
ranking, with normal recommendations providing the remaining 10%. Source,
rating, media, tag, and blocking filters still apply. Deep Dive replaces unseen
queued content without moving the current post, and shows an end message when
its queries run out rather than switching to unrelated popular posts.
Choose **End Deep Dive** in the sidebar or **End** in the feed indicator to
return to normal recommendations. Dive interactions leave normal session
interests unchanged and use one-tenth of their usual moderated learning weight
for the stored profile, embeddings, and neural model. Deep Dive is temporary
and ends on app restart or recommendation reset.

### Tag catalogs

Enabled sources' complete tag catalogs are retrieved a page at a time in the
background. Catalogs resume after interruption and refresh weekly. Suggestions
merge identical names and exclude disabled sources immediately. When a source
rejects catalog requests, cached tags and live suggestions remain usable.
Post retrieval takes priority over background catalog and image requests.

See also [RECOMMENDATION_ENGINE_ANALYSIS.md](../RECOMMENDATION_ENGINE_ANALYSIS.md).
