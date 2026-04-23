# Full Implementation Plan: Weartrack Monolith

**Date**: 2026-04-21  
**Last updated**: 2026-04-23  
**Status**: SP1–SP4 complete; SP5 in progress

---

## Overview

| Subproject | Description | Status |
|------------|-------------|--------|
| SP1 | Infrastructure (Docker Compose, Dockerfile, package.json) | ✅ Done |
| SP2 | GitLab CI/CD pipeline | ✅ Done |
| SP3 | SQLite data layer with migrations | ✅ Done |
| SP4 | Hono backend API | ✅ Done |
| SP5 | Vue 3 PWA frontend | ⬜ Not started |

---

## Current project structure

```
weartrack/
├── package.json                          # Root (npm workspaces)
├── docker-compose.yml
├── docker/
│   └── Dockerfile
├── .gitlab-ci.yml
├── vitest.config.ts
├── src/
│   ├── backend/
│   │   ├── package.json
│   │   └── src/
│   │       ├── server.ts
│   │       ├── middleware/
│   │       │   ├── logging.ts
│   │       │   └── errors.ts
│   │       ├── db/
│   │       │   ├── index.ts
│   │       │   ├── calculations.ts
│   │       │   ├── stores/
│   │       │   │   ├── category-store.ts
│   │       │   │   ├── item-store.ts
│   │       │   │   ├── session-store.ts
│   │       │   │   ├── injury-store.ts
│   │       │   │   └── stats-store.ts
│   │       │   └── migrations/
│   │       │       ├── index.ts
│   │       │       └── 001_initial.ts
│   │       └── controllers/
│   │           ├── categories.ts
│   │           ├── items.ts
│   │           ├── sessions.ts
│   │           ├── injuries.ts
│   │           └── leaderboards.ts
│   └── frontend/
│       ├── package.json
│       ├── vite.config.ts
│       └── src/                          # ← to be built in SP5
│           ├── App.vue
│           ├── main.ts
│           ├── router/
│           │   └── index.ts
│           ├── views/
│           │   ├── Home.vue
│           │   ├── Items.vue
│           │   ├── Stats.vue
│           │   └── Setup.vue
│           ├── components/
│           │   ├── ActionPane.vue
│           │   ├── CalendarPane.vue
│           │   ├── StatsPane.vue
│           │   └── SettingsDrawer.vue
│           └── composables/
│               ├── useItems.ts
│               ├── useWear.ts
│               ├── useCalendar.ts
│               ├── useStats.ts
│               └── useCategories.ts
└── docs/
    └── superpowers/
        ├── specs/
        └── plans/
```

---

## Database schema (as implemented)

### `categories`
```sql
CREATE TABLE categories (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  name                          TEXT(100) NOT NULL,
  icon                          TEXT NOT NULL,              -- SF Symbols name (e.g. "figure.walk")
  initial_wear_duration_seconds INTEGER NOT NULL,           -- T0: wear credit at start of fresh session
  rest_multiplier               REAL NOT NULL,              -- m in rest = m × wear + c
  rest_constant_seconds         REAL NOT NULL,              -- c in rest = m × wear + c
  risk_levels                   TEXT NOT NULL,              -- JSON: [{lower, upper, text, severity}]
  break_decay_multiplier        REAL NOT NULL,              -- exponential base for wear decay after long break
  break_starts_after_seconds    INTEGER NOT NULL            -- break length beyond rest window before decay applies
);
```

### `items`
```sql
CREATE TABLE items (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id           INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name                  TEXT(100) NOT NULL,
  color                 TEXT NOT NULL,                      -- hex colour (e.g. "#ff0000")
  difficulty_multiplier REAL NOT NULL DEFAULT 1.0
);
```

### `sessions`
```sql
CREATE TABLE sessions (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id                 INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  started_at              INTEGER NOT NULL,                 -- unix timestamp
  ended_at                INTEGER,                         -- null while active
  calculated_wear_seconds INTEGER NOT NULL DEFAULT 0,
  calculated_rest_seconds INTEGER,                         -- null while active
  ended_in_injury         INTEGER NOT NULL DEFAULT 0       -- boolean
);
```

