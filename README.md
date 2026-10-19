<div align="center">
  <img src="./src/assets/BooruRamen_Banner_Header.png" alt="BooruRamen" width="100%" />

  <h3>A booru browser that learns what you love.</h3>

  [![Latest release](https://img.shields.io/github/v/release/SoupDevs/BooruRamen)](https://github.com/SoupDevs/BooruRamen/releases/latest)
  [![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20Android-ec4899)](https://github.com/SoupDevs/BooruRamen/releases/latest)
  [![License](https://img.shields.io/badge/license-GPLv3-blue)](https://www.gnu.org/licenses/gpl-3.0)
</div>

BooruRamen turns your favorite booru sites into one endless, personalized feed.
Scroll, like, skip and favorite, and the feed quietly reshapes itself around
your taste. Everything it learns stays on your device.

<!--
Screenshots: add current captures to docs/screenshots/ and uncomment.
<div align="center">
  <img src="./docs/screenshots/feed.png" alt="Feed" width="24%" />
  <img src="./docs/screenshots/details.png" alt="Post details and Deep Dive" width="24%" />
  <img src="./docs/screenshots/analytics.png" alt="Profile analytics" width="24%" />
  <img src="./docs/screenshots/settings.png" alt="Settings" width="24%" />
</div>
-->

## Why BooruRamen

- **A feed that adapts as you scroll.** Likes, skips, favorites and watch time
  shape what comes next, right away in the current session and over time in
  your profile.
- **Deep Dive.** Found something great? Dive into it and the feed fills with
  closely related posts until you choose to come back up.
- **Every booru in one place.** Mix Danbooru, Gelbooru and Moebooru-based sites,
  including your own custom sources, in a single feed.
- **Private by design.** No accounts, no servers, no tracking. Recommendations
  are computed on your device.
- **Optional on-device AI tagging.** Download a local image tagger to help the
  feed understand images beyond their source tags. Nothing is uploaded.
- **A proper viewer.** Full-screen images and video with custom controls,
  tags, comments, downloads and sharing.
- **Know your taste.** Analytics show your top tags and pairings, like and
  favorite rates, and video watch time.
- **Make it yours.** Pick a theme preset or build your own colors and fonts.
- **Profiles for every mood.** Keep separate profiles, each with its own
  sources, filters and learned preferences, and export them to move between
  devices.

## Getting started

Download the latest version from the
[Releases page](https://github.com/SoupDevs/BooruRamen/releases/latest).

| Platform | Download | Install |
| --- | --- | --- |
| Windows | `.exe` or `.msi` | Run the installer. |
| Android | `.apk` | Open the file and allow the install. The app keeps itself up to date. |

Start scrolling right away, or open **Profile → Settings → Content** to choose
your sources, ratings and tag filters. The feed gets better the more you use it.

## Running from source

You need Node.js 20.19 or newer.

```bash
git clone https://github.com/SoupDevs/BooruRamen.git
cd BooruRamen
npm install
npm run dev
```

Open http://localhost:5173 to use the app in your browser. To build the
desktop or Android app, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), which
also explains how the recommendation engine works.

## License

BooruRamen is free software released under the [GPLv3](LICENSE).
