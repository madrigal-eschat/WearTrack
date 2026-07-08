# GitHub Actions Migration — Design Spec

**Date:** 2026-07-08

## Overview

Move CI/CD from GitLab (`.gitlab-ci.yml`, to-be-continuous components) to
GitHub Actions, on a new GitHub repo (`madrigal-eschat/weartrack`, remote
already configured as `github`) that has never been pushed to. Full cutover:
GitLab CI is decommissioned (`.gitlab-ci.yml` deleted), not run alongside.
Kubernetes manifests move out of this repo entirely — deployment becomes a
separate GitOps repo's concern, so `k8s/` is deleted here.

## Workflows

### `ci.yml` — every PR and every push

Jobs, all required:

1. **pre-commit** — `pre-commit/action` running the existing
   `.pre-commit-config.yaml` unchanged (it's already portable: local eslint
   hooks + shellcheck + check-json/check-yaml/detect-private-key). Node 24
   set up first so the eslint hooks' `npm run lint` shells work.
2. **commitlint** — `wagoid/commitlint-github-action`, lints every commit in
   the PR/push range against Conventional Commits.
3. **lint-and-test** — Node 24, `npm ci`, `npm run lint` (fixed to lint both
   workspaces — see Fixes below), `npm run build`, backend `test:ci`,
   frontend `test:ci`.
4. **docker-build-and-e2e** — see dedicated section below.
5. **semgrep** — official Semgrep GitHub Action, `auto` config.
6. **codeql** — `github/codeql-action`, JavaScript/TypeScript queries.
7. **dependency-review** — `actions/dependency-review-action`, PR-only.

#### `docker-build-and-e2e`

One real build per run:

1. `docker build --platform linux/amd64 --platform linux/arm64 -t weartrack:ci .`
   — single command, both platforms, loaded into the local Docker daemon as
   one multi-platform image (relies on the runner's Docker Engine having the
   containerd image store enabled — **verify this works on GitHub-hosted
   `ubuntu-latest` runners during implementation**; if it doesn't, fall back
   to two `buildx build` invocations sharing a `type=gha` cache — one
   native+`--load` for e2e, one multi-platform+conditional-`--push`, so the
   second is a cache-hit re-assembly, not a recompile).
2. Run the **native-platform** variant only as the e2e service container
   (`docker run --platform linux/amd64 ...` or equivalent), with
   `E2E_TEST=1` so `/api/__reset` stays enabled. Run Playwright against it.
   arm64 is never separately tested — assumed equivalent since it's built
   from the same Dockerfile/source.
3. **If ref is not `main` and not a tag:** push `weartrack:ci` (already
   multi-platform, already local) to GHCR under a sanitized branch-name tag
   (e.g. `ghcr.io/madrigal-eschat/weartrack:<branch-name>`). This step runs
   **before** step 2 (e2e), so a failing e2e run never blocks the debug
   image from landing — pushing is unconditional on test outcome for
   non-main branches.
4. **If ref is `main` or a tag:** skip step 3 entirely. No image from
   `ci.yml` ever reaches GHCR for `main` — publishing a real release image
   is `release.yml`'s job, gated on semantic-release + this whole workflow
   passing.

### `release.yml` — after `ci.yml` succeeds on `main`

Triggered via `workflow_run` on `ci.yml` completing with
`conclusion == 'success'` and `head_branch == 'main'`.

1. Run `semantic-release`, reading Conventional Commits since the last
   release to determine the version bump. Plugins:
   `@semantic-release/commit-analyzer`,
   `@semantic-release/release-notes-generator`,
   `@semantic-release/changelog`, `@semantic-release/npm` (bumps
   `package.json`/`package-lock.json`), `@semantic-release/git` (commits
   version + changelog back to `main`), `@semantic-release/github` (creates
   the git tag + GitHub Release).
