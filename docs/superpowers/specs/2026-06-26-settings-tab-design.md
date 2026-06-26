# Settings Tab Design

**Date:** 2026-06-26  
**Status:** Approved

## Problem

The Settings entry in the bottom tab bar behaves differently from the other three tabs (Home, Items, Stats). Instead of navigating to a route, it opens a `k-sheet` drawer via a boolean flag in `App.vue`. This feels inconsistent to the user and adds special-casing in the codebase.

## Solution

Convert Settings into a proper route (`/settings`) with a dedicated view component, identical in structure to the other three tabs.

## Changes

### New: `src/views/Settings.vue`
A standard page view containing the push notifications toggle. Reuses the existing logic from `useNotifications`. The sheet wrapper, toolbar, and close button from `SettingsDrawer.vue` are removed — the page uses whatever layout the other views use.

### Updated: `src/router/index.ts`
Add `{ path: '/settings', component: Settings }` alongside the existing routes.

### Updated: `src/frontend/src/App.vue`
- Remove `SettingsDrawer` import, component registration, `settingsOpen` ref, and `openSettings()` function.
- Change the Settings `k-tabbar-link` to use `navigate('/settings')` and `:active="route.path === '/settings'"`.

### Deleted: `src/components/SettingsDrawer.vue`
No longer needed once content is moved to the view.

### Updated: `src/frontend/tests/e2e/settings.spec.ts`
The e2e test currently interacts with the drawer. Update it to navigate to `/settings` instead.

## Out of Scope

- No new settings content is being added.
- No changes to `useNotifications` composable.
- No changes to backend.
