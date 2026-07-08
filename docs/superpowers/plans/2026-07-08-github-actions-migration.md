# GitHub Actions Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-07-08-github-actions-migration-design.md`:
replace GitLab CI with GitHub Actions (`ci.yml` + `release.yml`), remove
Kubernetes manifests from this repo, and cut over the `github` remote to be
primary.

**Architecture:** Two workflow files under `.github/workflows/`. `ci.yml`
runs on every push/PR: pre-commit, commitlint, lint+test, a single
multi-platform Docker build with native-arch e2e (pushing a debug image to
GHCR on non-main branches only), semgrep, CodeQL, dependency-review.
`release.yml` runs after `ci.yml` succeeds on `main`: semantic-release, then
(if a version was cut) a real multi-platform build pushed to GHCR with
semver/`latest` tags. Config files (commitlint, `.releaserc.json`, root
`package.json`) support these. `k8s/` and all GitLab-CI-only scripts are
deleted; `.gitlab-ci.yml` is deleted last, once the GitHub workflows are
verified green on a real PR.

**Tech Stack:** GitHub Actions, Node 24, Docker (`docker build
--platform ... --platform ...`, containerd image store), semantic-release,
commitlint, pre-commit, semgrep, CodeQL.

## Global Constraints

- GitHub repo: `madrigal-eschat/weartrack`, remote already configured as
  `github` (`git@github-sph:madrigal-eschat/weartrack.git`). Full cutover —
  GitHub becomes primary, GitLab CI is decommissioned by deleting
  `.gitlab-ci.yml`.
- GHCR image: `ghcr.io/madrigal-eschat/weartrack`, public.
- `ci.yml` builds and tests `linux/amd64` only, on every branch. **Amended
  during Task 6 implementation:** the original design called for
  multi-platform (`linux/amd64` + `linux/arm64`) builds on every branch via
  one `docker build --platform ... --platform ...` command. Two problems
  surfaced against real GitHub-hosted runners: (1) that command doesn't
  actually load a multi-platform image locally there (no containerd image
  store) — worked around with a buildx-cache-fallback pattern; (2)
  `better-sqlite3`'s native module requires a from-source QEMU-emulated
  compile for `arm64`, costing ~20-30 minutes per run, which was judged too
  expensive to pay on every branch push. Accepted resolution (human
  decision): `ci.yml` stays `linux/amd64`-only; `linux/arm64` is only built
  (and thus first verified) in `release.yml`, at actual release time.
- Non-`main`/non-tag branches: push the just-built debug image to GHCR under
  a branch-name tag, **before** running e2e, so a failing e2e run never
  blocks the push.
- `main`/tags: `ci.yml` never pushes to GHCR. Only `release.yml`, gated on
  semantic-release + `ci.yml` having fully succeeded, publishes real
  (semver/`latest`) tags.
- Node version: 24 everywhere (matches the Docker image), no version
  matrix.
- Renovate stays (not Dependabot); its `.gitlab-ci.yml`-specific
  `customManagers` entries are dropped.
- commitlint lints every individual commit, not just PR titles.

---

### Task 1: Repo config files (commitlint, semantic-release, renovate, root package.json)

**Files:**
- Create: `commitlint.config.js`
- Create: `.releaserc.json`
- Modify: `renovate.json`
- Modify: `package.json`