2. If a new version was released: `docker build --platform linux/amd64
   --platform linux/arm64 -t weartrack:release .` (a second, real build —
   this workflow run is the only place a "trustworthy" published image gets
   built) and push to GHCR tagged with the new semver (e.g. `1.4.0`),
   `latest`, and floating major/minor tags (`1`, `1.4`).
3. If no releasable commits exist, the job exits cleanly with no image push.

## Repo config files

- **`commitlint.config.js`** (new): `{ extends: ['@commitlint/config-conventional'] }`.
- **`.releaserc.json`** (new): plugin list above, `branches: ['main']`.
- **`.pre-commit-config.yaml`**: unchanged.
- **`renovate.json`**: drop the two `customManagers` entries that regex-match
  `.gitlab-ci.yml` image tags (dead once that file is deleted); keep
  everything else (`config:recommended`, automerge settings, assignees,
  labels). Enabled via the Renovate GitHub App on the new repo — no
  workflow file needed for this.
- **`package.json`** (root): add `semantic-release` + its plugins listed
  above, `commitlint`, `@commitlint/config-conventional` as devDependencies.

### Fixes bundled in

- Root `lint` script currently only lints the backend
  (`"lint": "npm --prefix src/backend run lint"`) — the frontend has its own
  working `lint` script that nothing at the root ever calls. Fix:
  `"lint": "npm --prefix src/backend run lint && npm --prefix src/frontend run lint"`.

## Manifest / GitLab cleanup

- Delete `k8s/` entirely: `k8s/production/*.yaml` (`deployment.yaml`,
  `ingress.yaml`, `kustomization.yaml`, `networkpolicy.yaml`,
  `service.yaml`), `k8s/k8s-pre-apply.sh`, `k8s/k8s-post-apply.sh`.
- `Dockerfile`: remove the `CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX` ARG and
  its `${...}` interpolation from all three `FROM` lines — plain
  `node:24-bookworm` / `node:24-bookworm-slim`, no GitLab dependency-proxy
  indirection.
- Delete `scripts/build-better-sqlite3-arm64.sh` (the GitLab
  arm64-runner-prebuilt workaround being dropped, per the "GH-hosted
  runners are fast enough now" decision) — confirm nothing else references
  it before deleting.
- Delete `.gitlab-ci.yml`. This alone decommissions GitLab CI for this repo
  (no separate GitLab-side settings change requested).

## Verification + cutover

1. Implement everything on this branch (`ci/github-actions-migration`).
2. Push the branch to the `github` remote, open a PR there against `main`
   to watch the new workflows run for real (this is the first-ever push to
   the GitHub repo for anything beyond this branch, so `main` itself needs
   pushing too, at least as the PR's base — see below).
3. Once green, merge on GitHub. GitLab repo/CI is left in place but inert
   (`.gitlab-ci.yml` gone from `main` once this merges there too, or the
   GitLab repo can simply stop being pushed to — out of scope to decide
   here beyond "stop being primary").

## Testing

- No new automated tests — this is CI/tooling configuration. Verification
  is: the workflows actually run green on a real PR against the real GitHub
  repo (step 2 above), covering pre-commit, commitlint, lint, unit tests,
  build, the docker/e2e job (including the branch-push behavior), semgrep,
  and CodeQL/dependency-review. `release.yml` gets a dry-run check
  (`semantic-release --dry-run`) as part of implementation verification
  before relying on the real trigger.

## Out of scope

- Any GitLab-side settings/variable/runner cleanup beyond deleting
  `.gitlab-ci.yml`.
- Migrating existing GitLab CI/CD variables (registry credentials, etc.) to
  GitHub — implementation will need to identify and set the GitHub-side
  equivalents (e.g. `GITHUB_TOKEN` for GHCR push is automatic; anything else
  gets flagged during planning).
- Branch protection / required-status-check configuration on the GitHub
  repo — that's a repo settings change, not something committed in this PR.
- Dependabot — Renovate is being kept.
