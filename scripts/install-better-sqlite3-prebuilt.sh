#!/usr/bin/env bash
# Download the arm64 better-sqlite3 prebuilt from the GitLab Package Registry
# and place it where prebuild-install will find it as a local prebuilt.
#
# Must be called AFTER `npm --prefix src/backend ci --ignore-scripts` so that
# better-sqlite3's package.json is available in node_modules.
# Exits 0 in all failure cases — the caller falls back to compilation.
set -euo pipefail

if [ "$(uname -m)" != "aarch64" ]; then
  echo "Not arm64 — skipping prebuilt install."
  exit 0
fi

if [ -z "${CI_JOB_TOKEN:-}" ]; then
  echo "CI_JOB_TOKEN not set — skipping prebuilt install (local dev)."
  exit 0
fi

VERSION=$(node -e "console.log(require('./src/backend/node_modules/better-sqlite3/package.json').version)")

# Must match the version computed by build-better-sqlite3-arm64.sh
NAPI_VERSION=$(node -e "
const pkg = require('./src/backend/node_modules/better-sqlite3/package.json');
const versions = pkg.binary && pkg.binary.napi_versions;
const rn = parseInt(process.versions.napi);
if (versions && versions.length) {
  const best = versions.filter(function(v){ return v <= rn; }).sort(function(a,b){ return b-a; })[0];
  console.log(best);
} else {
  console.log(rn);
}
")

PACKAGE_NAME="better-sqlite3-v${VERSION}-napi-v${NAPI_VERSION}-linux-arm64.tar.gz"
REGISTRY_URL="${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/packages/generic/better-sqlite3-prebuilt/${VERSION}/${PACKAGE_NAME}"

# prebuild-install checks `prebuilds/<tarball-basename>` relative to the package
# directory before attempting any download or compilation (see prebuild-install
# download.js: localPrebuild()). Placing the tarball there causes it to use our
# prebuilt instead of falling through to `node-gyp rebuild`.
TARGET_DIR="src/backend/node_modules/better-sqlite3/prebuilds"
mkdir -p "${TARGET_DIR}"

echo "Downloading ${PACKAGE_NAME} from registry..."

HTTP_STATUS=$(curl -s -o "${TARGET_DIR}/${PACKAGE_NAME}" -w "%{http_code}" \
  --header "JOB-TOKEN: ${CI_JOB_TOKEN}" \
  "${REGISTRY_URL}")

if [ "${HTTP_STATUS}" != "200" ]; then
  rm -f "${TARGET_DIR}/${PACKAGE_NAME}"
  echo "Prebuilt not in registry (HTTP ${HTTP_STATUS}) — will compile from source."
  exit 0
fi

echo "Prebuilt downloaded. prebuild-install will use it when npm rebuild runs."
