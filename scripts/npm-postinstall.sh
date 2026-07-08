#!/usr/bin/env bash
# Root postinstall: installs src/backend and src/frontend dependencies.
set -euo pipefail

npm --prefix src/backend ci
npm --prefix src/frontend ci
