# Revised SP3 + SP4 Implementation Plan

**Date**: 2026-04-22  
**Status**: Active  
**Supersedes**: `2026-04-21-full-implementation-plan.md` (SP3 + SP4 sections only)

## Why this revision

The original implementation diverged from the design docs in four ways:

1. **Points system invented** — `categories.points_per_hour`, `stats.points` never appeared in any design doc. Removed entirely.
2. **Stats model wrong** — implementation used per-date rows; spec requires per-item cumulative aggregates. Both are now needed (cumulative for leaderboards; sessions table provides time-series).
3. **Categories formula fields missing** — `initial_wear`, `rest_multiplier`, `rest_constant`, `risk_levels`, `break_decay_multiplier`, `break_penalty_period` are the core scheduling feature and were omitted.
4. **Injuries field drift** — `started_at`/`healed_at` → `occurred_at`/`heals_at`; `severity` was missing.

## Critical implementation notes (learned from first pass)

### Hono sub-app mounting
**Always** use `router.route('/', controller)` to mount a Hono controller as a sub-app.  
**Never** use `router.get('/path', controller)` or `router.post('/path', controller)` with a Hono instance — TypeScript raises TS2769 because a Hono instance is not a handler function.

```ts
// ✅ Correct
export const router = new Hono();
router.route('/', controller);

// ❌ Wrong — TS2769
router.get('/', controller);
```

### db/index.ts — export `prepare`
Export the `prepare` helper directly so controllers can call `prepare(sql).get(...)` without importing the raw db instance:

```ts
export const prepare = (sql: string) => db.prepare(sql);
```

---

## Corrected Database Schema

### `categories`
```sql
CREATE TABLE categories (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  name                          TEXT(100) NOT NULL,
  icon                          TEXT NOT NULL,              -- SF Symbols name (NOT emoji)
  initial_wear_duration_seconds INTEGER NOT NULL,           -- T0 in seconds (e.g. 900 = 15 min)
  rest_multiplier               REAL NOT NULL,              -- m in rest = m*wear + c
  rest_constant_seconds         REAL NOT NULL,              -- c in rest = m*wear + c (e.g. 86400 = 24h)
  risk_levels                   TEXT NOT NULL,              -- JSON: [{lower, upper, text, severity}]
  break_decay_multiplier        REAL NOT NULL,              -- e.g. 0.75 for <1 week break
  break_starts_after_seconds    INTEGER NOT NULL            -- seconds before break decay kicks in
);
```

### `items`
```sql
CREATE TABLE items (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id          INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name                 TEXT(100) NOT NULL,
  color                TEXT NOT NULL,      -- hex colour
  difficulty_multiplier REAL NOT NULL DEFAULT 1.0
);
```

### `sessions`
```sql
CREATE TABLE sessions (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id                 INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  started_at              INTEGER NOT NULL,   -- unix timestamp
  ended_at                INTEGER,            -- null while wearing
  calculated_wear_seconds INTEGER NOT NULL DEFAULT 0,  -- seconds
  calculated_rest_seconds INTEGER,            -- seconds; null while wearing
  ended_in_injury         INTEGER NOT NULL DEFAULT 0   -- boolean
);
```

### `injuries`
```sql
CREATE TABLE injuries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  occurred_at INTEGER NOT NULL,   -- unix timestamp
  healed_at   INTEGER,            -- null until healed
  severity    INTEGER NOT NULL    -- 1-5, derived from risk_levels threshold
);
```

### `stats` (per-item cumulative)
```sql
CREATE TABLE stats (
  item_id                     INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  total_wear_seconds          INTEGER NOT NULL DEFAULT 0,
  session_count               INTEGER NOT NULL DEFAULT 0,
  max_single_session_wear_seconds INTEGER NOT NULL DEFAULT 0,
  streak_wear_seconds         INTEGER NOT NULL DEFAULT 0,  -- seconds in current active streak
  streak_count                INTEGER NOT NULL DEFAULT 0,  -- sessions in current active streak
  best_streak_wear_seconds    INTEGER NOT NULL DEFAULT 0,  -- seconds in all-time best streak
  best_streak_count           INTEGER NOT NULL DEFAULT 0   -- sessions in all-time best streak
);
```

**Time-series queries** (monthly totals, month-on-month, calendar view) run directly against `sessions.started_at` + `sessions.calculated_wear`. No separate `wear_history` table needed.

---

## Branch structure

All branches created fresh from `main`. Stack:

```
main
 └── sp3-data-layer-v2        (!17)
      └── sp4-server-middleware-v2  (!18)
           └── sp4-categories-v2   (!19)
                └── sp4-items-v2   (!20)
                     └── sp4-sessions-v2  (!21)
                          └── sp4-injuries-v2  (!22)
                               └── sp4-stats-v2  (!23)
                                    └── sp5-vite-config-v2  (!24)
```

