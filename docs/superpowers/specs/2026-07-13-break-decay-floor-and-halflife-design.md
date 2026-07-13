# Break decay: floored daily loss + half-life UI input

## Context

Break decay shrinks a category's `target`/`max` wear durations for each full day
past `break_grace_time`, using `break_decay_multiplier` (0 <= x < 1, default 0.91)
as a daily retain-fraction. The current implementation (`calculations.ts`) computes
this as a single closed-form `target *= multiplier ** days_since_grace`, then clamps
the *final* result so it never drops below `category.initial_target_wear_duration_seconds`
(and `initial_max_wear_duration_seconds` for categories with a max).

Two problems with the current behavior:

1. `break_decay_multiplier` is a raw, hard-to-reason-about number (0.91 "feels
   arbitrary"). A half-life is a more intuitive way to configure decay speed.
2. The floor is only applied to the *final* value, not to each day's *loss
   amount*. Near the floor, the daily loss shrinks asymptotically (a fraction of
   an already-small number), so the tail of the decay trails off very slowly.
   The desired behavior is that the loss amount itself never drops below a full
   `initial_target`/`initial_max` per day, so decay reaches the floor in a
   bounded number of days instead of trailing off.

## Formula change

Let `loss_fraction = 1 - category.break_decay_multiplier`.

For each full day past grace, applied independently to `target` and (when the
category has one) `max`:

```
target_decay_amount = max(loss_fraction * target, category.initial_target_wear_duration_seconds)
target = max(target - target_decay_amount, category.initial_target_wear_duration_seconds)

max_decay_amount = max(loss_fraction * max, category.initial_max_wear_duration_seconds)
max = max(max - max_decay_amount, category.initial_max_wear_duration_seconds)
```

Worked example (`initial_target = 900`, `break_decay_multiplier = 0.91` so
`loss_fraction = 0.09`, starting `target = 5000`):

| day | decay_amount | new target |
|-----|-------------|------------|
| 1   | max(450, 900) = 900 | 4100 |
| 2   | max(369, 900) = 900 | 3200 |
| 3   | max(288, 900) = 900 | 2300 |
| 4   | max(207, 900) = 900 | 1400 |
| 5   | max(126, 900) = 900 | 900 (floor) |

Once `target` is large enough that `loss_fraction * target >= initial_target`,
the formula behaves like plain percentage decay (matches current behavior for
values well above the floor). Only near the floor does the flat-amount clamp
change the trajectory.

This loop always terminates in a bounded number of days: once the flat-amount
regime is reached, each day removes at least `initial_target` (or
`initial_max`), so it takes at most `ceil((current - initial) / initial)`
further days to hit the floor.

## Code changes

- `src/backend/src/db/calculations.ts`:
  - `applyBreakDecay`: replace the single `decayMultiplier ** daysSinceGrace`
    exponentiation with a day-by-day loop implementing the formula above, run
    for `daysSinceGrace` iterations. Applies to `target` always, and to `max`
    only when `category.initial_max_wear_duration_seconds !== null`.
  - `daysUntilFullyDecayed` (feeds `computeDecay`'s `decay_full_time` /
    `decay_state`): replace the closed-form `log` calculation with the same
    iterative simulation, counting days until the value reaches
    `initial_target_wear_duration_seconds`.
  - `computeSessionStart`'s existing final `Math.max(target, dm * initial)` /
    `Math.max(max, dm * initial_max)` floor (lines 147-148) stays as-is — still
    correct, now redundant-but-harmless with the loop already enforcing the
    floor per day.
- `docs/design/duration-formula.md`: replace the `target *= pow(category.break_decay_multiplier, new_session.days_since_grace)` line (and the equivalent `max` line) with the loop formula above, and state the floor invariant explicitly (decayed `target`/`max` never below `initial_target`/`initial_max`; the *daily loss amount* never below `initial_target`/`initial_max` either).

## Half-life UI field

`break_decay_multiplier` remains the stored field (`Category.break_decay_multiplier`,
DB unchanged, default 0.91). The category form presents it as a half-life
instead of a raw multiplier — no new schema/migration needed:

- `src/frontend/src/components/CategoryForm.vue:48-56`: replace the "Break
  decay / day" `NumberField` (bound to `catForm.breakDecayMultiplier`) with a
  "Break half-life (days)" field bound to `catForm.breakDecayHalfLifeDays`.
  Min just above 0 (e.g. 0.1); no upper bound.
- `src/frontend/src/utils/categoryForm.ts`:
  - `categoryToFormState()`: when loading an existing category, derive
    `breakDecayHalfLifeDays = Math.log(0.5) / Math.log(break_decay_multiplier)`.
  - `formStateToApiPayload()`: derive
    `break_decay_multiplier = 0.5 ** (1 / breakDecayHalfLifeDays)` on submit.
- New-category default: `DEFAULT_CATEGORY_FIELDS.break_decay_multiplier` stays
  0.91; the form computes its displayed half-life from that (≈7.3 days), so a
  brand-new category's behavior is unchanged from today.

Note: this half-life field only changes how `break_decay_multiplier` is chosen
in the UI. It's orthogonal to the formula change above.

## Tests

- `src/backend/tests/db/calculations.test.ts`:
  - The 5-day worked example above, for a category with no max (target only).
  - Same shape test for a category with `initial_max_wear_duration_seconds`
    set, confirming `max` decays independently with its own floor.
  - Large `days_since_grace` (e.g. 1000): confirms `target`/`max` clamp
    exactly to `initial_target`/`initial_max`, no overshoot below.
  - `daysUntilFullyDecayed`/`computeDecay`: verify the day count matches the
    iterative simulation (e.g. 5 days for the worked example above), and that
    `decay_state` flips to `'fully_decayed'` at the right time.
- Frontend: `categoryForm.ts` round-trip test — a category with
  `break_decay_multiplier` set derives the expected half-life, and submitting
  that half-life back reproduces the same multiplier (within floating-point
  tolerance).

## Out of scope

- No DB migration — `break_decay_multiplier` storage is unchanged.
- No change to `break_grace_time` handling.
- No change to injury halving, rest calculation, or risk levels.
