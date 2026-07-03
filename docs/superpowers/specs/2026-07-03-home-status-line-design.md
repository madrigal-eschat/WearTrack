# Home tab: status line content and styling

## Problem

The status line under each category name on the Home tab (`ActionPane.vue`'s `subtitle()`) currently only shows "Idle" or the worn item's name. It needs to reflect more states — resting, decaying, overdue — and needs different typography (bigger text, tighter gap to the category name above it).

## Design

### Status line content

Add a new pure function `statusLabel` to `src/frontend/src/utils/wearCalculations.ts` (same file/convention as `remainingWearSeconds`), taking primitive inputs so it's unit-testable without Vue:

```ts
export function statusLabel(input: {
  itemName: string | null;       // entry.item?.name ?? null
  isOverdue: boolean;            // result of existing isOverdue(entry) logic
  restRemainingSeconds: number;  // result of existing restRemainingSeconds(entry)
  decayState: 'none' | 'decaying' | 'fully_decayed';
}): string
```

Logic, evaluated in this order:

1. **`itemName !== null` (active session) and `isOverdue`** → `"Overwearing " + itemName`
2. **`itemName !== null` (active session), not overdue** → `"Wearing " + itemName`
3. **`itemName === null` (no session), `restRemainingSeconds > 0`** → `"Resting"`
4. **`itemName === null`, not resting, `decayState === 'decaying'`** → `"Idle - wear soon"`
5. **`itemName === null`, not resting, not decaying** (default, covers `'none'` and `'fully_decayed'`) → `"Idle"`

Resting takes precedence over the decay warning: if both would apply (resting item in a decaying category), the status line shows "Resting"; "Idle - wear soon" only appears once resting is over. `fully_decayed` is treated the same as `none` (shows "Idle") — it isn't currently decaying, decay already completed.

In `ActionPane.vue`, replace the current `subtitle(entry)` function (currently lines 178-183) with one that calls `statusLabel`, passing values derived from the existing `isOverdue(entry)` and `restRemainingSeconds(entry)` helpers (reused as-is, not reimplemented) and `entry.decay_state`.

### Styling

`k-list-item` currently receives `:subtitle="subtitle(entry)"` as a prop, which Konsta renders at a fixed `text-sm` (14px). Switch to the `#subtitle` slot instead, wrapping the text in a `<span>` with `text-base` (16px — larger than the current 14px, still smaller than the category-name title's ~17px) and a small negative top margin (e.g. `-mt-1`) to tighten the visual gap under the title row.

### Testing

- Unit test `statusLabel` in `wearCalculations.test.ts` covering all five states plus the resting-wins-over-decaying precedence case (both `restRemainingSeconds > 0` and `decayState === 'decaying'` true at once → expect `"Resting"`).
- No component-test framework in this codebase (existing convention) — the `ActionPane.vue` wiring and styling changes are verified by a manual/build-driven check (dev build + live interaction), not an automated component test.
