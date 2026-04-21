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

**Migration file format** (`src/db/migrations/001_initial.js`):

```javascript
export async function up(db) {
  // Create tables
  db.exec(/* CREATE TABLE ... */);
}

export function down(db) {
  // Optional rollback
}
```

**Migration runner** (`src/db/migrations/index.js`):

```javascript
const fs = require('fs');
const path = require('path');
const db = require('../index').default; // ready connection

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const metaTable = db.prepare('SELECT schema_version FROM meta LIMIT 1');
const metaUpsert = db.prepare(
  "INSERT INTO meta (schema_version, applied_at) VALUES (?, ?, ?) ON CONFLICT(schema_version) DO UPDATE SET applied_at = ?"
);

let currentSchemaVersion = metaTable.get() ? metaTable.get().schema_version || 0 : 0;

// List and apply pending migrations
const migrations = fs.readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.js'))
  .sort()
  .map(f => require(`./${f}`));

for (const migration of migrations) {
  const nextVersion = currentSchemaVersion + 1;
  if (nextVersion <= currentSchemaVersion) continue;
  
  if (migration.up) await migration.up(db);
  if (migration.down) await migration.down(db);
  
  metaUpsert.run(nextVersion, new Date().toISOString());
}
```

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
| initial_wear | INTEGER NOT NULL | | Base wear (seconds) |
| rest_multiplier | REAL NOT NULL | | y=mx+c coefficient |
| rest_constant | REAL NOT NULL | | y=mx+c intercept |
| risk_levels | JSON | | Array of {lower, upper, text, severity} |
| break_decay_multiplier | REAL NOT NULL | | e.g., 0.75 |
| break_penalty_period | INTEGER NOT NULL | | hours |

**Items** (wearable objects):

| Column | Type | Nullable | Description |
|--|--|--|--|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | | |
| category_id | INTEGER NOT NULL REFERENCES categories(id) | | |
| name | TEXT(100) NOT NULL | | |
| color | TEXT NOT NULL | | hex or name |
| difficulty | REAL DEFAULT 1.0 | | e.g., 0.66 |

**Wear Sessions**:

| Column | Type | Nullable | Description |
|--|--|--|--|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | | |
| item_id | INTEGER NOT NULL REFERENCES items(id) | | Unique(item_id) |
| started_at | DATETIME NOT NULL | | |
| ended_at | DATETIME | | |
| calculated_wear | INTEGER NOT NULL | | seconds |
| calculated_rest | INTEGER | | seconds, null if wearing |
| injury | BOOLEAN DEFAULT 0 | | |

**Injuries**:

| Column | Type | Nullable | Description |
|--|--|--|--|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | | |
| item_id | INTEGER NOT NULL REFERENCES items(id) | | Unique(item_id) |
| occurred_at | DATETIME NOT NULL | | |
| heals_at | DATETIME | | Null until healed |
| severity | INTEGER NOT NULL | | 1-5 |

**Injury Handling**:
- User must stop wearing item immediately when injured
- Rest period is infinite until heal report
- Future schedule completely wiped out until healed
- User returns when reporting healed
- No rest calculations during injury period

**Stats**:

| Column | Type | Nullable | Description |
|--|--|--|--|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | | |
| item_id | INTEGER NOT NULL REFERENCES items(id) | | Unique(item_id) |
| max_wear | INTEGER NOT NULL DEFAULT 0 | | |
| streak_count | INTEGER NOT NULL DEFAULT 0 | | |
| streak_wear | INTEGER NOT NULL DEFAULT 0 | | |
| total_wear | INTEGER NOT NULL DEFAULT 0 | | |
| session_count | INTEGER NOT NULL DEFAULT 0 | | |
| month_wear_yoy | INTEGER | | Current vs last year |

### API Integration

Export prepared statements from `src/db/index.js`:

```javascript
// Ready connection
const db = dbInstance();
export {
  // Categories
  categoriesSelectAll: db.prepare('SELECT id, name, icon, initial_wear, rest_multiplier, rest_constant, risk_levels, break_decay_multiplier, break_penalty_period FROM categories'),
  categoriesSelectOne: db.prepare('SELECT * FROM categories WHERE id = ?'),
  categoriesInsert: db.prepare('INSERT INTO categories (name, icon, initial_wear, rest_multiplier, rest_constant, risk_levels, break_decay_multiplier, break_penalty_period) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  
  // Items
  itemsSelectAll: db.prepare('SELECT i.*, c.icon FROM items i JOIN categories c ON i.category_id = c.id'),
  itemsSelectOne: db.prepare('SELECT i.*, c.icon FROM items i JOIN categories c ON i.category_id = c.id WHERE i.id = ?'),
  
  // Sessions (lazy stats)
  sessionsInsert: db.prepare(
    'INSERT INTO sessions (item_id, started_at, ended_at, calculated_wear, calculated_rest, injury) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  
  // Stats
  statsSelectOne: db.prepare('SELECT * FROM stats WHERE item_id = ?'),
  statsUpsert: db.prepare(
    'INSERT INTO stats (item_id, max_wear, streak_count, streak_wear, total_wear, session_count, month_wear_yoy) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET ' +
    'max_wear = excluded.max_wear, streak_count = excluded.streak_count, streak_wear = excluded.streak_wear, ' +
    'total_wear = excluded.total_wear, session_count = excluded.session_count, month_wear_yoy = excluded.month_wear_yoy'
  ),
  
  // Stats aggregate queries
  statsAggregateItem: db.prepare(
    'SELECT s.*, ' +
    'SUM(calculate_wear) as total_session_wear, ' +
    'MAX(calculate_wear) as max_session_wear, ' +
    'COUNT(*) as total_sessions ' +
    'FROM sessions s ' +
    'WHERE s.item_id = ? ' +
    'GROUP BY item_id'
  ),
};
```

