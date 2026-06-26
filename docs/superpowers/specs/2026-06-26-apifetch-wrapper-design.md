# apiFetch Wrapper Design

**Date:** 2026-06-26

## Problem

The app is served behind an authentication proxy. When the proxy session expires, API requests return 401 or 403. The frontend currently ignores these status codes, leaving the user on a broken page instead of being redirected to the proxy login flow.

## Solution

A shared `apiFetch` wrapper around `fetch` that detects 401/403 responses and calls `window.location.reload()`. The reload sends the browser back to the proxy, which redirects to login.

## Architecture

### `src/utils/apiFetch.ts`

Drop-in replacement for `fetch` with an identical call signature:

```ts
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
```

Behaviour:
- Calls the native `fetch`
- If the response status is 401 or 403, calls `window.location.reload()` and throws an error
- Otherwise returns the response unchanged

The throw after reload ensures composables fail fast and do not attempt to parse an auth error body as JSON. The browser will abandon in-flight requests when the reload fires, so multiple simultaneous 401s do not cause multiple reloads.

### Composable changes

Replace `fetch(` with `apiFetch(` in:
- `src/composables/useItems.ts`
- `src/composables/useCategories.ts`
- `src/composables/useWear.ts`
- `src/composables/useCalendar.ts`
- `src/composables/useStats.ts`
- `src/composables/useNotifications.ts`
- `src/composables/useVersionCheck.ts`

No other changes to composables are required — error handling already exists for non-ok responses.

### Project skill

A Claude Code project skill added to `.claude/skills/frontend-api-requests.md` instructing that all frontend HTTP requests must use `apiFetch` from `src/utils/apiFetch.ts` instead of calling `fetch` directly.

## Testing

Unit test at `src/utils/apiFetch.test.ts`:
- 401 response → `reload()` called, error thrown
- 403 response → `reload()` called, error thrown
- 200 response → `reload()` not called, response returned
- 500 response → `reload()` not called, response returned

Update `useVersionCheck.test.ts` to import `apiFetch` mock instead of global `fetch` (since `useVersionCheck` will now use `apiFetch`).

Update `useCalendar.test.ts` similarly.

## Out of scope

- Debouncing (browser handles this via reload)
- Custom redirect URL (proxy handles the redirect)
- Retry logic
