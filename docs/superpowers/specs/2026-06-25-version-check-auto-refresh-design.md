# Version Check & Auto-Refresh Design

**Date:** 2026-06-25

## Problem

The app is a PWA that users leave open in browser tabs for long periods. When a new version is deployed, existing open tabs continue running stale code. The service worker's `autoUpdate` mechanism tries to reload the page when a new SW takes control, but browsers suppress or defer that reload for background/suspended tabs — especially on mobile. Users return to a tab running old code with no indication an update is available.

## Solution

Expose the deployed commit hash via a backend endpoint. The frontend periodically polls this endpoint when the tab is active and checks it on tab foreground. If the version has changed since page load, set a flag. On the next nav tab switch (Home / Items / Stats / Settings), reload the page.

---

## Backend

### `GET /api/version`

Added directly in `server.ts` alongside the existing `/api/health` route.

**Response:**
```json
{ "version": "abc1234" }
```

- Returns `process.env.COMMIT_HASH || 'unknown'`
- `COMMIT_HASH` is injected at deploy time via `docker run -e` or k8s env — not baked into the Dockerfile
- No new controller file; it is as simple as the health check

---

## Frontend

### `useVersionCheck` composable (`src/frontend/src/composables/useVersionCheck.ts`)

**Behaviour:**

- **Dev mode** (`import.meta.env.DEV`): early return, entire composable no-ops. Vite HMR handles hot reloads in dev.
- **On mount:**
  - Fetch `/api/version` and store result as `initialVersion`.
  - If the tab is already visible (`document.visibilityState === 'visible'`), start the polling interval immediately.
- **`visibilitychange` → visible:** fetch version + start a 30s `setInterval` that also fetches.
- **`visibilitychange` → hidden:** clear the interval.
- **Each fetch:** compare result to `initialVersion`. If different, set `needsRefresh = true`. Once true it stays true — no reason to unset it.
- **Fetch errors:** swallowed silently. No crash, no log noise. Try again next cycle.
- **`onUnmounted`:** clear interval and remove `visibilitychange` listener.

**Returns:** `{ needsRefresh: Ref<boolean> }`

### `App.vue` changes

- Call `useVersionCheck()`, destructure `needsRefresh`.
- Extract a `navigate(path: string)` helper and an `openSettings()` helper that each check `needsRefresh` before acting:
  - If `needsRefresh.value` is true → `window.location.reload()` and return.
  - Otherwise → proceed (router push or open settings drawer).
- Replace the inline `@click` expressions on the four `k-tabbar-link` elements with calls to these helpers.

---

## What is not in scope

- No UI prompt / "update available" banner — silent reload is sufficient.
- No persistence of `initialVersion` to `localStorage` — comparing against the version at page load is enough.
- No changes to the Dockerfile or CI pipeline beyond documenting that `COMMIT_HASH` must be set at runtime.
