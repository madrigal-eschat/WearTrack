# README Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-07-08-readme-rewrite-design.md`:
rewrite `README.md` with a loud no-authentication warning, the app icon, an
accurate/expanded feature list, real example screenshots, and removal of
the stale API table.

**Architecture:** Task 1 rewrites `README.md`'s text sections (warning,
icon, features, tech stack fix, API table removal) — pure documentation
edit, no app changes. Task 2 adds a standalone seed script that populates a
running dev instance with realistic example data via its HTTP API. Task 3
runs the app against that seeded data, captures three screenshots via
browser automation, saves them under `docs/screenshots/`, and wires them
into the README's new Screenshots section.

**Tech Stack:** Markdown, Node/tsx (seed script hits the real HTTP API,
matching the codebase's existing test-fixture pattern), Playwright or
Claude-in-Chrome for screenshot capture (implementer's choice — see Task 3).

## Global Constraints

- No-auth warning goes immediately under the title, before any
  install/dev/prod instructions — first thing a reader sees.
- Icon (`icon.png`) embedded via `<img src="icon.png" ... width="96" />`
  (plain markdown can't set width).
- Feature list must accurately describe shipped behavior — verified against
  actual source in this plan, not just inferred from commit history.
- API table is deleted outright, not corrected.
- Architecture, Development, Production sections stay unchanged, except the
  Tech Stack section's "CI/CD: GitLab CI" line, which is now factually
  wrong post-migration and must say GitHub Actions instead.
- Screenshots saved under `docs/screenshots/` (not `docs/superpowers/`).
- Out of scope: any change to the app's actual auth posture; CONTRIBUTING.md
  or a separate docs site.

---

### Task 1: Rewrite `README.md` text

**Files:**
- Modify: `README.md`

**Interfaces:**
- Produces: a `## Screenshots` section placeholder (heading only, with a
  one-line comment noting images land in Task 3) positioned after `## What
  it does` and before `## Architecture` — Task 3 fills in the actual image
  references at that heading.

- [ ] **Step 1: Replace the full file content**

Replace `README.md` in its entirety with:

```markdown
<img src="icon.png" alt="Weartrack icon" width="96" />

# Weartrack

Track the usage of wearable items — orthotics, braces, retainers, shoes, anything worn on a schedule. Log sessions, view wear history on a calendar, and see leaderboards across items and categories.

> [!WARNING]
> **This app has no authentication.** It is single-user by design and
> assumes the network layer keeps it private. Only run it:
> - on `localhost` / a private LAN, or
> - behind an authenticating reverse proxy (e.g. [Authelia](https://www.authelia.com), [Authentik](https://goauthentik.io), Tailscale Serve with access control, etc.)
>
> Anyone who can reach the app's HTTP port can read and edit all data. Do
> not expose it directly to the internet.

## What it does

- **Wear sessions** — start and stop a timer for any item; sessions are stored with precise durations.
- **Target & max wear durations** — each category has a target and (optionally) a maximum wear duration per session. Both grow session-over-session as you keep wearing on schedule, and decay back toward their starting values if you go too long without wearing.
- **Lap counter** — categories with no maximum don't cap out at target: the session bar wraps every time elapsed crosses it ("laps"), escalating through visual tiers (a soft glow, then increasingly dense sparkles) the longer a session runs.
- **Rest & decay tracking** — each category enforces a minimum rest period after a session ends. The Home screen shows a live rest countdown while you're within that window, and a decay countdown afterward if you wait long enough for targets to start shrinking back down.
- **Category streaks** — a flame badge on each category shows your current consecutive-use streak.
- **Calendar / Log** — week-by-week and list views of wear history, with jump-to-date navigation.
- **Leaderboards** — rank items by total wear, session count, longest single session, or streak.
- **Injury logging** — record overuse events; an active injury halves target/max durations for that category until resolved.
- **PWA** — installable on mobile, works offline once loaded.

## Screenshots

<!-- Filled in by the README rewrite plan's Task 3. -->

## Architecture

```
src/
  backend/   Hono API server + SQLite via better-sqlite3
  frontend/  Vue 3 + Vite PWA + Konsta UI (iOS-style components)
```

The backend exposes a JSON REST API under `/api/`. In production, both are served from the same Docker container (backend on port 3000). In development they run separately, with Vite proxying `/api` calls to the backend.

## Development

Prerequisites: Node.js 22+

```bash
# Install dependencies
npm ci --prefix src/backend
npm ci --prefix src/frontend --legacy-peer-deps

# Run backend (port 3000) and frontend (port 5173) in separate terminals:
npm run dev --prefix src/backend
npm run dev --prefix src/frontend
```

The frontend dev server proxies `/api/*` to `http://localhost:3000`, so you can hit `http://localhost:5173` and have everything work.

## Production

Build and run with Docker Compose:

```bash
docker compose up --build
```

The app will be available at `http://localhost:3000`.

## Tech stack

- **Backend:** [Hono](https://hono.dev) · [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) · Node.js
- **Frontend:** [Vue 3](https://vuejs.org) · [Vite](https://vitejs.dev) · [Konsta UI](https://konstaui.com) · [Tailwind CSS](https://tailwindcss.com) · [Heroicons](https://heroicons.com)
- **CI/CD:** GitHub Actions · Docker
```

(This drops the old `## API` table entirely, fixes the "GitLab CI" tech
stack line to "GitHub Actions", and adds the icon embed, warning, expanded
feature list, and an empty `## Screenshots` placeholder heading for Task 3.)

- [ ] **Step 2: Sanity-check the markdown renders sensibly**

Run: `cat README.md | head -20`
Expected: icon `<img>` tag, then `# Weartrack`, then the tagline, then the
`> [!WARNING]` block — in that order, matching the Global Constraint that
the warning is the first thing after the title.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README with no-auth warning, icon, expanded features"
```

---

### Task 2: Example-data seed script

**Files:**
- Create: `src/backend/scripts/seed-example-data.ts`

**Interfaces:**
- Produces: a script runnable as `npx tsx scripts/seed-example-data.ts`
  from `src/backend/`, which POSTs directly to a running dev server on
  `http://localhost:3000`. No exported functions — this is a one-shot CLI
  script, not a library. Consumed by Task 3, which runs it against a live
  dev server before capturing screenshots.

This script must produce, against a **freshly-reset** dev database:

- **"Footwear"** category: max wear duration set, one item ("Trail Runners"),
  3 prior completed sessions over the past 3 weeks (building history for
  the Log/Stats views), and **one currently-active session** (started
  recently, well within target) — so the Home tab shows an active progress
  bar with a target marker.
- **"Orthodontics"** category: **no maximum** (null), one item ("Night
  Guard"), 2 prior completed sessions, and **one currently-active session
  started well before target** (so multiple laps have completed by the time
  a screenshot is taken — this shows the lap badge and glow/sparkle tiers).
- **"Retainer"** category: max wear duration set, one item ("Upper Retainer"),
  **3 consecutive completed sessions** each starting within the category's
  rest+grace window of the previous one ending (building a streak), with
  the **last session ended long enough ago** that the category is now in
  its decaying state (past rest + grace, but not yet fully decayed) — so
  the idle row shows both the decay bar and a streak badge simultaneously,
  and no active session (idle row, not active row).

- [ ] **Step 1: Write the script**

```ts
// src/backend/scripts/seed-example-data.ts
// One-shot script: seeds a running dev server (http://localhost:3000) with
// realistic example data for README screenshots. Run against a freshly
// reset database — POST /api/__reset first if re-running.
const BASE = 'http://localhost:3000';
const now = Math.floor(Date.now() / 1000);
const DAY = 86400;
const HOUR = 3600;

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function endSession(id: number, endedAt: number) {
  return post(`/api/sessions/${id}/end`, { ended_at: endedAt });
}

async function startSession(itemId: number, startedAt: number) {
  return post('/api/sessions/start', { item_id: itemId, started_at: startedAt });
}

async function main() {
  // --- Footwear: max set, active session, some history ---
  const footwear = await post('/api/categories', {
    name: 'Footwear',
    icon: 'ph:sneaker',
    initial_target_wear_duration_seconds: 3 * HOUR,
    initial_max_wear_duration_seconds: 6 * HOUR,
    rest_multiplier: 1,
    minimum_rest: 4 * HOUR,
    risk_levels: [
      { lower: null, upper: 6 * HOUR, text: 'Safe', severity: 1 },
      { lower: 6 * HOUR, upper: null, text: 'High', severity: 2 },
    ],
    break_decay_multiplier: 0.9,
    break_grace_time: 3 * DAY,
  });
  const trailRunners = await post('/api/items', {
    name: 'Trail Runners', category_id: footwear.id, color: '#3b82f6',
  });
  for (const daysAgo of [21, 14, 7]) {
    const start = now - daysAgo * DAY;
    const s = await startSession(trailRunners.id, start);
    await endSession(s.id, start + 2 * HOUR);
  }
  await startSession(trailRunners.id, now - 45 * 60); // active 45 min

  // --- Orthodontics: null max, active session past several laps ---
  const ortho = await post('/api/categories', {
    name: 'Orthodontics',
    icon: 'ph:tooth',
    initial_target_wear_duration_seconds: 30 * 60,
    initial_max_wear_duration_seconds: null,
    rest_multiplier: 0.5,
    minimum_rest: 0,
    risk_levels: [{ lower: null, upper: null, text: 'Low', severity: 1 }],
    break_decay_multiplier: 0.95,
    break_grace_time: 2 * DAY,
  });
  const nightGuard = await post('/api/items', {
    name: 'Night Guard', category_id: ortho.id, color: '#f97316',
  });
  for (const daysAgo of [10, 4] as const) {
    const start = now - daysAgo * DAY;
    const s = await startSession(nightGuard.id, start);
    await endSession(s.id, start + 45 * 60);
  }
  await startSession(nightGuard.id, now - 3.5 * HOUR); // several laps past a 30min target

  // --- Retainer: streak of 3, now decaying, idle (no active session) ---
  const retainer = await post('/api/categories', {
    name: 'Retainer',
    icon: 'ph:circle-dashed',
    initial_target_wear_duration_seconds: 8 * HOUR,
    initial_max_wear_duration_seconds: 10 * HOUR,
    rest_multiplier: 1,
    minimum_rest: 30 * 60,
    risk_levels: [{ lower: null, upper: null, text: 'Low', severity: 1 }],
    break_decay_multiplier: 0.85,
    break_grace_time: 1 * DAY,
  });
  const upperRetainer = await post('/api/items', {
    name: 'Upper Retainer', category_id: retainer.id, color: '#22c55e',
  });
  // Three consecutive sessions, each starting well within rest+grace of the
  // previous one ending, most recent ended long enough ago (past rest+grace,
  // within a few decay-multiplier days) to be "decaying" but not fully.
  let prevEnd = now - 12 * DAY;
  for (let i = 0; i < 3; i++) {
    const start = prevEnd + 10 * 60; // 10 min after previous ended — well within rest+grace
    const s = await startSession(upperRetainer.id, i === 0 ? prevEnd - 8 * HOUR : start);
    const end = i === 0 ? prevEnd : start + 8 * HOUR;
    await endSession(s.id, end);
    prevEnd = end;
  }

  console.log('Seed complete:', { footwear: footwear.id, ortho: ortho.id, retainer: retainer.id });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it runs against a live dev server**

Run (from repo root, two terminals or background the first):
```bash
npm run dev --prefix src/backend &
sleep 2
cd src/backend && npx tsx scripts/seed-example-data.ts
```
Expected: prints `Seed complete: { footwear: <id>, ortho: <id>, retainer: <id> }`
with no thrown errors. If any `POST` fails, the error message includes the
path and response body — fix the request shape and re-run (after resetting:
`curl -X POST http://localhost:3000/api/__reset`).

Stop the dev server (`kill %1` or Ctrl-C) once verified.

- [ ] **Step 3: Commit**

```bash
git add src/backend/scripts/seed-example-data.ts
git commit -m "chore: add example-data seed script for README screenshots"
```

---

### Task 3: Capture screenshots and wire into README

**Files:**
- Create: `docs/screenshots/home.png`
- Create: `docs/screenshots/log.png`
- Create: `docs/screenshots/stats.png`
- Modify: `README.md`

**Interfaces:**
- Consumes: `src/backend/scripts/seed-example-data.ts` (Task 2), the
  `## Screenshots` placeholder heading (Task 1).

- [ ] **Step 1: Start a fresh app instance and seed it**

```bash
curl -X POST http://localhost:3000/api/__reset 2>/dev/null || true  # in case a stale server is running
npm run dev --prefix src/backend &
BACKEND_PID=$!
sleep 2
npm run dev --prefix src/frontend &
FRONTEND_PID=$!
sleep 2
cd src/backend && npx tsx scripts/seed-example-data.ts && cd ../..
```

Expected: both dev servers running (`http://localhost:3000` backend,
`http://localhost:5173` frontend), seed script prints `Seed complete`.

- [ ] **Step 2: Capture three screenshots**

Use whichever browser automation tool is available in your environment
(Claude-in-Chrome, or Playwright's `page.screenshot()` via a throwaway
script) to visit `http://localhost:5173` and capture:

1. **`docs/screenshots/home.png`** — the Home tab. Confirm before capturing
   that it shows: Footwear's active progress bar with target marker,
   Orthodontics' active bar showing lap badge + glow/sparkle effect, and
   Retainer's idle row showing both a decay bar and a streak flame badge.
   If any of these aren't visible (e.g. timing drifted since Task 2's
   seed-time offsets were written), re-run the seed script with adjusted
   offsets in `seed-example-data.ts` (e.g. increase the Orthodontics active
   session's start offset, or adjust Retainer's `prevEnd` base) until they
   are, then re-seed and recapture — this is real verification against a
   real running app, not a one-shot capture.
2. **`docs/screenshots/log.png`** — the Log tab, showing the multi-week
   history seeded in Task 2 (calendar or list view, whichever is the
   default landing view).
3. **`docs/screenshots/stats.png`** — the Stats/leaderboard tab, showing
   the seeded items ranked.

Crop/resize is not required — full-page or viewport screenshots are fine.

- [ ] **Step 3: Stop the dev servers**

```bash
kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
```

- [ ] **Step 4: Wire the screenshots into `README.md`**

Replace:

```markdown
## Screenshots

<!-- Filled in by the README rewrite plan's Task 3. -->
```

with:

```markdown
## Screenshots

| Home | Log | Stats |
|------|-----|-------|
| ![Home tab](docs/screenshots/home.png) | ![Log tab](docs/screenshots/log.png) | ![Stats tab](docs/screenshots/stats.png) |
```

- [ ] **Step 5: Verify the images are valid and reasonably sized**

Run: `file docs/screenshots/*.png && ls -lh docs/screenshots/*.png`
Expected: all three report as valid PNG image data; none are 0 bytes or
absurdly large (a full-page mobile-width screenshot should be well under
5MB each — if one is huge, re-capture at a viewport size instead of a
full-page scroll capture).

- [ ] **Step 6: Commit**

```bash
git add docs/screenshots/ README.md
git commit -m "docs: add example screenshots to README"
```