**Interfaces:**
- Produces: root `devDependencies` now include `semantic-release` and its
  plugins, `commitlint`, `@commitlint/config-conventional` — consumed by
  Task 2 (`ci.yml`'s commitlint job) and Task 4 (`release.yml`).
- Produces: root `"lint"` script now lints both workspaces — consumed by
  Task 2's `lint-and-test` job.

- [ ] **Step 1: Create `commitlint.config.js`**

```js
export default {
  extends: ['@commitlint/config-conventional'],
};
```

- [ ] **Step 2: Create `.releaserc.json`**

```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/changelog",
      {
        "changelogFile": "CHANGELOG.md"
      }
    ],
    [
      "@semantic-release/npm",
      {
        "npmPublish": false
      }
    ],
    [
      "@semantic-release/git",
      {
        "assets": ["package.json", "package-lock.json", "CHANGELOG.md"],
        "message": "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}"
      }
    ],
    "@semantic-release/github"
  ]
}
```

(`npmPublish: false` — this isn't an npm package, `@semantic-release/npm` is
used only for its `package.json` version-bumping behavior.)

- [ ] **Step 3: Update `renovate.json`**

Remove the two `customManagers` entries that regex-match `.gitlab-ci.yml`
(both `matchStrings` reference `\.gitlab-ci\.ya?ml$`). Change:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "config:recommended",
    ":dependencyDashboard"
  ],
  "ignorePresets": ["docker:pinDigests"],
  "platformAutomerge": true,
  "automerge": true,
  "assignees": [
    "madrigal"
  ],
  "labels": [
    "dependencies"
  ],
  "commitHourlyLimit": 2,
  "prConcurrentLimit": 4,
  "customManagers": [
    {
      "customType": "regex",
      "managerFilePatterns": [
        "/\\.gitlab-ci\\.ya?ml$/"
      ],
      "matchStrings": [
        "\\s?_IMAGE:\\s['\"]?(?:(?<registryUrls>.*?)\\/)?(?<depName>[^:'\"\\s\\/]+):(?<currentValue>[^'\"\\s]*)['\"]?"
      ],
      "datasourceTemplate": "docker"
    },
    {
      "customType": "regex",
      "managerFilePatterns": [
        "/\\.gitlab-ci\\.ya?ml$/"
      ],
      "matchStrings": [
        "\\s?image:\\s['\"]?(?:(?<registryUrls>.*?)\\/)?(?<depName>[^:'\"\\s\\/]+):(?<currentValue>[^'\"\\s]*)['\"]?"
      ],
      "datasourceTemplate": "docker"
    }
  ]
}
```

to:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "config:recommended",
    ":dependencyDashboard"
  ],
  "ignorePresets": ["docker:pinDigests"],
  "platformAutomerge": true,
  "automerge": true,
  "assignees": [
    "madrigal"
  ],
  "labels": [
    "dependencies"
  ],
  "commitHourlyLimit": 2,
  "prConcurrentLimit": 4
}
```

- [ ] **Step 4: Update root `package.json`**

Change:

```json
{
  "name": "weartrack",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "postinstall": "bash scripts/npm-postinstall.sh",
    "dev": "npm run dev --prefix src/backend",
    "dev:frontend": "npm run dev --prefix src/frontend",
    "build": "npm --prefix src/frontend run build && npm --prefix src/backend run build",
    "lint": "npm --prefix src/backend run lint",
    "test:ci": "npm run lint && npm run build && npm --prefix src/backend run test:ci && npm --prefix src/frontend run test:ci && sh -c 'if [ \"$RUN_E2E\" = \"1\" ]; then npm run e2e; fi'",
    "e2e": "npm --prefix src/frontend run test:e2e"
  }
}
```

to:

```json
{
  "name": "weartrack",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "postinstall": "bash scripts/npm-postinstall.sh",
    "dev": "npm run dev --prefix src/backend",
    "dev:frontend": "npm run dev --prefix src/frontend",
    "build": "npm --prefix src/frontend run build && npm --prefix src/backend run build",
    "lint": "npm --prefix src/backend run lint && npm --prefix src/frontend run lint",
    "test:ci": "npm run lint && npm run build && npm --prefix src/backend run test:ci && npm --prefix src/frontend run test:ci && sh -c 'if [ \"$RUN_E2E\" = \"1\" ]; then npm run e2e; fi'",
    "e2e": "npm --prefix src/frontend run test:e2e"
  },
  "devDependencies": {
    "@commitlint/cli": "^19.5.0",
    "@commitlint/config-conventional": "^19.5.0",
    "semantic-release": "^24.2.0",
    "@semantic-release/changelog": "^6.0.3",
    "@semantic-release/git": "^10.0.1",
    "@semantic-release/github": "^11.0.1",
    "@semantic-release/npm": "^12.0.1"
  }
}
```

