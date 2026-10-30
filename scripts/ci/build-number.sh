#!/usr/bin/env bash
# Prints the dev build number for a commit. Build numbers are counted within
# one app version: the builds of a release/vX.Y.Z branch run 1, 2, 3, ... and
# the next version starts again at 1. Nothing is stored or committed, so a
# re-run of the same commit always gets the same number.
#
#   build-number.sh [ref]            test build of a release branch (default HEAD)
#   build-number.sh --release [ref]  release build from the merge into master
#
# A test build is numbered by the first-parent commits on its branch since it
# was cut from master (each merged PR is one), plus one for the cut itself.
# A release build is the one after the last test build of the merged branch;
# when the push is not a merge commit it prints nothing (no build line).
# Needs full history (actions/checkout with fetch-depth: 0).
set -euo pipefail

count_since_cut() {
  local tip=$1 base=$2 cut
  cut=$(git merge-base "$base" "$tip")
  git rev-list --count --first-parent "$cut..$tip"
}

if [[ "${1:-}" == "--release" ]]; then
  ref=${2:-HEAD}
  if git rev-parse --verify --quiet "$ref^2" >/dev/null; then
    echo $(( $(count_since_cut "$ref^2" "$ref^1") + 2 ))
  fi
else
  ref=${1:-HEAD}
  base=origin/master
  git rev-parse --verify --quiet "$base" >/dev/null || base=origin/main
  echo $(( $(count_since_cut "$ref" "$base") + 1 ))
fi
