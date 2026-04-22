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
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT(100) NOT NULL,
  icon                  TEXT NOT NULL,              -- SF Symbols name (NOT emoji)
  initial_wear          INTEGER NOT NULL,           -- T0 in seconds (e.g. 900 = 15 min)
  rest_multiplier       REAL NOT NULL,              -- m in rest = m*wear + c
  rest_constant         REAL NOT NULL,              -- c in rest = m*wear + c (e.g. 86400 = 24h)
  risk_levels           TEXT NOT NULL,              -- JSON: [{lower, upper, text, severity}]
  break_decay_multiplier REAL NOT NULL,             -- e.g. 0.75 for <1 week break
  break_penalty_period  INTEGER NOT NULL            -- hours before decay kicks in
);
```

### `items`
```sql
CREATE TABLE items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name        TEXT(100) NOT NULL,
  color       TEXT NOT NULL,      -- hex colour
  difficulty  REAL NOT NULL DEFAULT 1.0
);
```

### `sessions`
```sql
CREATE TABLE sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id         INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  started_at      INTEGER NOT NULL,   -- unix timestamp
  ended_at        INTEGER,            -- null while wearing
  calculated_wear INTEGER NOT NULL DEFAULT 0,  -- seconds
  calculated_rest INTEGER,            -- seconds; null while wearing
  injury          INTEGER NOT NULL DEFAULT 0   -- boolean
);
```

### `injuries`
```sql
CREATE TABLE injuries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  occurred_at INTEGER NOT NULL,   -- unix timestamp
  heals_at    INTEGER,            -- null until healed
  severity    INTEGER NOT NULL    -- 1-5, derived from risk_levels threshold
);
```

### `stats` (per-item cumulative)
```sql
CREATE TABLE stats (
  item_id           INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  total_wear        INTEGER NOT NULL DEFAULT 0,
  session_count     INTEGER NOT NULL DEFAULT 0,
  max_wear          INTEGER NOT NULL DEFAULT 0,
  streak_wear       INTEGER NOT NULL DEFAULT 0,  -- seconds in current active streak
  streak_count      INTEGER NOT NULL DEFAULT 0,  -- sessions in current active streak
  best_streak_wear  INTEGER NOT NULL DEFAULT 0,  -- seconds in all-time best streak
  best_streak_count INTEGER NOT NULL DEFAULT 0   -- sessions in all-time best streak
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
// Field names: occurred_at, heals_at, severity (NOT started_at/healed_at)
export function getActiveInjury(itemId: number)
export function recordInjury(itemId: number, severity: number)  // sets occurred_at=now, heals_at=null
export function healInjury(itemId: number)                      // sets heals_at=now
export function hasActiveInjury(itemId: number): boolean
```

---

## Task 3.5 (revised): `db/calculations.ts`

```ts
// rest = rest_multiplier * wear + rest_constant
export function calculateRest(wearSeconds: number, category: Category): number

// Look up which risk_levels band the wear falls into
export function getRiskLevel(wearSeconds: number, category: Category): RiskLevel | null

// Exponential decay for break periods: multiplier ^ (breakHours / penaltyPeriodHours)
export function calculateBreakDecay(breakHours: number, category: Category): number
```

---

## Task 3.6 (revised): TypeScript interfaces

```ts
interface Category {
  id: number; name: string; icon: string;
  initial_wear: number; rest_multiplier: number; rest_constant: number;
  risk_levels: RiskLevel[]; break_decay_multiplier: number; break_penalty_period: number;
}
interface RiskLevel { lower: number | null; upper: number | null; text: string; severity: number; }
interface Item { id: number; category_id: number; name: string; color: string; difficulty: number; }
interface Session {
  id: number; item_id: number; started_at: number; ended_at: number | null;
  calculated_wear: number; calculated_rest: number | null; injury: number;
}
interface Injury { id: number; item_id: number; occurred_at: number; heals_at: number | null; severity: number; }
interface Stats {
  item_id: number; total_wear: number; session_count: number; max_wear: number;
  streak_wear: number; streak_count: number; best_streak_wear: number; best_streak_count: number;
}
```

---

## Task 4.4 (revised): Categories controller

- CRUD as before
- `risk_levels` stored as JSON string, parsed on read
- **No** `points_per_hour` anywhere

---

## Task 4.8 (revised): Sessions controller

### `POST /api/sessions/end/:itemId`

On session end:
1. Calculate `wearTime = now - session.started_at`
2. Calculate `calculatedRest` via `calculateRest(wearTime, category)` — adjusted if other injuries are active (×1.5 rest multiplier per design doc)
3. Update session: `ended_at = now`, `calculated_wear = wearTime`, `calculated_rest = calculatedRest`
4. Upsert `stats` row — **no points**:
   - `total_wear += wearTime`
   - `session_count += 1`
   - `max_wear = MAX(max_wear, wearTime)`
   - If no break since last session: `streak_wear += wearTime`, `streak_count += 1`
   - Else: reset `streak_wear = wearTime`, `streak_count = 1`
   - If `streak_wear > best_streak_wear`: update best

### Break detection
A break occurs if the gap between `previous_session.ended_at` and `session.started_at` exceeds `previous_session.calculated_rest + 24h` (the 24h grace window from the design doc).

---

## Task 4.10 (revised): Injuries controller

### `POST /api/injuries/:itemId`
- Requires active session (injury ends wear)
- `severity` derived from `getRiskLevel(wearTime, category).severity` — **not** user-provided
- Ends the session (sets `injury = 1`)
- Inserts injury row (`occurred_at = now`, `heals_at = null`, `severity = derivedValue`)
- Returns injury + ended session

### `GET /api/injuries/:itemId`
- Returns most recent active injury (where `heals_at IS NULL`)

### `DELETE /api/injuries/:itemId` (heal)
- Sets `heals_at = now`

---

## Task 4.12 (revised): Stats controller

### `GET /api/stats/:itemId`
Returns cumulative `stats` row for the item.

### `GET /api/stats/category/:categoryId/leaderboard?stat=<type>`
Supported `stat` values: `longest-wear`, `most-total-wear`, `best-streak`, `most-sessions`

Ranking is calculated at query time — no stored rank or points:
```sql
SELECT s.*, i.name, i.color, c.icon
FROM stats s
JOIN items i ON s.item_id = i.id
JOIN categories c ON i.category_id = c.id
WHERE i.category_id = ?
ORDER BY s.best_streak_wear DESC   -- (varies by stat type)
```

### `GET /api/stats/:itemId/history?period=month&year=2026&month=4`
Monthly wear total from sessions:
```sql
SELECT SUM(calculated_wear) as total
FROM sessions
WHERE item_id = ? AND strftime('%Y-%m', datetime(started_at, 'unixepoch')) = '2026-04'
```

---

## Verification checklist (SP3 + SP4)

- [ ] `categories` has `icon` (not `emoji`), all formula fields, no `points_per_hour`
- [ ] `sessions` has `calculated_wear`, `calculated_rest`, `injury`
- [ ] `injuries` has `occurred_at`, `heals_at`, `severity`
- [ ] `stats` has both current and best streak fields; no `points`
- [ ] All routers use `router.route('/', controller)` pattern
- [ ] `db/index.ts` exports `prepare`
- [ ] Session end updates stats correctly (streak logic, no points)
- [ ] Injury severity derived from `risk_levels`, not user input
- [ ] Leaderboard returns rank computed at query time, no stored points
- [ ] Monthly history served from `sessions` table
