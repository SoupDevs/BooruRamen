# Publishing on Google Play

Once the one-time setup below is done, publishing is automatic: every
release (a release branch merged into master) builds a Google Play app bundle
and uploads it to the **internal testing** track. Moving it to everyone is one
button: **Actions → Google Play: Promote → Run workflow** (internal →
production).

| Workflow | What it does | When |
| --- | --- | --- |
| Google Play: Upload | Builds the Play bundle (AAB) for a release tag and uploads it to a track. Track `none` only builds it (artifact `play-aab`). | After every release (once enabled), or by hand |
| Google Play: Promote | Moves the release on one track to another, optionally as a staged rollout. | By hand |
| Google Play: Update store listing | Pushes `fastlane/metadata/android` (text, icon, feature graphic, screenshots). | By hand, after editing the listing |
| Android Test Build | Tick "Google Play bundle" to get a test AAB from any branch. | By hand |

The Play build is the normal app without the `sideload-updates` Cargo
feature: no install permission, no GitHub update checks. Play updates it.

## One-time setup

### 1. Developer account
1. Sign up at <https://play.google.com/console/signup> ($25 once) and finish
   identity verification.
2. A **personal** account created after November 2023 must run a closed test
   with at least 12 testers for 14 days before it can publish to production.
   An organization account (needs a D-U-N-S number) skips that.

### 2. Create the app
Play Console → **Create app**: name `BooruRamen`, language English (United
States), **App**, **Free**, accept the declarations.

### 3. First upload (by hand, once)
Google only accepts API uploads after the first bundle went up through the
Console.
1. Make sure the Play workflows are on master (merge the release branch).
2. **Actions → Google Play: Upload → Run workflow** with track `none`. When it
   finishes, download the `play-aab` artifact and unzip it.
3. Play Console → **Test and release → Testing → Internal testing → Create
   new release**. When asked about app signing, keep **Google-generated key**
   (recommended). The bundle is signed with the existing release key, which
   becomes the *upload key*.
4. Upload `app-release.aab`, add a release note, **Save → Review → Roll out**.
   Add yourself under **Testers** to install it from Play.

> Signing note: with a Google-generated key, the Play app and the GitHub APK
> are signed differently, so one cannot update the other. Someone moving from
> the APK to Play uninstalls first; Profile → Profiles → Export keeps their
> taste profile. (To make them interchangeable instead, pick "Use a different
> key → Export and upload a key from Java keystore" in step 3 and upload the
> release key with Google's PEPK tool. That choice cannot be changed later.)

### 4. Let GitHub publish
1. Google Cloud console (<https://console.cloud.google.com>): create or pick a
   project, enable the **Google Play Android Developer API**, then **IAM &
   Admin → Service accounts → Create service account** (no roles needed).
   Open it → **Keys → Add key → JSON**, which downloads a key file.
2. Play Console → **Users and permissions → Invite new users**: the service
   account's e-mail. Under **App permissions** add BooruRamen with *Release
   apps to testing tracks*, *Release to production, exclude devices, and use
   Play App Signing* and *Manage store presence*. Invite.
3. GitHub repo → **Settings → Secrets and variables → Actions**:
   - New secret `PLAY_SERVICE_ACCOUNT_JSON`: paste the whole JSON file.
   - Variables tab → new variable `PLAY_STORE_ENABLED` = `true`.
   - Optional variable `PLAY_TRACK` (`internal` by default; `alpha` is the
     closed testing track).
   - Variable `PLAY_RELEASE_STATUS` = `draft` while the dashboard still says
     **Draft app** (until the first production release is live): Google
     rejects any other status for an unpublished app. Each upload then waits
     as a draft on its track; open it in the Console and roll it out. Delete
     the variable once the app is published.
   Then delete the downloaded JSON file.

### 5. Store listing
Run **Actions → Google Play: Update store listing** (needs step 4), or paste
the files from `fastlane/metadata/android/en-US` by hand. Then in **Grow →
Store presence → Store settings**: category **Art & Design**, contact e-mail
(required, shown publicly), website `https://github.com/SoupDevs/BooruRamen`.

### 6. App content (Policy → App content)
- **Privacy policy:** `https://github.com/SoupDevs/BooruRamen/blob/master/PRIVACY.md`
- **Ads:** No ads.
- **App access:** All functionality is available without special access.
- **Content rating:** see below.
- **Target audience:** 18 and over only. (The app shows general-rated posts,
  but it is a viewer for third-party image sites and is not designed for
  children.)
- **Data safety:** see below.
- **News app:** No. **Government app:** No. **Financial features:** none.
  **Health:** none. **Advertising ID:** No.

#### Content rating questionnaire
Category: **All other app types**. Answer honestly for what the app shows:
- Violence, fear, sexuality, language, controlled substances, crude humor:
  **No** for anything beyond what general-rated (all-ages) art can contain.
  The feed only shows posts the sites rate General, and every blocked tag is
  filtered out.
- **User-generated content / users interact:** the app shows images and
  comments posted on third-party sites (Yes to displaying user-generated
  content); users cannot message or share content with each other inside the
  app (No to interaction).
- Shares location: No. Digital purchases: No. Gambling: No.
- Expect a Teen-level rating because of user-generated content.

#### Data safety form
- Does your app collect or share any of the required user data types? **No.**
  The developer runs no servers and receives nothing. Likes, history, settings
  and optional site API keys stay on the device; requests go straight from the
  phone to the sites the user browses (like a web browser).
- Account creation: none. Data deletion: users clear it in the app or by
  uninstalling.

### 7. Go live
- Personal account: create a **Closed testing** release (promote internal →
  alpha), add 12+ testers by e-mail or Google Group, keep it running 14 days,
  then **Apply for production** on the dashboard.
- Before production access, promote by hand in the Console (the Promote
  workflow, like every API release, can only make drafts on an unpublished
  app). Once the app is published, **Actions → Google Play: Promote**, from
  `internal` (or `alpha`) to `production`. Google reviews the first production release (a few days).

## Every release after that
1. Merge the release branch into master. The release workflow tags it,
   builds the APK and EXE for GitHub, and uploads the Play bundle to
   `PLAY_TRACK` with "What's new" made from the release's PR titles (or from
   `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt` if present).
2. Try it from the internal track, then run **Google Play: Promote** to
   production (100%, or e.g. 20 for a staged rollout you finish in the
   Console).

Version codes come from the version (`major*1000000 + minor*1000 + patch`),
so each release has a new one and only release tags are uploaded.
