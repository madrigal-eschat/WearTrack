# Settings Version Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show independently sourced frontend and backend build metadata in a quiet Version footer on Settings.

**Architecture:** Docker accepts shared `APP_VERSION` and `COMMIT_HASH` arguments. Vite embeds those values in the frontend bundle, while the production image exposes them to the backend at runtime. Settings reads its frontend metadata locally and fetches backend metadata through the existing `/api/version` endpoint, allowing the backend line to change before a stale frontend is refreshed.

**Tech Stack:** Docker, GitHub Actions, Hono, TypeScript, Vue 3, Vite, Vitest, Playwright.

---

## Files and responsibilities

- Modify `Dockerfile`: declare shared build arguments, inject them into the frontend build, and expose them to the backend runtime.
- Modify `.github/workflows/ci.yml`: pass commit metadata to the CI image build.
- Modify `.github/workflows/release.yml`: pass release version and commit metadata to release image builds.
- Modify `src/backend/src/server.ts`: return normalized version and commit fields from `/api/version`.
- Modify `src/backend/tests/version.test.ts`: cover both response fields and fallback normalization.
- Modify `src/frontend/src/vite-env.d.ts`: type the Vite build metadata.
- Modify `src/frontend/src/composables/useVersionCheck.ts`: add typed backend metadata fetching while preserving commit polling behavior.
- Modify `src/frontend/src/composables/useVersionCheck.test.ts`: test metadata parsing and failure behavior.
- Modify `src/frontend/src/views/Settings.vue`: render the footer and backend loading state.
- Modify `src/frontend/tests/e2e/settings.spec.ts`: assert frontend and backend version lines in the built app.
- Create `src/frontend/src/utils/buildVersion.ts`: expose normalized build-time frontend metadata.

### Task 1: Extend Docker and CI metadata flow

**Files:** `Dockerfile`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`

- [ ] Add `ARG APP_VERSION=unknown` and `ARG COMMIT_HASH=unknown` before the frontend stage’s build command.
- [ ] Set `VITE_APP_VERSION` and `VITE_COMMIT_HASH` from those args in the frontend build stage before `npm run build`.
- [ ] Declare the same args in the backend/production stages and set runtime `ENV APP_VERSION` and `ENV COMMIT_HASH`.
- [ ] Pass `--build-arg APP_VERSION=unknown --build-arg COMMIT_HASH="${GITHUB_SHA}"` in CI’s native Docker build.
- [ ] Pass `--build-arg APP_VERSION="${VERSION}" --build-arg COMMIT_HASH="${GITHUB_SHA}"` in the release Docker build.
- [ ] Run `docker buildx build --platform linux/amd64 --load -t weartrack:metadata-test --build-arg APP_VERSION=1.2.5 --build-arg COMMIT_HASH=abcd1234 .` and verify the image builds.
- [ ] Commit with `build: inject app metadata into images`.

### Task 2: Return backend build metadata

**Files:** `src/backend/src/server.ts`, `src/backend/tests/version.test.ts`

- [ ] Change `/api/version` to read `APP_VERSION` and `COMMIT_HASH`, normalizing unset or blank values with `value?.trim() || 'unknown'`.
- [ ] Return `{ version, commit }` while preserving the endpoint’s status and route.
- [ ] Update tests to set and restore both environment variables, assert the two-field success response, and assert `unknown` for each unset/blank field.
- [ ] Run `npm --prefix src/backend run test:ci -- tests/version.test.ts` and expect all version tests to pass.
- [ ] Commit with `feat: expose backend build metadata`.

### Task 3: Embed and type frontend build metadata

**Files:** `src/frontend/src/vite-env.d.ts`, `src/frontend/src/utils/buildVersion.ts`, `src/frontend/src/composables/useVersionCheck.test.ts`

- [ ] Extend `ImportMetaEnv` with `readonly VITE_APP_VERSION?: string` and `readonly VITE_COMMIT_HASH?: string`.
- [ ] Create `buildVersion.ts` exporting:
  ```ts
  export type BuildVersion = { version: string; commit: string }
  export const frontendBuildVersion: BuildVersion = {
    version: import.meta.env.VITE_APP_VERSION?.trim() || 'unknown',
    commit: import.meta.env.VITE_COMMIT_HASH?.trim() || 'unknown',
  }
  ```
- [ ] Add tests that stub the Vite env values where supported by the existing Vitest setup, or test a pure normalization helper exported from the same module if direct `import.meta.env` mutation is unavailable.
- [ ] Run the frontend targeted unit test and TypeScript build check.
- [ ] Commit with `feat: embed frontend build metadata`.

### Task 4: Fetch backend metadata without breaking version polling

**Files:** `src/frontend/src/composables/useVersionCheck.ts`, `src/frontend/src/composables/useVersionCheck.test.ts`

- [ ] Add `BackendVersion` and `fetchBackendVersion(): Promise<BackendVersion | null>`, using `apiFetch('/api/version')`, returning `null` for non-OK responses, network errors, or malformed/missing string fields.
- [ ] Keep `fetchVersion()` as a compatibility wrapper that returns only `fetchBackendVersion()?.commit`, so the existing refresh polling continues comparing backend commits.
- [ ] Add tests for successful `{ version, commit }`, non-OK response, network error, and malformed metadata while retaining the existing request assertion.
- [ ] Run `npm --prefix src/frontend run test:ci -- src/composables/useVersionCheck.test.ts` and expect all tests to pass.
- [ ] Commit with `feat: fetch backend version metadata`.

### Task 5: Render the Settings version footer

**Files:** `src/frontend/src/views/Settings.vue`

- [ ] Import `frontendBuildVersion`, `onMounted`, and `fetchBackendVersion`.
- [ ] Add reactive backend metadata and a `backendVersionUnavailable` state.
- [ ] Fetch backend metadata on mount; keep Settings content visible when the request fails.
- [ ] Add a centered, subdued footer below the existing controls with:
  ```text
  Version:
  Frontend {version} ({commit})
  Backend {version} ({commit})
  ```
  and use `Backend version unavailable` for a failed request.
- [ ] Run frontend lint and unit tests.
- [ ] Commit with `feat: display frontend and backend versions in settings`.

### Task 6: Verify the built image and update end-to-end coverage

**Files:** `src/frontend/tests/e2e/settings.spec.ts`

- [ ] Update the test setup/build invocation or test expectations so the image is built with known `APP_VERSION=1.2.5` and `COMMIT_HASH=abcd1234`.
- [ ] Add an E2E test that opens Settings and asserts `Frontend 1.2.5 (abcd1234)` and `Backend 1.2.5 (abcd1234)`.
- [ ] Run `npm --prefix src/frontend run test:e2e -- tests/e2e/settings.spec.ts` against the built image.
- [ ] Run `npm run lint && npm run build && npm --prefix src/backend run test:ci && npm --prefix src/frontend run test:ci`.
- [ ] Commit with `test: cover settings version display`.

### Task 7: Review documentation and final diff

- [ ] Confirm `docs/superpowers/specs/2026-09-22-settings-version-display-design.md` matches the implementation, especially shared build args and stale-frontend behavior.
- [ ] Run `git diff --check` and inspect `git diff main...HEAD`.
- [ ] Commit any directly related documentation correction separately with `docs: clarify settings version metadata`.