- [ ] **Step 5: Install to regenerate the lockfile**

Run: `npm install`
Expected: `package-lock.json` at repo root updates to include the new
devDependencies and their transitive deps (previously an empty lockfile —
root had no real deps before this).

- [ ] **Step 6: Verify commitlint works locally**

Run: `echo "not a conventional commit" | npx commitlint`
Expected: FAILS with a rule violation (e.g. `subject may not be empty` /
`type may not be empty` depending on exact input — confirms the config
loads and rules apply).

Run: `echo "feat: test message" | npx commitlint`
Expected: PASSES (no output, exit code 0).

- [ ] **Step 7: Commit**

```bash
git add commitlint.config.js .releaserc.json renovate.json package.json package-lock.json
git commit -m "chore: add commitlint, semantic-release, and renovate config for GitHub"
```

---

### Task 2: `ci.yml` — pre-commit, commitlint, lint-and-test, semgrep, CodeQL, dependency-review

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root `package.json` scripts/devDeps (Task 1).
- Produces: a `docker-build-and-e2e` job placeholder in the same file that
  Task 3 replaces — this task writes every OTHER job in `ci.yml` plus a
  minimal working `docker-build-and-e2e` (native build + e2e only, no
  push/branch logic yet) so the workflow is valid and runnable after this
  task; Task 3 then adds the push/branch-tagging behavior on top.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
  pull_request:

permissions:
  contents: read
  packages: write
  security-events: write

jobs:
  pre-commit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - uses: pre-commit/action@v3.0.1

  commitlint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - uses: wagoid/commitlint-github-action@v6

  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm --prefix src/backend run test:ci
      - run: npm --prefix src/frontend run test:ci

  docker-build-and-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build multi-platform image
        run: docker build --platform linux/amd64 --platform linux/arm64 -t weartrack:ci .
      - name: Start native image for e2e
        run: |
          docker run -d --name weartrack-e2e --platform linux/amd64 \
            -p 3000:3000 -e E2E_TEST=1 weartrack:ci
          for i in $(seq 1 30); do
            curl -sf http://localhost:3000/api/health && break
            sleep 1
          done
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm --prefix src/frontend ci
      - run: npx --prefix src/frontend playwright install --with-deps chromium webkit
      - name: Run Playwright against the built image
        working-directory: src/frontend
        env:
          BASE_URL: http://localhost:3000
        run: npx playwright test
      - name: Stop container
        if: always()
        run: docker rm -f weartrack-e2e || true

  semgrep:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: semgrep/semgrep-action@v1
        with:
          config: auto

  codeql:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/analyze@v3

  dependency-review:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
