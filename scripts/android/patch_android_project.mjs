#!/usr/bin/env node
/**
 * BooruRamen - Android project patch
 *
 * `tauri android init` generates src-tauri/gen/android from the plain Tauri
 * template, which knows nothing about BooruRamen's extra Android needs. This
 * script applies them and is safe to run repeatedly (it removes what it
 * previously inserted before re-inserting).
 *
 *   1. Download permissions  - legacy WRITE_EXTERNAL_STORAGE + POST_NOTIFICATIONS
 *      (every build).
 *   2. Sideload update plumbing - REQUEST_INSTALL_PACKAGES (inside markers, so it
 *      can be removed again) while the `sideload-updates` Cargo feature is in the
 *      default feature set. Dropping that feature (a Google Play build) also drops
 *      every trace of the sideload path from the generated project.
 *
 * The downloaded APK is shared with the installer through the FileProvider that
 * `tauri android init` already declares - never through a second one: Android
 * attaches one instance per provider class, so a second declaration makes the
 * installer reject the URI with a SecurityException.
 *
 * Run it after `tauri android init` and before `tauri android build`:
 *   npm run android:init     (init + patch)
 *   npm run android:build    (patch + build)
 *
 * Every step asserts its anchor and verifies the result: a silently skipped
 * patch here is invisible until an installed app downloads an update and then
 * cannot hand it to the installer.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

/** Walk up from this script until we find the repository root. */
function findRepoRoot(from) {
  let dir = from
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, 'src-tauri', 'tauri.conf.json'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  fail(`could not find the repository root (looked for src-tauri/tauri.conf.json above ${from})`)
}

const repoRoot = findRepoRoot(scriptDir)

const SIDELOAD_FEATURE = 'sideload-updates'
const MARK_START = '<!-- booruramen:sideload-updates -->'
const MARK_END = '<!-- /booruramen:sideload-updates -->'
const TEMPLATE_PATHS_RES = 'file_paths.xml'

const warnings = []
const applied = []

function fail(message) {
  console.error(`\n[patch-android] ERROR: ${message}`)
  process.exit(1)
}

function note(message) {
  applied.push(message)
  console.log(`[patch-android] ${message}`)
}

// --- inputs ---------------------------------------------------------------

const tauriConfPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json')
const cargoTomlPath = path.join(repoRoot, 'src-tauri', 'Cargo.toml')
const androidAppDir = path.join(repoRoot, 'src-tauri', 'gen', 'android', 'app', 'src', 'main')

if (!fs.existsSync(tauriConfPath)) fail(`missing ${tauriConfPath}`)
if (!fs.existsSync(androidAppDir)) {
  fail(`missing ${androidAppDir} - run "tauri android init" first`)
}

const identifier = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8')).identifier
if (!identifier) fail('tauri.conf.json has no identifier')

const manifestPath = path.join(androidAppDir, 'AndroidManifest.xml')
const resXmlDir = path.join(androidAppDir, 'res', 'xml')
const mainActivityName = 'MainActivity.kt'
const mainActivityPath = path.join(
  androidAppDir,
  'java',
  ...identifier.split('.'),
  mainActivityName
)

if (!fs.existsSync(manifestPath)) fail(`missing ${manifestPath}`)

/** Whether the sideload-updates Cargo feature ships enabled in this build. */
function sideloadUpdatesEnabled() {
  const lines = fs.readFileSync(cargoTomlPath, 'utf8').split(/\r?\n/)
  const start = lines.findIndex(line => /^\s*\[features\]\s*$/.test(line))
  if (start === -1) fail('src-tauri/Cargo.toml has no [features] section')

  const block = []
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i])) break
    block.push(lines[i])
  }

  const def = block.join('\n').match(/^\s*default\s*=\s*\[([\s\S]*?)\]/m)
  if (!def) {
    warnings.push(
      `[features] has no default set, treating "${SIDELOAD_FEATURE}" as disabled`
    )
    return false
  }
  const list = def[1]
    .split(',')
    .map(entry => entry.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
  return list.includes(SIDELOAD_FEATURE)
}