---

## Task 3.1 (revised): `db/index.ts`

- Open SQLite with `better-sqlite3`
- Export `db` (the raw instance) and `prepare` helper
- Use `:memory:` in test environment

```ts
import Database from 'better-sqlite3';

const DB_PATH = process.env.NODE_ENV === 'test' ? ':memory:' : './weartrack.db';
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const prepare = (sql: string) => db.prepare(sql);
export { db as dbExport };
export default db;
```

**Test**: connect, run `SELECT 1`, assert row returned.

---

## Task 3.2 (revised): `db/migrations/001_initial.ts`

Create all tables in order (respecting FK dependencies):
1. `meta`
2. `categories`
3. `items`
4. `sessions`
5. `injuries`
6. `stats`

Use the exact column definitions from the schema above.

**Test**: run migration on `:memory:` DB, assert all tables exist via `sqlite_master`.

---

## Task 3.3 (unchanged): `db/migrations/index.ts`

Migration runner — tracks schema version in `meta`, applies pending migrations in order.

---

## Task 3.4 (revised): `db/injury.ts`

```ts
// Field names: occurred_at, healed_at, severity (NOT started_at/heals_at)
export function getActiveInjury(itemId: number)
export function recordInjury(itemId: number, severity: number)  // sets occurred_at=now, healed_at=null
export function healInjury(itemId: number)                      // sets healed_at=now
export function hasActiveInjury(itemId: number): boolean
```

---

## Task 3.5 (revised): `db/calculations.ts`

```ts
// rest = rest_multiplier * wear + rest_constant_seconds
export function calculateRest(wearSeconds: number, category: Category, injuryActive: boolean): number

// Look up which risk_levels band the wear falls into
export function getRiskLevel(wearSeconds: number, category: Category): RiskLevel | null

// Exponential decay applied after break exceeds grace window
// breakHoursOverGrace = (breakSeconds - calculated_rest_seconds) / 3600
export function calculatePostBreakWear(prevWear: number, breakHoursOverGrace: number, category: Category): number
```

---

## Task 3.6 (revised): TypeScript interfaces

```ts
interface Category {
  id: number; name: string; icon: string;
  initial_wear_duration_seconds: number;
  rest_multiplier: number;
  rest_constant_seconds: number;
  risk_levels: string | RiskLevel[];
  break_decay_multiplier: number;
  break_starts_after_seconds: number;
}
interface RiskLevel { lower: number | null; upper: number | null; text: string; severity: number; }
interface Item { id: number; category_id: number; name: string; color: string; difficulty_multiplier: number; }
interface Session {
  id: number; item_id: number; started_at: number; ended_at: number | null;
  calculated_wear_seconds: number; calculated_rest_seconds: number | null; ended_in_injury: number;
}
interface Injury { id: number; item_id: number; occurred_at: number; healed_at: number | null; severity: number; }
interface Stats {
  item_id: number; total_wear_seconds: number; session_count: number;
  max_single_session_wear_seconds: number;
  streak_wear_seconds: number; streak_count: number;
  best_streak_wear_seconds: number; best_streak_count: number;
}
```

---

## Task 4.4 (revised): Categories controller

- CRUD as before
- `risk_levels` stored as JSON string, parsed on read
- **No** `points_per_hour` anywhere

---

## Task 4.8 (revised): Sessions controller

### Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/sessions | List sessions; optional `?item_id=` filter |
| GET | /api/sessions/current | One entry per category (null-object for idle) |
| GET | /api/sessions/:id | Get single session by ID |
| POST | /api/sessions/start | Begin wear session |
| POST | /api/sessions/:id/end | Finish wear session |

### `POST /api/sessions/start`

Request body: `{ item_id: number, started_at?: number }` (started_at is an optional Unix timestamp for retroactive recording).

Validation:
- `item_id` must be a number → 400
- `started_at` if provided must be a number → 400
- Item must exist → 404
- **One session per category**: if another item in the same category has an open session → 409 with `{ error: "...", conflicting_item: { id, name } }`

Returns 201 with the new session row.

### `POST /api/sessions/:id/end`

Request body: `{ ended_at?: number }` (optional Unix timestamp for retroactive recording).