### Lazy Stats Update Pattern

```javascript
// Transaction: insert session + update stats
const insertSession = db.prepare('INSERT INTO sessions (item_id, started_at, ended_at, calculated_wear, calculated_rest, injury) VALUES (?, ?, ?, ?, ?, ?)');
const statsUpsert = db.prepare(/* upsert query above */);

const addItemWear = db.transaction((item) => {
  const sessionId = insertSession.run(
    item.id,
    new Date().toISOString(),
    null,
    calculatedWear,
    null,
    false
  );
  
  return statsUpsert.run(
    item.id,
    Math.max(item.maxWear || 0, calculatedWear),
    item.streakCount + 1,
    item.streakWear + calculatedWear,
    item.totalWear + calculatedWear,
    item.sessionCount + 1,
    item.monthWearYoy || 0
  );
});
```

### Leaderboard Rank Calculation

Per-statistic leaderboards in application layer for readability:

**Leaderboard types**:
- `longest-wear` - sorted by `max_wear`
- `most-frequently-worn` - sorted by `session_count`
- `total-time-worn` - sorted by `total_wear`
- `current-streak` - sorted by `streak_count` (or `streak_wear`)

**Rank calculation** (per leaderboard query, sorted by stat value):

```javascript
const stats = await statsSelectAll.all();

// Sort by the relevant stat (e.g., max_wear)
stats.sort((a, b) => b.maxWear - a.maxWear);

// Rank and points
stats.forEach((stat, i) => {
  stat.rank = i + 1;
  stat.points = calculatePoints(i, totalItems);
});

function calculatePoints(index, totalItems) {
  const top = 5 + Math.sqrt(totalItems);
  const ratio = totalItems / top;
  const bonus = Math.log10(ratio * (ratio + 1)) * Math.sqrt(ratio * 10);
  return Math.round(100000 / ratio + bonus);
}
```

This allows building separate leaderboards:
- `/api/leaderboard/category/:categoryId?stat=longest-wear`
- `/api/leaderboard/category/:categoryId?stat=most-frequently-worn`

### Injury Period Handling

**src/db/injury.js**:

```javascript
import db from './index';

export function getInjuredItem(sessionItem) {
  // Check if session item is injured
  const row = db.prepare(
    'SELECT occurred_at, heals_at FROM injuries WHERE item_id = ? AND heals_at > ? ORDER BY occurred_at DESC LIMIT 1'
  ).get(sessionItem.id, new Date());
  
  return row;
}

export function getHealedAt(sessionItem) {
  const injury = getInjuredItem(sessionItem);
  return injury ? injury.heals_at : null;
}

export function endInjury(item) {
  const injury = db.prepare(
    'UPDATE injuries SET heals_at = ? WHERE item_id = ?'
  ).run(new Date().toISOString(), item.id);
  
  return injury;
}
```

### Domain Logic

**src/db/calculations.js**:

```javascript
import db from './index';

// Rest calculation: rest = rest_multiplier * wear + rest_constant
export function calculateRest(wear, category) {
  const restMultiplier = category.rest_multiplier;
  const restConstant = category.rest_constant;
  return Math.floor(restMultiplier * wear + restConstant);
}

// Risk level calculation
export function getRiskLevel(wearTotal, category) {
  const riskLevels = typeof category.risk_levels === 'string' 
    ? JSON.parse(category.risk_levels) 
    : category.risk_levels;
    
  for (const level of riskLevels) {
    if (wearTotal > level.lower && wearTotal <= level.upper) {
      return level;
    }
  }
  return null; // safe zone
}

// Break decay calculation
export function calculateBreakWear(breakDuration, category) {
  const decayMultiplier = category.break_decay_multiplier;
  const wearPerHour = 60 * 60; // wear per hour (base)
  
  const decay = decayMultiplier ** (breakDuration / category.break_penalty_period);
  return Math.floor(wearPerHour * decay);
}
```

### Migrations Directory

**Migration files** (`src/db/migrations/`):

```
001_initial.js
```