```

- [ ] **Step 2: Verify the workflow YAML is syntactically valid**

Run: `npx --yes yaml-lint .github/workflows/ci.yml 2>&1 || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))" `
Expected: no parse errors. (Real semantic verification — do the jobs
actually run and pass on GitHub — happens in Task 6, once this is pushed;
YAML syntax is the only thing checkable locally.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions CI workflow"
```

---

### Task 3: `docker-build-and-e2e` — branch-conditional GHCR push

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the `docker-build-and-e2e` job from Task 2.
- Produces: the same job, now pushing a debug image to GHCR on non-main/
  non-tag branches, before e2e runs.

- [ ] **Step 1: Add the conditional push step**

In `.github/workflows/ci.yml`, change the `docker-build-and-e2e` job from:

```yaml
  docker-build-and-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build multi-platform image
        run: docker build --platform linux/amd64 --platform linux/arm64 -t weartrack:ci .
      - name: Start native image for e2e
        run: |
          docker run -d --name weartrack-e2e --platform linux/amd64 \
            -p 3000:3000 -e E2E_TEST=1 weartrack:ci
          for i in $(seq 1 30); do
            curl -sf http://localhost:3000/api/health && break
            sleep 1
          done
```

to:

```yaml
  docker-build-and-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build multi-platform image
        run: docker build --platform linux/amd64 --platform linux/arm64 -t weartrack:ci .
      - name: Push debug image to GHCR (non-main branches only)
        if: github.ref != 'refs/heads/main' && !startsWith(github.ref, 'refs/tags/')
        run: |
          echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u "${{ github.actor }}" --password-stdin
          BRANCH_TAG=$(echo "${{ github.ref_name }}" | tr -c 'a-zA-Z0-9._-' '-')
          docker tag weartrack:ci "ghcr.io/${{ github.repository }}:${BRANCH_TAG}"
          docker push "ghcr.io/${{ github.repository }}:${BRANCH_TAG}"
      - name: Start native image for e2e
        run: |
          docker run -d --name weartrack-e2e --platform linux/amd64 \
            -p 3000:3000 -e E2E_TEST=1 weartrack:ci
          for i in $(seq 1 30); do
            curl -sf http://localhost:3000/api/health && break
            sleep 1
          done
```

(The push step runs before the e2e-run step and has no `needs`/dependency
on it, so a later e2e failure doesn't affect whether the push already
happened. `tr -c 'a-zA-Z0-9._-' '-'` sanitizes branch names like
`feature/foo` into valid Docker tag characters, e.g. `feature-foo`.)

- [ ] **Step 2: Verify YAML validity**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: push debug image to GHCR on non-main branches, independent of e2e result"
```

---

### Task 4: `release.yml`

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `.releaserc.json`, root `package.json` devDeps (Task 1).

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  workflow_run:
    workflows: ["CI"]
    types:
      - completed
    branches:
      - main

permissions:
  contents: write
  packages: write
  issues: write
  pull-requests: write

jobs:
  release:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    outputs:
      released: ${{ steps.semrel.outputs.released }}
      version: ${{ steps.semrel.outputs.version }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - id: semrel
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          npx semantic-release
          if git describe --tags --exact-match HEAD > /dev/null 2>&1; then
            echo "released=true" >> "$GITHUB_OUTPUT"
            echo "version=$(git describe --tags --exact-match HEAD | sed 's/^v//')" >> "$GITHUB_OUTPUT"
          else
            echo "released=false" >> "$GITHUB_OUTPUT"
          fi

  publish-image:
    needs: release
    if: needs.release.outputs.released == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main
      - name: Build multi-platform image
        run: docker build --platform linux/amd64 --platform linux/arm64 -t weartrack:release .
      - name: Push release tags to GHCR
        env:
          VERSION: ${{ needs.release.outputs.version }}
        run: |
          echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u "${{ github.actor }}" --password-stdin
          IMAGE="ghcr.io/${{ github.repository }}"
          MAJOR="${VERSION%%.*}"
          MINOR="${VERSION%.*}"
          docker tag weartrack:release "${IMAGE}:${VERSION}"
          docker tag weartrack:release "${IMAGE}:latest"
          docker tag weartrack:release "${IMAGE}:${MAJOR}"
          docker tag weartrack:release "${IMAGE}:${MINOR}"
          docker push "${IMAGE}:${VERSION}"
          docker push "${IMAGE}:latest"
          docker push "${IMAGE}:${MAJOR}"
          docker push "${IMAGE}:${MINOR}"
```

(`@semantic-release/git` commits the version bump back with `[skip ci]` in
the message, so that commit doesn't re-trigger `ci.yml`/this workflow in a
loop. `workflow_run` is used — rather than a plain `push: branches: [main]`
trigger — specifically so this only fires after `ci.yml` has actually
succeeded, satisfying "main should not publish unless tests pass".)

- [ ] **Step 2: Verify YAML validity**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"`
Expected: no errors.

- [ ] **Step 3: Dry-run semantic-release locally**

Run: `npx semantic-release --dry-run --no-ci`
Expected: runs without crashing. Since there's no prior GitHub release yet
on the new repo, it will either propose an initial version (e.g. `1.0.0`)
or report it can't determine one without a remote `main` to compare
against — either outcome is fine here; this step just confirms the plugin
chain loads and executes without a configuration error. If it errors on
plugin resolution or config parsing, fix `.releaserc.json` before
proceeding.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add semantic-release + GHCR publish workflow"
```

---

### Task 5: Manifest and GitLab cleanup

**Files:**
- Delete: `k8s/production/deployment.yaml`
- Delete: `k8s/production/ingress.yaml`
- Delete: `k8s/production/kustomization.yaml`
- Delete: `k8s/production/networkpolicy.yaml`
- Delete: `k8s/production/service.yaml`
- Delete: `k8s/k8s-pre-apply.sh`
- Delete: `k8s/k8s-post-apply.sh`
- Delete: `scripts/build-better-sqlite3-arm64.sh`
- Delete: `scripts/install-better-sqlite3-prebuilt.sh`
- Modify: `scripts/npm-postinstall.sh`
- Modify: `Dockerfile`
- Delete: `.gitlab-ci.yml`

**Interfaces:**
- None — this task removes dead configuration/scripts with no other code
  depending on them (verified in Step 1).

- [ ] **Step 1: Confirm nothing else references the files being deleted**

Run:
```bash
grep -rn "build-better-sqlite3-arm64\|install-better-sqlite3-prebuilt" \
  --include="*.sh" --include="*.yml" --include="*.yaml" --include="*.json" . \
  2>/dev/null | grep -v node_modules | grep -v .git/
```
Expected output: only self-references inside the two scripts being deleted
and the `.gitlab-ci.yml` line being deleted in this same task (e.g.
`scripts/build-better-sqlite3-arm64.sh`, `scripts/install-better-sqlite3-prebuilt.sh`,
`.gitlab-ci.yml`). If anything else shows up, stop and investigate before
deleting.

- [ ] **Step 2: Delete the k8s directory**

```bash
git rm -r k8s/
```

- [ ] **Step 3: Simplify `scripts/npm-postinstall.sh`**

Change:

```bash
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
```

to:

```bash
#!/usr/bin/env bash
# Root postinstall: installs src/backend and src/frontend dependencies.
set -euo pipefail

npm --prefix src/backend ci
npm --prefix src/frontend ci
```

- [ ] **Step 4: Delete the two GitLab-only better-sqlite3 scripts**

```bash
git rm scripts/build-better-sqlite3-arm64.sh scripts/install-better-sqlite3-prebuilt.sh
```

- [ ] **Step 5: Strip the dependency-proxy ARGs from `Dockerfile`**

Change:

```dockerfile
ARG CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX=docker.io
FROM ${CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX}/library/node:24-bookworm AS frontend-build

WORKDIR /frontend

COPY src/frontend/package.json src/frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY src/frontend/ ./
RUN npm run build


ARG CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX=docker.io
FROM ${CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX}/library/node:24-bookworm AS backend-build

WORKDIR /app

COPY src/backend/package.json src/backend/package-lock.json ./
RUN npm ci --omit=dev

COPY src/backend/src ./src
COPY src/backend/tsconfig.json src/backend/tsconfig.build.json ./

RUN npm ci && npm run build


ARG CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX=docker.io
FROM ${CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX}/library/node:24-bookworm-slim AS production
```

to:

```dockerfile
FROM node:24-bookworm AS frontend-build

WORKDIR /frontend

COPY src/frontend/package.json src/frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY src/frontend/ ./
RUN npm run build


FROM node:24-bookworm AS backend-build

WORKDIR /app

COPY src/backend/package.json src/backend/package-lock.json ./
RUN npm ci --omit=dev

COPY src/backend/src ./src
COPY src/backend/tsconfig.json src/backend/tsconfig.build.json ./

RUN npm ci && npm run build


FROM node:24-bookworm-slim AS production
```

(Leave everything below the third `FROM` line — `WORKDIR /app` onward —
unchanged.)

- [ ] **Step 6: Delete `.gitlab-ci.yml`**

```bash
git rm .gitlab-ci.yml
```

- [ ] **Step 7: Verify the Docker build still works locally**

Run: `docker build --platform linux/amd64 -t weartrack:test-cleanup .`
Expected: builds successfully (single-platform smoke test — the full
multi-platform build is exercised for real in `ci.yml`, verified in Task 6).

- [ ] **Step 8: Commit**

```bash
git add scripts/npm-postinstall.sh Dockerfile
git commit -m "chore: remove k8s manifests and GitLab-only CI scripts"
```

---

### Task 6: Push to GitHub, verify workflows, cut over

**Files:**
- None (git/GitHub operations only).

**Interfaces:**
- Consumes: everything from Tasks 1-5.

- [ ] **Step 1: Push `main` to the `github` remote**

Run: `git push github main`
Expected: succeeds — this is the first-ever push to the GitHub repo, so it
becomes the initial `main` there.

- [ ] **Step 2: Push this feature branch and open a PR on GitHub**

Run: `git push github ci/github-actions-migration`

Then open a PR from `ci/github-actions-migration` into `main` on
`madrigal-eschat/weartrack` (via the `mcp__github__create_pull_request`
tool, or `git push` output's suggested URL) titled e.g. `ci: migrate to
GitHub Actions` with a body summarizing the change.

- [ ] **Step 3: Watch the `ci.yml` run on the PR**

Use `mcp__github__actions_list`/`mcp__github__actions_get` (or the PR's
checks UI) to confirm all jobs (`pre-commit`, `commitlint`,
`lint-and-test`, `docker-build-and-e2e`, `semgrep`, `codeql`,
`dependency-review`) complete. If any job fails, read its log via
`mcp__github__get_job_logs`, fix the underlying file in this branch, commit,
push, and re-check — repeat until everything's green.

Specifically confirm: the `docker build --platform linux/amd64 --platform
linux/arm64 ... ` command in `docker-build-and-e2e` actually loads a
multi-platform image locally on the `ubuntu-latest` runner (per the design
spec's noted risk). If it fails with an error like "docker exporter does
not support multiple platforms", replace that job's build step with the
two-invocation fallback from the design spec (native `docker buildx build
--load` for e2e, separate multi-platform `docker buildx build` with
`--cache-from=gha --cache-to=gha` and conditional `--push`) — implement,
commit, push, and re-verify.

- [ ] **Step 4: Confirm the debug image push worked**

Once `docker-build-and-e2e` is green on this branch (a non-`main` branch),
check `https://github.com/madrigal-eschat/weartrack/pkgs/container/weartrack`
(via `mcp__github__get_file_contents` isn't applicable here — check via a
browser or the GHCR web UI, or `mcp__github__actions_get` job logs for the
push step's output) for a tag matching the sanitized branch name
(`ci-github-actions-migration`).

- [ ] **Step 5: Merge the PR on GitHub**

Once every check is green, merge `ci/github-actions-migration` into `main`
on GitHub.

- [ ] **Step 6: Confirm `release.yml` fires and behaves correctly**

After the merge, `ci.yml` runs again on `main`; once it succeeds,
`release.yml` should trigger via `workflow_run`. Watch it via
`mcp__github__actions_list`. Confirm semantic-release either cuts an
initial release (likely `1.0.0`, since there's no prior GitHub release) or
reports no releasable changes — both are valid outcomes depending on the
exact commit history at merge time. If it releases, confirm
`publish-image` runs and the new semver/`latest` tags appear in GHCR.

- [ ] **Step 7: Sync the local `main` branch and clean up**

Run: `git checkout main && git pull github main`
Expected: local `main` now matches the merged GitHub state (including any
`chore(release):` commit semantic-release pushed back).

No further GitLab-side changes — `.gitlab-ci.yml` is already gone from
`main` (deleted in Task 5), which is the full extent of "decommissioning"
GitLab CI per the design spec.
