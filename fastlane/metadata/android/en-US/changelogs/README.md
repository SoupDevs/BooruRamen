Google Play "What's new" text, one file per release: `<versionCode>.txt`
(versionCode = major × 1000000 + minor × 1000 + patch, so v0.19.0 is
`19000.txt`), at most 500 characters. Optional: when a release has no file
here, the "Google Play: Upload" workflow writes one from the titles of the
pull requests in its GitHub release.
