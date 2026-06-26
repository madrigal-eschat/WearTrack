# Version Check & Auto-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reload the app on the next nav-tab tap whenever a new version has been deployed since the page loaded.

**Architecture:** A backend `/api/version` endpoint returns the running commit hash from a `COMMIT_HASH` env var. A frontend `useVersionCheck` composable polls it when the tab is visible and compares against the version at page load; if it changes, it sets `needsRefresh`. `App.vue` checks `needsRefresh` before each nav-tab click and reloads if set. In dev, the version is always `'unknown'` so `needsRefresh` never becomes true; no special dev guard needed.

**Tech Stack:** Hono (backend), Vue 3 composables + Page Visibility API (frontend), Vitest (both)

## Global Constraints

- Backend runs on Hono (`hono` package), tested via `app.request()` in vitest
- Frontend is Vue 3 with `<script setup>` SFCs; composables follow the pattern in `src/frontend/src/composables/`
- All tests run from their respective package dirs: `cd src/backend && npm run test:ci` / `cd src/frontend && npm run test:ci`
- No new npm dependencies
- `COMMIT_HASH` is injected at deploy time via `docker run -e` or k8s — not baked into the Dockerfile

---

### Task 1: Backend `/api/version` endpoint

**Files:**
- Modify: `src/backend/src/server.ts` (add one route after `/api/health`)
- Test: `src/backend/tests/version.test.ts`

**Interfaces:**
- Produces: `GET /api/version → 200 { version: string }`

- [ ] **Step 1: Write the failing test**

Create `src/backend/tests/version.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import app from '../src/server.js';

describe('GET /api/version', () => {
  const original = process.env.COMMIT_HASH;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.COMMIT_HASH;
    } else {
      process.env.COMMIT_HASH = original;
    }
  });

  it('returns the COMMIT_HASH env var', async () => {
    process.env.COMMIT_HASH = 'abc1234';
    const res = await app.request('/api/version');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 'abc1234' });
  });

  it('returns "unknown" when COMMIT_HASH is not set', async () => {
    delete process.env.COMMIT_HASH;
    const res = await app.request('/api/version');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 'unknown' });
  });

  it('returns "unknown" when COMMIT_HASH is blank', async () => {
    process.env.COMMIT_HASH = '';
    const res = await app.request('/api/version');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 'unknown' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src/backend && npm run test:ci -- --reporter=verbose tests/version.test.ts
```

Expected: FAIL — route not found (404 or similar)

- [ ] **Step 3: Add the route to `server.ts`**

In `src/backend/src/server.ts`, after the `/api/health` route (around line 26):

```typescript
app.get('/api/version', (c) => {
  const version = process.env.COMMIT_HASH || 'unknown';
  return c.json({ version });
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd src/backend && npm run test:ci -- --reporter=verbose tests/version.test.ts
```

Expected: 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/server.ts src/backend/tests/version.test.ts
git commit -m "feat(be): add /api/version endpoint returning COMMIT_HASH"
```

---

### Task 2: `useVersionCheck` composable

**Files:**
- Create: `src/frontend/src/composables/useVersionCheck.ts`
- Test: `src/frontend/src/composables/useVersionCheck.test.ts`

**Interfaces:**
- Consumes: `GET /api/version → { version: string }` (from Task 1)
- Produces:
  - `fetchVersion(): Promise<string | null>` (exported for testing)
  - `useVersionCheck(): { needsRefresh: Ref<boolean> }`

The core fetch logic is extracted as `fetchVersion` so it can be unit tested without a DOM or lifecycle hooks. The composable wires `fetchVersion` into Vue's mount/unmount lifecycle and the Page Visibility API.

**Note on dev behaviour:** In dev, `COMMIT_HASH` is not set so the endpoint always returns `'unknown'`. `initialVersion` is stored as `'unknown'` and every subsequent check also returns `'unknown'`, so `needsRefresh` never becomes true. Vite HMR handles hot reloads in dev. No special dev guard is needed.

- [ ] **Step 1: Write the failing tests**

Create `src/frontend/src/composables/useVersionCheck.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchVersion } from './useVersionCheck.js';

