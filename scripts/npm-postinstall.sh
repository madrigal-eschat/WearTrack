#!/usr/bin/env bash
# Root postinstall: installs src/backend and src/frontend dependencies.
# On arm64 CI, uses a two-phase approach for better-sqlite3 to avoid
# compilation timeouts: install without scripts, place prebuilt, then rebuild.
set -euo pipefail

if [ "$(uname -m)" = "aarch64" ] && [ -n "${CI_JOB_TOKEN:-}" ]; then
  # Phase 1: extract all packages without running any native build scripts
  npm --prefix src/backend ci --ignore-scripts

  # Phase 2: place prebuilt tarball so prebuild-install finds it locally
  bash scripts/install-better-sqlite3-prebuilt.sh

  # Phase 3: run better-sqlite3's install hook (prebuild-install finds the
  # local tarball and extracts it; node-gyp rebuild is never reached)
  (cd src/backend && npm rebuild better-sqlite3)
else
  # Non-arm64 or local dev: normal install.
  # On amd64 CI, node-gyp compiles quickly enough; locally, developers use
  # their own architecture's prebuild from GitHub.
  npm --prefix src/backend ci
fi

npm --prefix src/frontend ci
