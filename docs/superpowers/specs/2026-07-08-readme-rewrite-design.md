# README Rewrite — Design Spec

**Date:** 2026-07-08

## Overview

Rewrite `README.md`: add a loud no-authentication warning, embed the app
icon, expand the feature list to match the app's current capabilities
(several features have shipped since the README was last written), and add
example screenshots with seeded example data.

## No-authentication warning

Placed immediately under the title/tagline, before any install/dev/prod
instructions — must be the first thing a reader sees, not buried after
setup steps. Use GitHub's built-in alert syntax (renders as a colored,
icon-prefixed callout on github.com):

```markdown
> [!WARNING]
> **This app has no authentication.** It is single-user by design and
> assumes the network layer keeps it private. Only run it:
> - on `localhost` / a private LAN, or
> - behind an authenticating reverse proxy (e.g. [Authelia](https://www.authelia.com), [Authentik](https://goauthentik.io), Tailscale Serve with access control, etc.)
>
> Anyone who can reach the app's HTTP port can read and edit all data. Do
> not expose it directly to the internet.
```

## Icon

Embed `icon.png` at the top of the README, beside/above the title. Simple
markdown image, sized via HTML `<img>` (markdown alone can't set width):

```markdown
<img src="icon.png" alt="Weartrack icon" width="96" />

# Weartrack
```

## Feature list — needs expanding

Current README's "What it does" list predates several shipped features.
Rewrite to include:

- **Wear sessions** — start/stop timer per item, precise durations (existing).
- **Target & max wear durations** — per-category, growing/decaying over
  time based on usage history (existing, underdocumented).
- **Lap counter** — for categories with no maximum, the session bar wraps
  every time elapsed crosses the target ("laps"), with escalating visual
  tiers (glow → sparkles) the longer a session runs.
- **Rest & decay tracking** — categories enforce a minimum rest period
  after wear; if you wait too long before wearing again, targets decay back
  toward their baseline. The Home screen shows live rest/decay state per
  category.
- **Category streaks** — a flame badge shows the current consecutive-use
  streak per category.
- **Calendar / Log** — week-by-week and list views of wear history.
- **Leaderboards** — rank items by total wear, session count, longest
  session, or streak.
- **Injury logging** — record overuse events; active injuries halve
  target/max durations until resolved.
- **PWA** — installable on mobile, works offline once loaded.

(Verify each bullet against actual current behavior while writing — some of
the above is inferred from page names/recent commits, not exhaustively
re-verified against the live app in this pass.)

## Example screenshots

Add a "Screenshots" section after the feature list, before Architecture.
Needs, at minimum:

1. **Home tab** — 2-3 categories in varied states: one idle, one actively
   being worn (showing the progress bar), one resting or decaying (to show
   those visual states), one with a visible streak badge.
2. **Log tab** — calendar/list view with a few weeks of example history.
3. **Stats tab** — a leaderboard populated with a few items.

Example data needed to produce these: a handful of categories (e.g.
"Footwear", "Orthodontics", "Retainer") each with 1-2 items, several weeks
of backdated session history (so streak/decay/calendar views have something
to show), and at least one active session at screenshot time. This is
implementation work (seed a dev DB, run the app, capture screenshots via
browser automation) — belongs in the implementation plan, not this spec;
this section defines *what* is needed, not how to produce it.

Screenshots saved under a new `docs/screenshots/` directory (not
`docs/superpowers/`, which is planning-process-only), referenced from the
README via relative markdown image links.

## Sections carried over unchanged

Architecture, Development, Production, Tech stack — all stay as-is.

## API table — removed

The existing API table has drifted from actual routes (e.g. sessions are
`POST /api/sessions/start` / `POST /api/sessions/:id/end`, not a generic
`GET/POST /api/sessions`) and isn't worth maintaining in the README. Delete
it outright rather than fixing it.

## Out of scope

- Any change to the app's actual auth posture — this is documentation only,
  making an existing design decision visible, not changing it.
- CONTRIBUTING.md / separate docs site — just the one README.