describe('fetchVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the version string on a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 'abc1234' }),
    }));
    expect(await fetchVersion()).toBe('abc1234');
  });

  it('returns null when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchVersion()).toBeNull();
  });

  it('returns null on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    expect(await fetchVersion()).toBeNull();
  });

  it('fetches from /api/version', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 'abc1234' }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await fetchVersion();
    expect(mockFetch).toHaveBeenCalledWith('/api/version');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd src/frontend && npm run test:ci -- --reporter=verbose src/composables/useVersionCheck.test.ts
```

Expected: FAIL — `Cannot find module './useVersionCheck.js'`

- [ ] **Step 3: Implement the composable**

Create `src/frontend/src/composables/useVersionCheck.ts`:

```typescript
import { ref, onMounted, onUnmounted } from 'vue';
import type { Ref } from 'vue';

export async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch('/api/version');
    if (!res.ok) return null;
    const { version } = await res.json() as { version: string };
    return version;
  } catch {
    return null;
  }
}

export function useVersionCheck(): { needsRefresh: Ref<boolean> } {
  const needsRefresh = ref(false);
  let initialVersion: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function check(): Promise<void> {
    const version = await fetchVersion();
    if (version === null) return;
    if (initialVersion === null) {
      initialVersion = version;
    } else if (version !== initialVersion) {
      needsRefresh.value = true;
    }
  }

  function startPolling(): void {
    if (pollTimer !== null) return;
    pollTimer = setInterval(() => { void check(); }, 30_000);
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      void check();
      startPolling();
    } else {
      stopPolling();
    }
  }

  onMounted(() => {
    void check();
    if (document.visibilityState === 'visible') {
      startPolling();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
  });

  onUnmounted(() => {
    stopPolling();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });

  return { needsRefresh };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd src/frontend && npm run test:ci -- --reporter=verbose src/composables/useVersionCheck.test.ts
```

Expected: 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/composables/useVersionCheck.ts src/frontend/src/composables/useVersionCheck.test.ts
git commit -m "feat(fe): add useVersionCheck composable"
```

---

### Task 3: Wire `useVersionCheck` into `App.vue`

**Files:**
- Modify: `src/frontend/src/App.vue`

**Interfaces:**
- Consumes: `useVersionCheck(): { needsRefresh: Ref<boolean> }` (from Task 2)

- [ ] **Step 1: Update `App.vue` `<script setup>`**

Replace the full `<script setup>` block in `src/frontend/src/App.vue` with:

```typescript
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { kApp, kTabbar, kTabbarLink } from 'konsta/vue';
import { HomeIcon, Squares2X2Icon as ItemsIcon, ChartBarIcon, Cog6ToothIcon } from '@heroicons/vue/24/solid';
import Toast from './components/Toast.vue';
import SettingsDrawer from './components/SettingsDrawer.vue';
import { useVersionCheck } from './composables/useVersionCheck.js';

const route = useRoute();
const router = useRouter();
const settingsOpen = ref(false);
const { needsRefresh } = useVersionCheck();

function navigate(path: string): void {
  if (needsRefresh.value) { window.location.reload(); return; }
  void router.push(path);
}

function openSettings(): void {
  if (needsRefresh.value) { window.location.reload(); return; }
  settingsOpen.value = true;
}
```

- [ ] **Step 2: Update the four `@click` handlers in `<template>`**

Change:
```html
@click="router.push('/')"
```
to:
```html
@click="navigate('/')"
```

Change:
```html
@click="router.push('/items')"
```
to:
```html
@click="navigate('/items')"
```

Change:
```html
@click="router.push('/stats')"
```
to:
```html
@click="navigate('/stats')"
```

Change:
```html
@click="settingsOpen = true"
```
to:
```html
@click="openSettings()"
```

- [ ] **Step 3: Run the full frontend test suite**

```bash
cd src/frontend && npm run test:ci
```

Expected: all tests pass (no regressions)

- [ ] **Step 4: Run the full backend test suite**

```bash
cd src/backend && npm run test:ci
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/App.vue
git commit -m "feat(fe): reload on nav tap when new version detected"
```
