# Sub-Project 3: Core Data Layer — Design

**Date**: 2026-04-21  
**Status**: Approved

## Goal

Implement SQLite data layer with migrations, using better-sqlite3 and prepared statements.

**Stack**: better-sqlite3, raw SQL

## Directory Structure

```
src/backend/
    ├── src/
    │   └── server.js
    └── middleware/
        └── auth.js
    └── db/
        ├── index.js                 # DB connection, ready instance
        ├── injury.js                # Injury period handling
        ├── migrations/              # Migration files
        │   ├── 001_initial.js
        │   │   └── ...
        │   └── index.js             # Migration runner
        ├── schema.js                # Schema after all migrations
        └── calculations.js          # Domain logic
    └── items/
    └── sessions/
    └── injuries/
    └── stats/
    └── leaderboard/
    └── ...
```

## Migrations Mechanism

**Migration file format** (`src/db/migrations/001_initial.ts`):

```typescript
import db from '../index.js';

export default function runMigration() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories ( ... );
    CREATE TABLE IF NOT EXISTS items ( ... );
    CREATE TABLE IF NOT EXISTS sessions ( ... );
    CREATE TABLE IF NOT EXISTS injuries ( ... );
    CREATE TABLE IF NOT EXISTS stats ( ... );
  `);
}
```

Each migration is a default-exported function that runs idempotently via `CREATE TABLE IF NOT EXISTS`. The migration is called once at server startup (and in test `beforeAll`).

## Database Schema

**Meta** (tracking):

| Column | Type | Description |
|--|--|--|
| schema_version | INTEGER PRIMARY KEY | Current migration version |
| applied_at | DATETIME | When applied |
| name | TEXT | Migration name |

**Categories** (formula config + display):

| Column | Type | Nullable | Description |
|--|--|--|--|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | | |
| name | TEXT(100) NOT NULL | | Category name |
| icon | TEXT NOT NULL | | SF Symbols name |
| initial_wear_duration_seconds | INTEGER NOT NULL | | Base wear (seconds) |
| rest_multiplier | REAL NOT NULL | | y=mx+c coefficient |
| rest_constant_seconds | REAL NOT NULL | | y=mx+c intercept |
| risk_levels | JSON | | Array of {lower, upper, text, severity} |
| break_decay_multiplier | REAL NOT NULL | | e.g., 0.75 |
| break_starts_after_seconds | INTEGER NOT NULL | | seconds before decay kicks in |

**Items** (wearable objects):

| Column | Type | Nullable | Description |
|--|--|--|--|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | | |
| category_id | INTEGER NOT NULL REFERENCES categories(id) | | |
| name | TEXT(100) NOT NULL | | |
| color | TEXT NOT NULL | | hex or name |
| difficulty_multiplier | REAL DEFAULT 1.0 | | e.g., 0.66 for easier; 1.5 for harder |

**Wear Sessions**:

| Column | Type | Nullable | Description |
|--|--|--|--|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | | |
| item_id | INTEGER NOT NULL REFERENCES items(id) | | |
| started_at | INTEGER NOT NULL | | Unix timestamp |
| ended_at | INTEGER | ✓ | Unix timestamp; null while wearing |
| calculated_wear_seconds | INTEGER NOT NULL DEFAULT 0 | | seconds |
| calculated_rest_seconds | INTEGER | ✓ | seconds; null while wearing |
| ended_in_injury | INTEGER NOT NULL DEFAULT 0 | | boolean (0/1) |

**Injuries**:

| Column | Type | Nullable | Description |
|--|--|--|--|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | | |
| item_id | INTEGER NOT NULL REFERENCES items(id) | | |
| occurred_at | INTEGER NOT NULL | | Unix timestamp |
| healed_at | INTEGER | ✓ | Unix timestamp; null until healed |
| severity | INTEGER NOT NULL | | 1–5, derived from risk_levels |

**Injury Handling**:
- User must stop wearing item immediately when injured
- Rest period is infinite until heal report
- Future schedule completely wiped out until healed
- User returns when reporting healed
- No rest calculations during injury period

**Stats** (per-item cumulative):

| Column | Type | Nullable | Description |
|--|--|--|--|
| item_id | INTEGER PRIMARY KEY REFERENCES items(id) | | |
| total_wear_seconds | INTEGER NOT NULL DEFAULT 0 | | |
| session_count | INTEGER NOT NULL DEFAULT 0 | | |
| max_single_session_wear_seconds | INTEGER NOT NULL DEFAULT 0 | | |
| streak_wear_seconds | INTEGER NOT NULL DEFAULT 0 | | seconds in current streak |
| streak_count | INTEGER NOT NULL DEFAULT 0 | | sessions in current streak |
| best_streak_wear_seconds | INTEGER NOT NULL DEFAULT 0 | | all-time best streak (seconds) |
| best_streak_count | INTEGER NOT NULL DEFAULT 0 | | all-time best streak (sessions) |

Time-series queries (monthly totals, calendar view) run directly against `sessions.ended_at` + `sessions.calculated_wear_seconds`.

### API Integration

Controllers use a `prepare` helper exported from `src/db/index.ts`:

```typescript
import Database from 'better-sqlite3';