### `injuries`
```sql
CREATE TABLE injuries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  occurred_at INTEGER NOT NULL,
  healed_at   INTEGER,                                     -- null until healed
  severity    INTEGER NOT NULL                             -- 1–5, derived from risk_levels
);
```

### `stats` (per-item, no streak)
```sql
CREATE TABLE stats (
  item_id                         INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  total_wear_seconds              INTEGER NOT NULL DEFAULT 0,
  session_count                   INTEGER NOT NULL DEFAULT 0,
  max_single_session_wear_seconds INTEGER NOT NULL DEFAULT 0
);
```

### `category_stats` (per-category, includes streak)
```sql
CREATE TABLE category_stats (
  category_id                     INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  total_wear_seconds              INTEGER NOT NULL DEFAULT 0,
  session_count                   INTEGER NOT NULL DEFAULT 0,
  max_single_session_wear_seconds INTEGER NOT NULL DEFAULT 0,
  streak_wear_seconds             INTEGER NOT NULL DEFAULT 0,
  streak_count                    INTEGER NOT NULL DEFAULT 0,
  best_streak_wear_seconds        INTEGER NOT NULL DEFAULT 0,
  best_streak_count               INTEGER NOT NULL DEFAULT 0
);
```

---

## API routes (as implemented)

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | `{ status: 'ok' }` |

### Categories
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/categories | List all |
| GET | /api/categories/:id | Get one |
| GET | /api/categories/:id/stats | CategoryStats + item_count |
| POST | /api/categories | Create |
| PATCH | /api/categories/:id | Update |
| DELETE | /api/categories/:id | Delete |

### Items
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/items | List all; `?category_id=` filter |
| GET | /api/items/:id | Get one |
| GET | /api/items/:id/stats | ItemStats |
| GET | /api/items/:id/stats/history | Time-series; `?unit=month\|week` |
| POST | /api/items | Create |
| PATCH | /api/items/:id | Update |
| DELETE | /api/items/:id | Delete |

### Sessions
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/sessions | List; `?item_id=` filter |
| GET | /api/sessions/current | One entry per category (null-object for idle) |
| GET | /api/sessions/:id | Get one |
| POST | /api/sessions/start | Begin session; body: `{ item_id, started_at? }` |
| POST | /api/sessions/:id/end | End session; body: `{ ended_at? }` |

### Injuries
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/injuries | List; `?item_id=` filter |
| GET | /api/injuries/:id | Get one |
| POST | /api/injuries | Record injury; body: `{ item_id, wear_seconds? }` |
| POST | /api/injuries/:id/heal | Mark healed |

### Leaderboards
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/leaderboards/longest-wear | Items by max single session |
| GET | /api/leaderboards/most-total-wear | Items by total wear |
| GET | /api/leaderboards/best-streak | Categories by best streak |
| GET | /api/leaderboards/most-sessions | Items by session count |

---

## Key TypeScript interfaces (as implemented)

```ts
// db/stores/stats-store.ts
interface ItemStats {
  item_id: number;
  total_wear_seconds: number;
  session_count: number;
  max_single_session_wear_seconds: number;
}

interface CategoryStats {
  category_id: number;
  total_wear_seconds: number;
  session_count: number;
  max_single_session_wear_seconds: number;
  streak_wear_seconds: number;
  streak_count: number;
  best_streak_wear_seconds: number;
  best_streak_count: number;
}

// GET /api/categories/:id/stats also includes:
// item_count: number

// db/stores/session-store.ts
interface Session {
  id: number; item_id: number; started_at: number; ended_at: number | null;
  calculated_wear_seconds: number; calculated_rest_seconds: number | null;
  ended_in_injury: number;
}

// db/stores/injury-store.ts
interface Injury {
  id: number; item_id: number; occurred_at: number; healed_at: number | null; severity: number;
}
```

---

## Architecture notes

