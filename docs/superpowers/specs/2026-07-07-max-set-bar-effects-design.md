# Progress Bar Effects for Max-Set Sessions — Design Spec

**Date:** 2026-07-07

## Overview

[2026-07-06-lap-counter-design.md](2026-07-06-lap-counter-design.md) added
escalating glow/sparkle bar effects (tiers 0-4) for null-max categories once
target is passed, driven by lap count. Max-set categories were explicitly
left plain (fill + target marker only, no effects) — see that spec's
"reused the item's own color" tier table, which only fires for
`lapCount >= 1`, itself gated to null-max sessions
(`ActionPane.vue`'s `lapCountFor`).

This spec extends the same visual language to max-set categories: instead
of lapping, escalation runs once between target and max, and a distinct
red "critical" state takes over once max is passed.

## Tier mapping (target → max)

For a max-set session, once elapsed passes target, tier is driven by
fraction of the way from target to max:

```
progress = (elapsed - target) / (max - target)   // 0 at target, 1 at max
```

Even quarters, matching the lap system's 4 tiers:

| `progress` | Tier | Effect |
|---|---|---|
| < 25% | 1 | Glow only |
| 25–50% | 2 | Glow + light sparkles |
| 50–75% | 3 | Glow + denser sparkles + faster pulse |
| ≥ 75% (up to max) | 4 | Max tier: densest sparkles, fastest pulse |

Same glow/sparkle visuals as the lap system (reuses `WearProgressBar`'s
existing tier CSS — `tier-1`..`tier-4` — unchanged). Glow/sparkle color is
still the item's own color, same as lap mode.

**No badge.** The lap badge ("Nx") has no equivalent here — there's no
natural count to display for a continuous target→max approach. Effects are
visual-only.

## Past max: red sawtooth

Once elapsed passes max, the bar stops reflecting fill progress and
switches to a distinct "critical" animation:

- Bar color becomes a fixed red (not the item's color) — reuses the same
  red used elsewhere for overdue/error state.
- Fill animates as a sawtooth: 100% down to 0% over 1 second, then
  instantly resets to 100% and repeats, for as long as the session stays
  open past max.
- No glow/sparkle effects layer on top of this state — the sawtooth itself
  is the "tier 4 and beyond" signal.
- Target marker is hidden in this state (it's behind the fill the entire
  time and no longer meaningful).

This is purely a bar-visual change. The existing overdue treatment from
[2026-07-06-active-session-row-layout-design.md](2026-07-06-active-session-row-layout-design.md)
— the `Overdue` stat value and the "Stop wearing" CTA under the title —
is unaffected and continues to render alongside the sawtooth bar, not
replaced by it.

## Component impact

`WearProgressBar.vue` (wear mode) gains:
- A `maxCriticalMode` (or equivalent internal derivation from existing
  props) once fill would exceed 100% for a max-set session — needs a way
  to distinguish "null-max, past target" (existing lap behavior) from
  "max-set, past max" (this new sawtooth behavior). Concretely: the
  component already receives `fillFraction` (0-1, clamped) and
  `targetMarkerFraction`; a new prop is needed to carry tier information
  for the target→max case, and a boolean/derived flag for "past max."
- The tier computation currently derives entirely from `lapCount` (null-max
  only). For max-set sessions, `ActionPane.vue` needs to compute an
  equivalent tier from `progress` above and pass it through — this likely
  means widening the existing `lapCount`-driven tier prop into a more
  general `effectTier` prop, with `ActionPane.vue` responsible for
  computing which of the two mechanisms (lap-based or target→max-based)
  applies to a given session.

Exact prop/function naming is left to the implementation plan — this spec
fixes the behavior, not the internal API shape.

## Testing

- **Unit tests:** a `maxProgressTier(elapsed, target, max)`-style pure
  function (frontend `wearCalculations.ts`) covering the quarter boundaries
  (0%, 24%, 25%, 49%, 50%, 74%, 75%, 100%) and returning tiers 1-4; a
  `isPastMax(elapsed, max)` or equivalent boolean helper.
- **Component/e2e:** sawtooth class/state applied once elapsed > max; tier
  classes applied correctly at each quarter boundary for a max-set session
  between target and max; confirm the existing lap effects still fire only
  for null-max sessions and are unaffected by this change (regression
  check on the gating logic added in the lap-counter plan).

## Out of scope

- Any change to the null-max lap mechanic itself — unaffected.
- Any change to the `Overdue`/`Stop wearing` row-layout treatment — both
  continue to render as specified, alongside the new bar state.
- Sound, haptics, or any non-visual escalation.
