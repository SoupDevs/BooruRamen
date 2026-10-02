<div align="center">
  <img src="./src/assets/BooruRamen_Banner_Header.png" alt="BooruRamen Banner" width="100%" />
</div>

<br />

[![License](https://img.shields.io/badge/license-GPLv3-blue)](https://www.gnu.org/licenses/gpl-3.0) 

# Overview

BooruRamen is a personalized booru browser that learns what you love. It uses a client-side recommendation algorithm to deliver a unique, curated feed of images and videos that improves the more you use it.

<div align="center">
  <img src="./src/assets/BooruRamen_Banner_Example_1.png" alt="BooruRamen Banner Example 1" width="100%" />
</div>
<div align="center">
  <img src="./src/assets/BooruRamen_Banner_Example_2.png" alt="BooruRamen Banner Example 2" width="100%" />
</div>

### Key Features

- **Adaptive Feed**: A TikTok-style scroll that learns what you like in real-time.
- **Total Privacy**: No servers. No tracking. Your history stays on your device.
- **All-in-One**: Seamlessly browse sites running on Danbooru and Gelbooru engines in a single app.
- **Immersive Player**: Cinema-style viewer with custom controls for HD video & art.
- **Profile Stats**: Charts and graphs that visualize your unique taste.

### Recommendation System

BooruRamen uses a sophisticated recommendation system that:

- Analyzes your browsing patterns
- Learns from your likes, dislikes, favorites, and watchtime.
- Builds a personalized content profile
- Delivers a unique feed based on your preferences

All recommendations are processed locally in your browser for privacy.

### Profile Analytics

Gain insights into your preferences with the dedicated Analytics page:
- **Top Tags & Pairs**: See which content you engage with most.
- **Engagement Metrics**: Track Like and Favorite rates normalized by views.
- **Most Disliked**: Identify tags you frequently dislike to refine recommendations.
- **Video Analytics**: Monitor your total video watch time and average viewing duration.
- **Visualizations**: View tag distributions via responsive SVG-based charts.

# Getting Started
### Windows
1. **Download:** Get the .exe from the latest Releases.
2. **Run:** Double-click the .exe file to start the app.

### Linux
1. **Download:** Get the .AppImage or .deb from the latest Releases.
- For **AppImage**:
```
bash
chmod +x BooruRamen.AppImage
./BooruRamen.AppImage
```
- For **Debian/Ubuntu**:
```
bash
sudo dpkg -i BooruRamen.deb
```
### Android
1. **Download:** Get the .apk from the latest Releases.
2. **Install:** Open the .apk file and follow the installation prompts.

## Running from Source
### Prerequisites

- Node.js (v14 or newer)
- npm or yarn

### Installation

1. Clone the repository:
```
git clone https://github.com/SoupDevs/BooruRamen.git
cd BooruRamen
```

2. Install dependencies:
```
npm install
```

3. Start the development server:
```
npm run dev
```

4. Open your browser and navigate to:
```
http://localhost:5173
```

## Building

### Background image learning and tags

The feed shows an end-of-results message when no further matching posts are
available. Exact image hashes prevent the same content from appearing again
across sources. Perceptual hashes and spatial color, brightness, and edge
features provide additional inputs to the recommendation model; perceptual
hashes alone do not hide images.

On first launch, the app offers an optional local
[WD SwinV2 Tagger v3](https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3)
download (468 MB). Declining keeps it disabled. Download, progress, retry, and
enable and **Uninstall model** controls are available in **Profile Settings → Content**. Uninstalling disables tagging, stops active download/inference, and removes the model cache. It can be downloaded again from the same controls. The downloaded
model is cached on the device; images are analyzed locally in background
workers. Inferred tags enrich recommendations without changing the source's
tags or search filters. Image descriptors are cached per profile. Existing
recommendation models are migrated while preserving their learned weights.

Feed ranking also blends in a temporary session interest model, up to 25% of
the score as evidence builds. Likes, favorites, skips, watch time, and available
image composition influence this layer immediately, including unseen posts
already queued. It fades with a 30-minute half-life and resets on app restart,
recommendation reset, or 45 minutes of inactivity. Query selection uses the
same blended interests while profile analytics retain only lasting evidence.
Repeated interest in one topic has a limited contribution per session to the
stored profile, embeddings, and ML training. Interests repeated across sessions
can accumulate; the lasting profile uses a 30-day half-life.

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

Enabled sources' complete tag catalogs are retrieved a page at a time in the
background. Catalogs resume
after interruption and refresh weekly. Suggestions merge identical names and
exclude disabled sources immediately. When a source rejects catalog requests,
cached tags and live suggestions remain usable.
Post retrieval takes priority over background catalog and image requests.

Run `npm test` for the image learning, tag catalog, and model lifecycle tests.
With the Vite development server running, open `/tests/image-workers.html` and
click **Run worker smoke test** to verify hashing and actual local ONNX inference.
This downloads the model if it is not already cached. Native desktop/mobile
packaging requires the corresponding Tauri build environment.
The `/tests/session-worker.html` fixture checks live session ranking and durable
weights in the recommendation worker using an isolated synthetic database.

1. Clone the repository:
```
git clone https://github.com/SoupDevs/BooruRamen.git
cd BooruRamen
```
2. Install Dependencies
```bash
npm install
```
3. Build the Desktop App

This will compile the frontend and the Rust backend, then package them into an installer.
```bash
npm run tauri build
```

4. Build for Android (Optional)

- Requires:
  - Java Development Kit (JDK)
  - Android Studio

```bash
npm run tauri android build -- --apk true
```

The release APKs update themselves: the app downloads the newer APK and hands
it to the Android package installer. That needs a permission and a
`FileProvider`, which `tauri android init` knows nothing about, so they are
applied to the generated project by `scripts/android/patch_android_project.mjs`
(the release workflow runs it too):

```bash
npm run android:init     # tauri android init + apply the Android patches
npm run android:build    # apply the patches, then build the APK
```

#### Shipping a build without in-app updates

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