- **Store pattern**: all SQL lives in `db/stores/*.ts`. Controllers contain zero `db.prepare()` calls.
- **Controllers**: flat `src/controllers/*.ts`, each exports a `router` (Hono instance). No separate router shims.
- **Streak tracking**: streaks are per-category, not per-item. A break occurs when `started_at - prev_category_ended_at > prev.calculated_rest_seconds + 86400`.
- **Stats init**: `itemStore.create()` inserts a `stats` row; `categoryStore.create()` inserts a `category_stats` row.
- **Session end transaction**: `sessionStore.end()` updates the session, then calls `statsStore.recordItemSession()` and `statsStore.recordCategorySession()` within a single SQLite transaction.
- **SPA catch-all**: `app.get('/*', ...)` returns 200 HTML — unknown paths do not 404.

---

## Subproject 5: Frontend

**Dependencies**: `vue`, `konsta`, `vue-router` (runtime); `@vitejs/plugin-vue`, `vite`, `vite-plugin-pwa` (dev)  
**Existing files**: `package.json`, `vite.config.ts`

### Task 5.1: `src/frontend/index.html`
- PWA meta tags, viewport, theme-color
- Apple touch icon + mobile-web-app-capable meta tags
- Single `<div id="app">` mount point

### Task 5.2: `src/frontend/src/main.ts`
- Create Vue app, mount router and Konsta UI plugin, mount to `#app`

### Task 5.3: `src/frontend/src/router/index.ts`
Routes:
- `/` → `Home.vue`
- `/items` → `Items.vue`
- `/stats` → `Stats.vue`
- `/setup` → `Setup.vue`

### Task 5.4: `src/frontend/src/App.vue`
- Root layout (KApp wrapper from Konsta)
- `<router-view>` inside

### Task 5.5: `src/frontend/src/composables/useCategories.ts`
- `GET /api/categories` — load full list with icons
- `GET /api/categories/:id/stats` — load CategoryStats (streak, total wear, item_count)
- CRUD: create, update, delete

### Task 5.6: `src/frontend/src/composables/useItems.ts`
- `GET /api/items?category_id=` — list items per category
- `GET /api/items/:id/stats` — load ItemStats
- `GET /api/items/:id/stats/history?unit=month` — time-series for calendar/chart
- CRUD: create, update, delete

### Task 5.7: `src/frontend/src/composables/useWear.ts`
- `GET /api/sessions/current` — poll or fetch current session state per category
- `POST /api/sessions/start` — begin session `{ item_id }`
- `POST /api/sessions/:id/end` — end session
- `POST /api/injuries` — report injury `{ item_id, wear_seconds? }`
- `POST /api/injuries/:id/heal` — mark healed

### Task 5.8: `src/frontend/src/composables/useStats.ts`
- `GET /api/leaderboards/longest-wear`
- `GET /api/leaderboards/most-total-wear`
- `GET /api/leaderboards/best-streak`
- `GET /api/leaderboards/most-sessions`

### Task 5.9: `src/frontend/src/composables/useCalendar.ts`
- Date navigation (current week / month)
- Format unix timestamps to display strings
- Derive worn/rest/idle state per day from session history

### Task 5.10: `src/frontend/src/views/Home.vue`
- Two-pane layout: ActionPane (top), CalendarPane (bottom)
- Loads current session state via `useWear`

### Task 5.11: `src/frontend/src/views/Items.vue`
- List items (grouped by category or flat)
- Add / edit / delete item actions

### Task 5.12: `src/frontend/src/views/Stats.vue`
- Leaderboard selector (four types)
- Sorted list with wear/session counts
- Per-category streak display

### Task 5.13: `src/frontend/src/views/Setup.vue`
- Empty state for first-run (no categories)
- "Add your first category" CTA

### Task 5.14: `src/frontend/src/components/ActionPane.vue`
- Loop over categories from `useWear` current state
- Per-category row: icon, name, active item name or idle label
- Wear / Stop buttons; injury button when wearing

### Task 5.15: `src/frontend/src/components/CalendarPane.vue`
- Week grid (7 columns)
- Each day cell: worn indicator dot + duration if worn
- Navigate prev/next week

### Task 5.16: `src/frontend/src/components/SettingsDrawer.vue`
- Slide-in drawer for category management (create, edit, delete)
- Risk levels editor

### Task 5.17: Verify full stack
- `docker compose up --build`
- Confirm API serves at `/api/*`
- Confirm frontend loads at `/`
- Confirm PWA manifest at `/manifest.webmanifest`