function stripMarked(xml, start, end) {
  const from = xml.indexOf(start)
  if (from === -1) return xml
  const to = xml.indexOf(end, from)
  if (to === -1) fail(`found "${start}" without its closing marker`)
  return xml.slice(0, from) + xml.slice(to + end.length)
}

/** Strip every block this script ever marked, so re-runs converge. */
function stripAllMarked(xml) {
  let next = xml
  for (let i = 0; i < 10 && next.includes(MARK_START); i += 1) {
    next = stripMarked(next, MARK_START, MARK_END)
  }
  if (next.includes(MARK_START)) fail('unbalanced sideload-update markers in AndroidManifest.xml')
  return next
}

/** Remove a `<uses-permission>` element (single- or multi-line form). */
function stripPermission(xml, permission) {
  const escaped = permission.replace(/[.]/g, '\\.')
  const pattern = new RegExp(
    `[ \\t]*<uses-permission[^>]*android:name="${escaped}"[^>]*/>[ \\t]*\\r?\\n`,
    'g'
  )
  const next = xml.replace(pattern, '')
  return { xml: next, removed: next !== xml }
}

/**
 * Make sure the generated FileProvider can serve <app cache>/updates/, where
 * the updater puts the downloaded APK. The template usually exposes the whole
 * cache already; if it ever stops doing that, add the one path we need.
 */
function ensureUpdateCachePath() {
  const pathsPath = path.join(resXmlDir, TEMPLATE_PATHS_RES)
  if (!fs.existsSync(pathsPath)) {
    fail(`missing ${pathsPath} - the FileProvider from tauri android init needs it`)
  }
  const original = fs.readFileSync(pathsPath, 'utf8')
  const eolPaths = original.includes('\r\n') ? '\r\n' : '\n'
  let paths = stripAllMarked(original.replace(/\r\n/g, '\n'))
  if (/<cache-path[^>]*path="\."/.test(paths)) {
    note(`${TEMPLATE_PATHS_RES}: already exposes the app cache (holds the update APK)`)
  } else {
    const entry = [
      MARK_START,
      '  <cache-path name="updates" path="updates/" />',
      MARK_END
    ].join(eolPaths)
    paths = paths.replace(/(\r?\n)<\/paths>/, `$1${entry}$1</paths>`)
    if (!paths.includes('name="updates"')) {
      fail(`could not add a cache path to ${TEMPLATE_PATHS_RES}`)
    }
    note(`${TEMPLATE_PATHS_RES}: added <cache-path name="updates" path="updates/" />`)
  }
  const next = paths.replace(/\n/g, eolPaths)
  if (next !== original) fs.writeFileSync(pathsPath, next)
}

/** Remove a `<provider>` element identified by its FileProvider authority. */
function stripProviderByAuthority(xml, authority) {
  const marker = `android:authorities="${authority}"`
  const at = xml.indexOf(marker)
  if (at === -1) return { xml, removed: false }
  const start = xml.lastIndexOf('<provider', at)
  if (start === -1) fail(`found ${authority} without an opening <provider>`)
  const closeTag = '</provider>'
  const end = xml.indexOf(closeTag, at)
  if (end === -1) fail(`found ${authority} without a closing ${closeTag}`)
  let after = end + closeTag.length
  // also swallow the whitespace/line break the element was sitting on, so
  // repeated runs do not add blank lines
  const rest = xml.slice(after)
  const trimmed = rest.replace(/^[ \t]*\r?\n/, '')
  after += rest.length - trimmed.length
  return { xml: xml.slice(0, start) + trimmed, removed: true }
}

