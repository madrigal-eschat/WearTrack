# Idle Max Wear & Rest Warning — Design Spec

**Date:** 2026-06-23

## Overview

On the Home tab, when a category has no active session, show the selected item's maximum wear duration for the next session, and a rest warning (with bed icon) if the user should still be resting. Both values update reactively every second in the browser.

---

## Backend

### New method: `session-store.ts` — `findAllLastSessions()`

A single SQL query that LEFT JOINs all items to their most recent ended session:

```sql
SELECT
  i.id AS item_id,
  i.category_id,
  i.name,
  i.color,
  i.difficulty_multiplier,
  s.ended_at,
  s.calculated_wear_seconds,
  s.calculated_rest_seconds
FROM items i
LEFT JOIN sessions s ON s.id = (
  SELECT id FROM sessions
  WHERE item_id = i.id AND ended_at IS NOT NULL
  ORDER BY ended_at DESC
  LIMIT 1
)
```

Returns `ItemWithLastSession[]` where `ended_at` / `calculated_wear_seconds` / `calculated_rest_seconds` are `null` for items with no history. Not scoped to a category — called once and grouped in the controller.

### Updated type: `ItemWithLastSession`

```ts
interface ItemWithLastSession {
  item_id: number;
  category_id: number;
  name: string;
  color: string;
  difficulty_multiplier: number;
  ended_at: number | null;
  calculated_wear_seconds: number | null;
  calculated_rest_seconds: number | null;
}
```

### Updated route: `GET /api/sessions/current`

The controller calls `findAllLastSessions()` once, builds a `Map<category_id, ItemWithLastSession[]>`, then adds an `items` field to each entry:

```ts
// Entry shape (extended)
{
  category: Category;
  item: Item | null;          // active item (unchanged)
  session: Session | null;    // active session (unchanged)
  items: ItemWithLastSession[]; // all items in category with last-session data
}
```

---

## Frontend

### New utility: `src/utils/wearCalculations.ts`

```ts
export function maxWearSeconds(
  category: { initial_wear_duration_seconds: number },
  item: { difficulty_multiplier: number }
): number {
  return category.initial_wear_duration_seconds * item.difficulty_multiplier;
}
```

Used by both the active-session Max display and the new idle-state Max label. The inline formula currently in `ActionPane.vue` (`maxWear()` and `wearProgress()`) is replaced with calls to this function.

### New composable: `src/composables/useNow.ts`

```ts
// Returns a reactive ref<number> of Date.now(), updated every 1 second.
// Re-calculation and re-rendering only — no API calls.
export function useNow(): Ref<number>
```

Mounted/unmounted lifecycle management (clear interval on unmount). `ActionPane` imports `useNow` and uses it as the time source for:
- Elapsed time in active sessions (`sessionSeconds`)
- Max-wear progress bar denominator
- Rest-remaining countdown in idle rows

### Updated composable: `src/composables/useWear.ts`

- `CurrentEntry` type gains `items: ItemWithLastSession[]`
- API poll interval bumped from 30s to **60s** (API call rule)

### Updated component: `src/components/ActionPane.vue`

**Active-session row (unchanged visually):**
- `maxWear()` calls `maxWearSeconds(entry.category, entry.item)` from the shared utility
- `wearProgress()` uses the same utility for the denominator
- `sessionSeconds()` switches to `now.value` from `useNow` so elapsed time ticks live

**Idle row (new):**

In the `v-else` (no session) branch, add below/alongside the item picker:

- **Max label**: `"Max: " + formatDuration(maxWearSeconds(entry.category, selectedItemData))` where `selectedItemData` is looked up from `entry.items` by `selectedItem[entry.category.id]`. Updates instantly on dropdown change (no API call needed).

- **Rest warning**: shown only when `now / 1000 < lastSession.ended_at + lastSession.calculated_rest_seconds` for the selected item's last session (`now` is ms, timestamps are seconds). Displays a bed icon + `"Rest Xm more"` in amber. `X = Math.ceil((ended_at + calculated_rest_seconds - now / 1000) / 60)`. Updates every second via `useNow`.

Both the Max label and rest warning are absent when the category has no items (`entry.items.length === 0`).

---

## Error / edge cases

| Case | Behaviour |
|---|---|
| Item has no session history | `last_session` fields are null — no rest warning shown, Max label still shown |
| Rest period already elapsed | Rest warning not shown |
| No items in category | Neither Max nor rest warning shown |
| Item selected has `difficulty_multiplier = 0` | Max shows "0s" — acceptable edge case, no special handling |

---

## Out of scope

- Changing the API timestamp convention (all timestamps remain Unix epoch numbers)
- Restricting session start when rest period is active (informational only)
- Migrating existing timestamp fields to ISO 8601