const DB_PATH = process.env.NODE_ENV === 'test' ? ':memory:' : './weartrack.db';
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const prepare = (sql: string) => db.prepare(sql);
export default db;
```

Controllers call `prepare(sql).get(...)` / `.all(...)` / `.run(...)` directly — no pre-exported prepared statements.

### Stats Update Pattern

Stats are updated inline after each session ends. No transactions needed (single-threaded SQLite):

```typescript
prepare(`UPDATE stats SET
  total_wear_seconds = total_wear_seconds + ?,
  session_count = session_count + 1,
  max_single_session_wear_seconds = ?,
  streak_wear_seconds = ?, streak_count = ?,
  best_streak_wear_seconds = ?, best_streak_count = ?
  WHERE item_id = ?`).run(duration, newMax, streakWear, streakCount, bestWear, bestCount, itemId);
```

### Injury Period Handling

**src/db/injury.ts**:

```typescript
import { prepare } from './index.js';

// Returns true if item has an injury with healed_at IS NULL
export function hasActiveInjury(itemId: number): boolean {
  const row = prepare(
    'SELECT id FROM injuries WHERE item_id = ? AND healed_at IS NULL LIMIT 1'
  ).get(itemId);
  return row !== undefined;
}
```

Injury CRUD (create, list, heal) is handled in the injuries controller rather than in this helper module.

### Domain Logic

**src/db/calculations.ts**:

```typescript
export interface Category {
  id: number; name: string; icon: string;
  initial_wear_duration_seconds: number;
  rest_multiplier: number;
  rest_constant_seconds: number;
  risk_levels: string | RiskLevel[];
  break_decay_multiplier: number;
  break_starts_after_seconds: number;
}

export interface RiskLevel {
  lower: number | null; upper: number | null; text: string; severity: number;
}

// rest = rest_multiplier * wear + rest_constant_seconds
// If an injury is active, rest is multiplied by 1.5
export function calculateRest(wear: number, category: Category, injuryActive: boolean): number {
  const base = Math.floor(category.rest_multiplier * wear + category.rest_constant_seconds);
  return injuryActive ? Math.floor(base * 1.5) : base;
}

// Look up which risk_levels band the wear falls into
export function getRiskLevel(wearSeconds: number, category: Category): RiskLevel | null {
  const levels = typeof category.risk_levels === 'string'
    ? JSON.parse(category.risk_levels) as RiskLevel[]
    : category.risk_levels;
  return levels.find(l =>
    (l.lower === null || wearSeconds > l.lower) &&
    (l.upper === null || wearSeconds <= l.upper)
  ) ?? null;
}

// Exponential decay applied when the break exceeds the grace window
// breakHoursOverGrace = (breakSeconds - calculated_rest_seconds) / 3600
export function calculatePostBreakWear(
  prevWear: number,
  breakHoursOverGrace: number,
  category: Category,
): number {
  const periodHours = category.break_starts_after_seconds / 3600;
  const decay = category.break_decay_multiplier ** (breakHoursOverGrace / periodHours);
  return Math.floor(prevWear * decay);
}
```

### Migrations Directory

**Migration files** (`src/db/migrations/`):

```
001_initial.js
```