/** Insert text right after a `<uses-permission>` element, or return null. */
function insertAfterElement(xml, containsText, insertion) {
  const index = xml.indexOf(containsText)
  if (index === -1) return null
  const close = xml.indexOf('/>', index)
  if (close === -1) return null
  const at = close + 2
  return xml.slice(0, at) + '\n' + insertion + xml.slice(at)
}

/** Add a permission inside a marked block so the feature can remove it again. */
function ensureMarkedPermission(permission, comment) {
  if (xml.includes(`android:name="${permission}"`)) return
  const block = join([
    `    ${MARK_START}`,
    `    <!-- ${comment} -->`,
    `    <uses-permission android:name="${permission}" />`,
    `    ${MARK_END}`
  ])
  const afterInternet = insertAfterElement(
    xml,
    'android.permission.INTERNET',
    block
  )
  if (!afterInternet) fail(`could not find a place to add the ${permission} permission`)
  xml = afterInternet
}

/** Insert a permission element when the manifest does not already declare it. */
function ensurePermission(xml, permission) {
  if (xml.includes(`android:name="${permission}"`)) return { xml, changed: false }
  const element = `    <uses-permission android:name="${permission}" />`
  const afterInternet = insertAfterElement(
    xml,
    'android.permission.INTERNET',
    element
  )
  if (afterInternet) return { xml: afterInternet, changed: true }
  const beforeFeature = xml.replace(
    /(\n\s*<uses-feature)/,
    `\n${element}$1`
  )
  if (beforeFeature !== xml) return { xml: beforeFeature, changed: true }
  fail(`could not find a place to add the ${permission} permission`)
}

// --- manifest -------------------------------------------------------------

let xml = fs.readFileSync(manifestPath, 'utf8')
// Inserted lines follow the file's own convention; the manifest generated by
// `tauri android init` is CRLF, and a mixed file makes every later diff noisy.
const eol = xml.includes('\r\n') ? '\r\n' : '\n'
const join = lines => lines.join(eol)
const sideload = sideloadUpdatesEnabled()

// Drop anything this script added before, so repeated runs converge.
xml = stripAllMarked(xml)

// 1. Download permissions, on every build.
for (const permission of [
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.POST_NOTIFICATIONS'
]) {
  const result = ensurePermission(xml, permission)
  xml = result.xml
}

// 2. Sideload update plumbing.
if (sideload) {
  ensureMarkedPermission(
    'android.permission.REQUEST_INSTALL_PACKAGES',
    'Lets the in-app updater hand a downloaded APK to the system package installer.'
  )

  // An older workflow declared a second FileProvider on its own authority,
  // which Android cannot serve (one instance per provider class). Drop it.
  const legacy = stripProviderByAuthority(xml, identifier + '.updates.provider')
  xml = legacy.xml
  if (legacy.removed) {
    warnings.push(
      `removed a legacy ${identifier}.updates.provider declaration - two FileProviders ` +
        'with the same class cannot both serve URIs'
    )
  }

  ensureUpdateCachePath()
} else {
  // Feature off: leave no trace of the sideload path, including in a manifest
  // patched by something older than this script.
  const stale = stripPermission(xml, 'android.permission.REQUEST_INSTALL_PACKAGES')
  if (stale.removed) {
    xml = stale.xml
    warnings.push('removed a leftover REQUEST_INSTALL_PACKAGES permission')
  }
  const legacyOff = stripProviderByAuthority(xml, identifier + '.updates.provider')
  xml = legacyOff.xml
  if (legacyOff.removed) {
    warnings.push(`removed a legacy ${identifier}.updates.provider declaration`)
  }
  const pathsPath = path.join(resXmlDir, TEMPLATE_PATHS_RES)
  if (fs.existsSync(pathsPath)) {
    const original = fs.readFileSync(pathsPath, 'utf8')
    const stripped = stripAllMarked(original)
    if (stripped !== original) {
      fs.writeFileSync(pathsPath, stripped)
      note(`${TEMPLATE_PATHS_RES}: removed the updates cache path`)
    }
  }
}