On session end:
1. `endTs = ended_at ?? now`
2. `elapsed = endTs - session.started_at`
3. `finalWear = session.calculated_wear_seconds + elapsed`
4. `calculatedRest = calculateRest(finalWear, category, injuryActive)`
5. Update session: `ended_at = endTs`, `calculated_wear_seconds = finalWear`, `calculated_rest_seconds = calculatedRest`
6. Update `stats` row:
   - `total_wear_seconds += finalWear`
   - `session_count += 1`
   - `max_single_session_wear_seconds = MAX(max_single_session_wear_seconds, finalWear)`
   - If no break since last session: `streak_wear_seconds += finalWear`, `streak_count += 1`
   - Else: reset `streak_wear_seconds = finalWear`, `streak_count = 1`
   - If `streak_wear_seconds > best_streak_wear_seconds`: update best

### `GET /api/sessions/current`

Returns one entry per category, always the full list. Each entry:
```json
{
  "category": { "id": 1, "name": "Footwear", "risk_levels": [...], ... },
  "item": { "id": 5, "name": "Test Shoe", "color": "#ff0000", ... } | null,
  "session": { "id": 123, "started_at": 1745000000, "ended_at": null, ... } | null
}
```
`item` and `session` are `null` when no open session exists for that category.

### Break detection
A break occurs if the gap between `previous_session.ended_at` and `session.started_at` exceeds `previous_session.calculated_rest_seconds + 86400` (the 24h grace window).

---

## Task 4.10 (revised): Injuries controller

### Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/injuries | List injuries; optional `?item_id=` filter |
| GET | /api/injuries/:id | Get single injury by ID |
| POST | /api/injuries | Report a new injury |
| POST | /api/injuries/:id/heal | Mark injury as healed |

### `POST /api/injuries`

Request body: `{ item_id: number, wear_seconds?: number }`.

- `severity` derived from `getRiskLevel(wear_seconds ?? currentSessionWear, category).severity` — **not** user-provided; defaults to 1 if no wear data
- Inserts injury row (`occurred_at = now`, `healed_at = null`, `severity = derivedValue`)
- Returns 201 with the new injury row

Error responses:
- 400 if `item_id` missing
- 400 if item already has an active injury (`healed_at IS NULL`)
- 404 if item does not exist

### `POST /api/injuries/:id/heal`
- Sets `healed_at = now`
- Returns 200 with updated injury row
- 400 if already healed
- 404 if not found

---

## Task 4.12 (revised): Stats controller

### Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/stats/leaderboard/:type | Cross-item leaderboard |
| GET | /api/stats/:item_id | Cumulative stats for one item |
| GET | /api/stats/:item_id/history | Time-series aggregated from sessions |

### `GET /api/stats/:item_id`
Returns cumulative `stats` row for the item.

### `GET /api/stats/leaderboard/:type`
**Note**: route must be registered before `/:item_id` to avoid shadowing.

Supported `:type` values: `longest-wear`, `most-total-wear`, `best-streak`, `most-sessions`

Ranking is calculated at query time — no stored rank or points. Each type sorts by a different stats column (e.g. `best-streak` sorts by `best_streak_wear_seconds DESC`).

### `GET /api/stats/:item_id/history?unit=month|week`
Time-series aggregated from sessions:
```sql
SELECT strftime('%Y-%m', datetime(ended_at, 'unixepoch')) as period,
       SUM(calculated_wear_seconds) as total_wear_seconds,
       COUNT(*) as session_count
FROM sessions
WHERE item_id = ? AND ended_at IS NOT NULL
GROUP BY period
ORDER BY period ASC
```

---

## Verification checklist (SP3 + SP4)

- [ ] `categories` has `icon` (not `emoji`), all formula fields (`initial_wear_duration_seconds`, `rest_constant_seconds`, `break_starts_after_seconds`), no `points_per_hour`
- [ ] `items` has `difficulty_multiplier` (not `difficulty`)
- [ ] `sessions` has `calculated_wear_seconds`, `calculated_rest_seconds`, `ended_in_injury`
- [ ] `injuries` has `occurred_at`, `healed_at` (not `heals_at`), `severity`
- [ ] `stats` has `total_wear_seconds`, `max_single_session_wear_seconds`, `streak_wear_seconds`, `best_streak_wear_seconds`; no `points`
- [ ] All routers use `router.route('/', controller)` pattern
- [ ] `db/index.ts` exports `prepare`
- [ ] Session start enforces one-per-category (not one-per-item); 409 includes `conflicting_item: { id, name }`
- [ ] `POST /api/sessions/start` accepts optional `started_at` Unix timestamp
- [ ] `POST /api/sessions/:id/end` accepts optional `ended_at` Unix timestamp
- [ ] `GET /api/sessions/current` returns one entry per category, full list, null-object for idle
- [ ] Session end updates stats correctly (streak logic, no points)
- [ ] Injury severity derived from `risk_levels`, not user input
- [ ] `GET /api/stats/leaderboard/:type` registered before `/:item_id` to avoid route shadowing
- [ ] Monthly/weekly history served from `sessions` table via `?unit=month|week`
