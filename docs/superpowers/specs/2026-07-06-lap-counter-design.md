# Null-Max Lap Counter — Design Spec

**Date:** 2026-07-06

## Overview

For categories with no maximum wear duration set (`initial_max_wear_duration_seconds`
is null), the active-session progress bar currently fills toward target and caps
at 100% ([2026-06-23-target-max-wear-design.md](2026-06-23-target-max-wear-design.md)
punted the "lap counter" mechanic as future work). This spec implements that
follow-up: the bar wraps at each multiple of target ("laps"), shows a lap count
badge, and long sessions carry a bonus into the next session's target growth.

This is purely a null-max mechanic. Categories with a max set are unaffected.

## Formula changes

Extends [`docs/design/duration-formula.md`](../../design/duration-formula.md).

New derived value, computed at session start wherever `previous_session` is
looked up (not stored):

```
lap_count = floor(previous_session.elapsed / previous_session.target)
```

`lap_count` is only ever nonzero when `category.initial_max_wear` is null (a
category with a max never produces laps).

**Session-start, normal-growth branch** (`start_time >= previous_session.earliest_start`):

```
target = item.difficulty_modifier * (previous_session.target + category.initial_target + floor(lap_count/2) * previous_session.target)
```

**Session-start, early-restart branch** (`start_time < previous_session.earliest_start`)
— this branch does not include `category.initial_target`, matching today's
behavior, but now applies `difficulty_modifier` (a correctness fix bundled with
this change; today this branch omits the modifier entirely):

```
target = (item.difficulty_modifier / 2) * (previous_session.target + floor(lap_count/2) * previous_session.target)
```

`max` formulas are untouched — always null under this mechanic.

The lap carry-over is purely cosmetic-driven bookkeeping for the *next*
session's target; it has no effect on `rest_seconds` or any other part of the
end-of-session formula.

## UI / display

- **Active session bar (null-max only):** fill fraction is
  `(elapsed % target) / target` — wraps back to 0% every time elapsed crosses
  a multiple of target, instead of capping at 100%.
- **Lap badge:** text `${lap_count}x`, shown next to the bar. Hidden while
  `lap_count == 0` (first lap in progress); appears once `lap_count >= 1`.
- **Session-end summary / log entry:** same badge shown for completed
  sessions, computed from the stored `target_wear_seconds` and derived
  elapsed (`ended_at - started_at`) — no new stored fields required.

### Escalating bar effects

Effects are keyed off a tier derived from `lap_count` (helper `lapTier(lap_count)`
in `wearCalculations.ts`, returning 0–4). Escalates through a few tiers then
plateaus — fully open-ended escalation isn't practically designable or testable.

| `lap_count` | Tier | Effect |
|---|---|---|
| 0 | 0 | Plain bar, no effect, badge hidden |
| 1 | 0 | Plain bar, badge hidden (first lap in progress) |
| 2 | 1 | Glow: soft pulsing box-shadow in the bar's normal color |
| 3–4 | 2 | Glow + sparkles (light density) |
| 5–7 | 3 | Glow + denser sparkles + faster pulse |
| 8+ | 4 | Max tier: glow + densest sparkles + fastest pulse — caps here |

All effects are CSS-driven (box-shadow animation + small sparkle particles).
On the session-end/log display, effects are static (no animation) — badge
plus, at tier ≥ 2, a static sparkle icon next to it.

## Testing

- **Backend unit tests** (duration-formula calc): `lap_count` for elapsed at
  0–1x target (0), exactly 1x (1), 2.9x (2); normal-growth and early-restart
  target formulas at `lap_count` = 0, 1, 2, 3 (checking the `floor(N/2)`
  boundary); confirm `max` stays null/untouched.
- **Frontend unit tests** (`wearCalculations.ts`): fill fraction wraps
  correctly past 100%; `lapTier` boundaries (0/1/2/4/5/7/8); badge text only
  appears at `lap_count >= 1`.
- **Component tests:** ActionPane active-session row shows badge once first
  lap completes, hidden before; glow/sparkle classes applied at correct tiers;
  session-end/log entry shows correct lap count and static sparkle icon for a
  past session at tier ≥ 2.

## Out of scope

- Any change to categories with a max set — lap mechanic is null-max only.
- New DB columns or migrations — everything derived from existing
  `target_wear_seconds`, `started_at`, `ended_at`.
- Effects beyond tier 4 — the ladder caps there by design.