if (xml !== fs.readFileSync(manifestPath, 'utf8')) {
  fs.writeFileSync(manifestPath, xml)
}

// Verify what we claim to have written.
const written = fs.readFileSync(manifestPath, 'utf8')
for (const permission of [
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.POST_NOTIFICATIONS'
]) {
  if (!written.includes(`android:name="${permission}"`)) {
    fail(`AndroidManifest.xml is missing ${permission} after patching`)
  }
}
const hasInstallPermission = written.includes(
  'android:name="android.permission.REQUEST_INSTALL_PACKAGES"'
)
// One provider class can only serve one authority, so the manifest must not
// grow a second FileProvider - that is what made installs fail with
// "The authority ... does not match the one of the contentProvider".
const providerCount = written.split('androidx.core.content.FileProvider').length - 1
if (providerCount !== 1) {
  fail(
    `AndroidManifest.xml declares ${providerCount} FileProviders - it must be exactly one ` +
      '(a second one on another authority cannot serve URIs)'
  )
}
if (sideload && !hasInstallPermission) {
  fail('AndroidManifest.xml is missing REQUEST_INSTALL_PACKAGES after patching')
}
if (!sideload && hasInstallPermission) {
  fail('AndroidManifest.xml still has REQUEST_INSTALL_PACKAGES while the feature is off')
}
note(
  sideload
    ? 'AndroidManifest.xml: downloads + REQUEST_INSTALL_PACKAGES (single FileProvider)'
    : 'AndroidManifest.xml: downloads only (sideload updates disabled)'
)

// --- leftovers from the old separate update provider ---------------------

const legacyPathsPath = path.join(resXmlDir, 'update_file_paths.xml')
if (fs.existsSync(legacyPathsPath)) {
  fs.rmSync(legacyPathsPath)
  note('res/xml/update_file_paths.xml: removed (the template FileProvider covers the cache)')
}

// --- MainActivity (legacy storage prompt for downloads) -------------------

const storageRequest = 'requestLegacyStoragePermissionIfNeeded'
if (fs.existsSync(mainActivityPath)) {
  const current = fs.readFileSync(mainActivityPath, 'utf8')
  if (current.includes(storageRequest)) {
    note(`${mainActivityName}: already requests legacy storage`)
  } else {
    warnings.push(
      `${mainActivityName} exists without ${storageRequest}() - left untouched; ` +
        'Android 10 and below will not be able to save downloads'
    )
  }
} else {
  fs.mkdirSync(path.dirname(mainActivityPath), { recursive: true })
  fs.writeFileSync(
    mainActivityPath,
    [
      `package ${identifier}`,
      '',
      'import android.Manifest',
      'import android.content.pm.PackageManager',
      'import android.os.Build',
      'import android.os.Bundle',
      '',
      'class MainActivity : TauriActivity() {',
      '  override fun onCreate(savedInstanceState: Bundle?) {',
      '    super.onCreate(savedInstanceState)',
      '    requestLegacyStoragePermissionIfNeeded()',
      '  }',
      '',
      '  // Android 10 and below need WRITE_EXTERNAL_STORAGE to save downloads into',
      '  // the public Downloads folder. Android 11+ allows direct-path writes to',
      '  // Download/ without any permission, so no prompt is shown there.',
      `  private fun ${storageRequest}() {`,
      '    if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q &&',
      '      checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED',
      '    ) {',
      '      requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), 1)',
      '    }',
      '  }',
      '}',
      ''
    ].join('\n')
  )
  note(`${mainActivityName}: created with the legacy storage prompt`)
}

console.log(
  sideload
    ? `[patch-android] done - sideload updates ON ("${SIDELOAD_FEATURE}" in default features)`
    : `[patch-android] done - sideload updates OFF ("${SIDELOAD_FEATURE}" not in default features)`
)
for (const warning of warnings) console.warn(`[patch-android] warning: ${warning}`)