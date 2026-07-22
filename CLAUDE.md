# weartrack

## Frontend HTTP requests

All frontend API calls must use `apiFetch` from `src/frontend/src/utils/apiFetch.ts` instead of calling `fetch` directly. This wrapper detects 401/403 responses from the authentication proxy and refreshes the page so the user is redirected to login.

## Vue component size

`vue/max-lines-per-block` fails the build at 200 template lines — that's a hard cap, not a target. Start considering extracting a sub-component once a `<template>` block passes **100** lines. Extract when either is true:

- There's an obvious, easily-named cohesive group (e.g. a set of risk-band rows → `<RiskBands>`).
- There's a large, near-symmetric `v-if`/`v-else` pair (both branches substantial).

This is a judgment call for the author/reviewer — ESLint only enforces the 200-line hard cap.
