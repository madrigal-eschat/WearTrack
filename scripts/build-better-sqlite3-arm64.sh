#!/usr/bin/env bash
# Compile better-sqlite3 for linux/arm64 and publish to GitLab Package Registry.
# Idempotent: exits immediately if the prebuilt for this version already exists.
# Intended to run in the `better-sqlite3-arm64-prebuilt` CI job on an arm64 runner.
set -euo pipefail

if [ "$(uname -m)" != "aarch64" ]; then
  echo "This script must run on an arm64 host. Got: $(uname -m)"
  exit 1
fi

# Install build tools (node:bookworm may lack them depending on variant)
if apt-get update -qq; then
  apt-get install -y --no-install-recommends python3 make g++ 2>/dev/null || true
fi

# node-gyp is a devDependency of better-sqlite3 and won't be installed by
# `npm ci` (production-only). Install it globally so it's on PATH.
npm install -g node-gyp

# Install backend deps (no native builds yet — we do that manually below)
npm --prefix src/backend ci --ignore-scripts

VERSION=$(node -e "console.log(require('./src/backend/node_modules/better-sqlite3/package.json').version)")

# Compute the NAPI version that `prebuild-install -r napi` would look for.
# It uses napi-build-utils.getBestNapiBuildVersion() which reads binary.napi_versions
# from the package and picks the highest version the current runtime supports.
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

echo "Target: ${PACKAGE_NAME}"

# Check if already published — skip if so (idempotent)
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --header "JOB-TOKEN: ${CI_JOB_TOKEN}" \
  "${REGISTRY_URL}")

if [ "${HTTP_STATUS}" = "200" ]; then
  echo "Prebuilt already in registry, nothing to do."
  exit 0
fi

echo "Building better-sqlite3 v${VERSION} napi-v${NAPI_VERSION} for linux-arm64..."

cd src/backend/node_modules/better-sqlite3
node-gyp rebuild --release

# Verify the compiled binary exists
if [ ! -f build/Release/better_sqlite3.node ]; then
  echo "ERROR: build/Release/better_sqlite3.node not found after compilation"
  exit 1
fi

# Package in the same layout that the GitHub release tarballs use —
# prebuild-install extracts relative to the package root, so this places
# the binary at node_modules/better-sqlite3/build/Release/better_sqlite3.node
TARBALL="/tmp/${PACKAGE_NAME}"
tar -czf "${TARBALL}" build/Release/better_sqlite3.node

# Publish to GitLab Package Registry
curl --fail \
  --header "JOB-TOKEN: ${CI_JOB_TOKEN}" \
  --upload-file "${TARBALL}" \
  "${REGISTRY_URL}"

echo "Published ${PACKAGE_NAME}"
