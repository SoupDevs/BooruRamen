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
