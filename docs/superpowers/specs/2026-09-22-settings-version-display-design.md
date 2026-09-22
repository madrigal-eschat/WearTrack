# Settings Version Display Design

**Date:** 2026-09-22  
**Status:** Approved

## Problem

WearTrack's Settings page should identify the versions of the frontend and
backend currently in use. A browser can retain an older frontend bundle while
the backend is updated, so the two values must be sourced independently at
runtime.

## Solution

Use the same Docker build metadata for both application parts:

- `APP_VERSION` contains the release version.
- `COMMIT_HASH` contains the source commit identifier.

The frontend receives these values at Vite build time. The backend receives
them as runtime environment variables and continues to expose its metadata
through `/api/version`.

The Settings page displays a quiet footer:

```text
Version:

Frontend 1.2.5 (abcd1234)
Backend 1.2.6 (bcde2345)
```

Normally both lines match. If the backend is updated while a browser still has
the previous frontend loaded, the backend line reflects the live API while the
frontend line remains the value embedded in the loaded bundle until refresh.

## Architecture

### Docker build metadata

The Dockerfile declares `APP_VERSION` and `COMMIT_HASH` build arguments with
`unknown` defaults. The frontend build stage maps them to Vite-exposed
environment variables. The production image promotes the same arguments to
runtime environment variables for the backend.

CI release image builds pass the release version and commit hash. Other builds
may pass only the commit hash and retain `unknown` for the release version.

### Backend endpoint

`GET /api/version` returns:

```json
{
  "version": "1.2.6",
  "commit": "bcde2345"
}
```

Blank or unset values are normalized to `unknown`. Existing consumers of the
endpoint continue to use the backend commit value for version-change checks.

### Frontend

The frontend exposes its build-time values through a small typed helper or
equivalent composable. Settings renders the frontend metadata from that
embedded value and fetches backend metadata from `/api/version`. A failed
backend request displays `Backend version unavailable`; it does not prevent the
rest of Settings from rendering. Missing frontend build metadata displays
`unknown`.

The footer is non-interactive, visually secondary, and placed below the
existing Settings controls.

## Testing

- Backend endpoint tests verify both metadata fields and `unknown` fallbacks
  for unset and blank environment variables.
- Frontend unit tests verify parsing/display of build-time frontend metadata,
  successful backend metadata loading, and backend request failure handling.
- Settings E2E coverage verifies both version lines in a built image with
  supplied metadata.
- Run the targeted backend/frontend tests, lint, and build checks.

## Out of scope

- Independent frontend and backend version arguments.
- Persisting version metadata in the application database.
- Adding a separate About route or interactive version controls.
