# Target & Maximum Wear Durations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split per-category initial wear into a target and an optional maximum, make minimum-rest and break-grace per-category, and rework the wear/rest engine to match `docs/design/duration-formula.md`.

**Architecture:** SQLite migrations 003 (additive + renames) and 004 (drop old columns) run on the same deploy. The wear/rest formula lives in one place — `src/backend/src/db/calculations.ts` — consumed by the session store and the `/sessions/current` controller (which returns *expected* next-session target/max so the frontend never re-implements the formula). The frontend gains a target marker on the progress bar and three new category-form fields.

**Tech Stack:** Node 24, Hono, better-sqlite3, TypeScript, Vue 3 + Konsta, Vitest, Playwright.

## Global Constraints

- The authoritative calculation source is `docs/design/duration-formula.md`. Where code and that doc disagree, the doc wins.
- All durations are seconds; all timestamps are Unix epoch seconds.
- `difficulty_modifier = 1 / item.difficulty_multiplier` (a 150% item is worn ~66% as long). The DB column stays `difficulty_multiplier`.
- `previous_session` is the most recently ended session for **any item in the category**, not per item.
- Elapsed wear is always derived as `ended_at - started_at`; it is never stored.
- `max` is `null` throughout whenever `initial_max_wear_duration_seconds` is null. When max is null there is no minimum-rest floor.
- Migrations are immutable history: do not edit 001/002. Tests that need the full schema run the migration runner, not a single migration.
- The null-max "lap counter" mechanic is OUT OF SCOPE (separate follow-up). When max is null the active bar fills toward target and caps at 100%.

---

### Task 1: Migrations 003 & 004 (schema)

**Files:**
- Create: `src/backend/src/db/migrations/003_target_max_wear.ts`
- Create: `src/backend/src/db/migrations/004_drop_legacy_columns.ts`
- Modify: `src/backend/src/db/migrations/index.ts`
- Test: `src/backend/tests/db/migration-003.test.ts`

**Interfaces:**
- Produces: categories columns `initial_target_wear_duration_seconds` (INT NOT NULL), `initial_max_wear_duration_seconds` (INT nullable), `break_grace_time` (INT NOT NULL), `minimum_rest` (REAL NOT NULL); sessions columns `max_wear_seconds`, `target_wear_seconds` (INT NOT NULL), `rest_seconds`. Removes categories columns `break_starts_after_seconds`, `initial_wear_duration_seconds`, `rest_constant_seconds`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/backend/tests/db/migration-003.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { dbExport } from '../../src/db/index.js';
import runMigration001 from '../../src/db/migrations/001_initial.js';
import runMigration003 from '../../src/db/migrations/003_target_max_wear.js';
import runMigration004 from '../../src/db/migrations/004_drop_legacy_columns.js';

beforeAll(() => {
  runMigration001();
  // Seed a pre-migration category + session using the OLD schema
  dbExport
    .prepare(
      `INSERT INTO categories
         (name, icon, initial_wear_duration_seconds, rest_multiplier, rest_constant_seconds,
          risk_levels, break_decay_multiplier, break_starts_after_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('Legacy', 'x', 1800, 2, 86400, '[]', 0.75, 604800);
  dbExport
    .prepare(
      `INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (1, 'i', '#fff', 1)`,
    )
    .run();
  dbExport
    .prepare(
      `INSERT INTO sessions (item_id, started_at, ended_at, calculated_wear_seconds, calculated_rest_seconds)
       VALUES (1, 100, 1000, 1800, 90000)`,
    )
    .run();
  runMigration003();
  runMigration004();
});

function categoryCols(): string[] {
  return (dbExport.prepare('PRAGMA table_info(categories)').all() as Array<{ name: string }>).map((r) => r.name);
}
function sessionCols(): string[] {
  return (dbExport.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>).map((r) => r.name);
}

describe('migration 003 + 004', () => {
  it('adds the new category columns and drops the legacy ones', () => {
    const cols = categoryCols();
    expect(cols).toContain('initial_target_wear_duration_seconds');
    expect(cols).toContain('initial_max_wear_duration_seconds');
    expect(cols).toContain('break_grace_time');
    expect(cols).toContain('minimum_rest');
    expect(cols).not.toContain('break_starts_after_seconds');
    expect(cols).not.toContain('initial_wear_duration_seconds');
    expect(cols).not.toContain('rest_constant_seconds');
  });

  it('renames + adds the session columns', () => {
    const cols = sessionCols();
    expect(cols).toContain('max_wear_seconds');
    expect(cols).toContain('target_wear_seconds');
    expect(cols).toContain('rest_seconds');
    expect(cols).not.toContain('calculated_wear_seconds');
    expect(cols).not.toContain('calculated_rest_seconds');
  });

  it('backfills category values from legacy data', () => {
    const cat = dbExport.prepare('SELECT * FROM categories WHERE id = 1').get() as Record<string, number>;
    expect(cat.initial_max_wear_duration_seconds).toBe(1800);
    expect(cat.initial_target_wear_duration_seconds).toBe(1200); // floor(1800 * 2/3)
    expect(cat.minimum_rest).toBe(86400);
    expect(cat.break_grace_time).toBe(86400);
    expect(cat.break_decay_multiplier).toBeCloseTo(0.91);
  });

  it('backfills session target as 2/3 of max', () => {
    const s = dbExport.prepare('SELECT * FROM sessions WHERE id = 1').get() as Record<string, number>;
    expect(s.max_wear_seconds).toBe(1800);
    expect(s.target_wear_seconds).toBe(1200);
    expect(s.rest_seconds).toBe(90000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && npx vitest run tests/db/migration-003.test.ts`
Expected: FAIL — cannot find module `003_target_max_wear.js`.

- [ ] **Step 3: Write migration 003**

```typescript
// src/backend/src/db/migrations/003_target_max_wear.ts
import { dbExport } from '../index.js';

export default function runMigration003() {
  dbExport.exec(`
    ALTER TABLE categories ADD COLUMN initial_target_wear_duration_seconds INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE categories ADD COLUMN initial_max_wear_duration_seconds INTEGER;
    ALTER TABLE categories ADD COLUMN break_grace_time INTEGER NOT NULL DEFAULT 86400;
    ALTER TABLE categories ADD COLUMN minimum_rest REAL NOT NULL DEFAULT 0;

    UPDATE categories SET
      initial_max_wear_duration_seconds    = initial_wear_duration_seconds,
      initial_target_wear_duration_seconds = CAST(initial_wear_duration_seconds * 2 / 3 AS INTEGER),
      minimum_rest                         = rest_constant_seconds,
      break_decay_multiplier               = 0.91;

    ALTER TABLE categories DROP COLUMN break_starts_after_seconds;

    ALTER TABLE sessions RENAME COLUMN calculated_wear_seconds TO max_wear_seconds;
    ALTER TABLE sessions ADD COLUMN target_wear_seconds INTEGER NOT NULL DEFAULT 0;
    UPDATE sessions SET target_wear_seconds = CAST(max_wear_seconds * 2 / 3 AS INTEGER);
    ALTER TABLE sessions RENAME COLUMN calculated_rest_seconds TO rest_seconds;
  `);
}
```

- [ ] **Step 4: Write migration 004**

```typescript
// src/backend/src/db/migrations/004_drop_legacy_columns.ts
import { dbExport } from '../index.js';

export default function runMigration004() {
  dbExport.exec(`
    ALTER TABLE categories DROP COLUMN initial_wear_duration_seconds;
    ALTER TABLE categories DROP COLUMN rest_constant_seconds;
  `);
}
```

- [ ] **Step 5: Register both migrations in the runner**

```typescript
// src/backend/src/db/migrations/index.ts — add imports and array entries
import runMigration003 from './003_target_max_wear.js';
import runMigration004 from './004_drop_legacy_columns.js';

const migrations: Array<{ version: number; name: string; run: () => void }> = [
  { version: 1, name: '001_initial', run: runMigration001 },
  { version: 2, name: '002_oklch_colors', run: runMigration002 },
  { version: 3, name: '003_target_max_wear', run: runMigration003 },
  { version: 4, name: '004_drop_legacy_columns', run: runMigration004 },
];
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd src/backend && npx vitest run tests/db/migration-003.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/backend/src/db/migrations/ src/backend/tests/db/migration-003.test.ts
git commit -m "feat(db): migrations 003/004 for target/max wear split"
```

---

### Task 2: Calculation engine rewrite

**Files:**
- Modify: `src/backend/src/db/calculations.ts` (full rewrite)
- Test: `src/backend/tests/db/calculations.test.ts` (full rewrite)

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `interface RiskLevel { lower: number|null; upper: number|null; text: string; severity: number; rest_weight?: number }`
  - `interface Category { id; name; icon; initial_target_wear_duration_seconds: number; initial_max_wear_duration_seconds: number|null; rest_multiplier: number; minimum_rest: number; risk_levels: string|RiskLevel[]; break_decay_multiplier: number; break_grace_time: number }`
  - `interface PreviousSession { target_wear_seconds: number; max_wear_seconds: number|null; ended_at: number; rest_seconds: number }`
  - `restWeight(index: number, count: number): number`
  - `parseRiskLevels(category: Category): RiskLevel[]` (each with `rest_weight`)
  - `riskLevelFor(elapsed: number, category: Category): RiskLevel | null`
  - `computeSessionStart(category: Category, item: { difficulty_multiplier: number }, previous: PreviousSession | null, startTime: number, injuryActive: boolean): { target: number; max: number | null }`
  - `computeRest(elapsed: number, sessionMax: number | null, category: Category, riskLevel: RiskLevel | null, injuryActive: boolean): number`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/backend/tests/db/calculations.test.ts
import { describe, it, expect } from 'vitest';
import {
  restWeight,
  riskLevelFor,
  computeSessionStart,
  computeRest,
  type Category,
} from '../../src/db/calculations.js';

const cat: Category = {
  id: 1,
  name: 'Test',
  icon: 'x',
  initial_target_wear_duration_seconds: 900,
  initial_max_wear_duration_seconds: 1800,
  rest_multiplier: 2,
  minimum_rest: 86400,
  risk_levels: [
    { lower: null, upper: 3600, text: 'Low', severity: 1 },
    { lower: 3600, upper: 7200, text: 'Med', severity: 2 },
    { lower: 7200, upper: null, text: 'High', severity: 3 },
  ],
  break_decay_multiplier: 0.91,
  break_grace_time: 86400,
};
const item = { difficulty_multiplier: 1 };

describe('restWeight', () => {
  it('is 0 for a single band', () => expect(restWeight(0, 1)).toBe(0));
  it('runs 0..2 across bands', () => {
    expect(restWeight(0, 3)).toBe(0);
    expect(restWeight(1, 3)).toBe(1);
    expect(restWeight(2, 3)).toBe(2);
  });
});

describe('riskLevelFor', () => {
  it('finds the band for an elapsed time', () => {
    expect(riskLevelFor(1800, cat)?.text).toBe('Low');
    expect(riskLevelFor(5000, cat)?.text).toBe('Med');
    expect(riskLevelFor(9000, cat)?.text).toBe('High');
  });
  it('attaches rest_weight by position', () => {
    expect(riskLevelFor(1800, cat)?.rest_weight).toBe(0);
    expect(riskLevelFor(9000, cat)?.rest_weight).toBe(2);
  });
});

describe('computeSessionStart', () => {
  it('first session uses difficulty * initial', () => {
    expect(computeSessionStart(cat, item, null, 0, false)).toEqual({ target: 900, max: 1800 });
  });

  it('first session applies difficulty modifier (1/1.5)', () => {
    const r = computeSessionStart(cat, { difficulty_multiplier: 1.5 }, null, 0, false);
    expect(r.target).toBe(Math.floor(900 / 1.5));
    expect(r.max).toBe(Math.floor(1800 / 1.5));
  });

  it('after rest, grows by difficulty * (prev + initial)', () => {
    const prev = { target_wear_seconds: 900, max_wear_seconds: 1800, ended_at: 0, rest_seconds: 100 };
    // earliest_start = 100; start at 200 (>= earliest, <= latest 100+86400)
    const r = computeSessionStart(cat, item, prev, 200, false);
    expect(r).toEqual({ target: 1800, max: 3600 });
  });

  it('inside rest period halves prev target/max', () => {
    const prev = { target_wear_seconds: 1000, max_wear_seconds: 2000, ended_at: 0, rest_seconds: 500 };
    const r = computeSessionStart(cat, item, prev, 100, false); // start < earliest_start(500)
    expect(r).toEqual({ target: 500, max: 1000 });
  });

  it('past grace applies daily decay', () => {
    const prev = { target_wear_seconds: 900, max_wear_seconds: 1800, ended_at: 0, rest_seconds: 0 };
    // latest_start = 0 + 0 + 86400. Start 2 days past latest_start => days_since_grace = 2
    const start = 86400 + 2 * 86400;
    const r = computeSessionStart(cat, item, prev, start, false);
    const grown = 900 + 900; // difficulty 1 * (prev.target + initial)
    expect(r.target).toBe(Math.floor(grown * 0.91 ** 2));
  });

  it('active injury halves the result', () => {
    const r = computeSessionStart(cat, item, null, 0, true);
    expect(r).toEqual({ target: 450, max: 900 });
  });

  it('null category max yields null max throughout', () => {
    const noMax = { ...cat, initial_max_wear_duration_seconds: null };
    expect(computeSessionStart(noMax, item, null, 0, false)).toEqual({ target: 900, max: null });
  });
});

describe('computeRest', () => {
  it('elapsed * (1 + rest_weight) * rest_multiplier, floored to minimum_rest', () => {
    // Low band (weight 0): 1800 * 1 * 2 = 3600, floored to 86400
    expect(computeRest(1800, 1800, cat, riskLevelFor(1800, cat), false)).toBe(86400);
  });

  it('high band raises the multiplier', () => {
    // High band weight 2: 9000 * 3 * 2 = 54000, still floored to 86400
    expect(computeRest(9000, 18000, cat, riskLevelFor(9000, cat), false)).toBe(86400);
  });

  it('adds 2x penalty for time over max', () => {
    // elapsed 100000 over max 1800: base = 100000*3*2=600000 (high band), +(100000-1800)*2
    const rest = computeRest(100000, 1800, cat, riskLevelFor(100000, cat), false);
    expect(rest).toBe(600000 + (100000 - 1800) * 2);
  });

  it('no minimum-rest floor when max is null', () => {
    const noMax = { ...cat, initial_max_wear_duration_seconds: null };
    // 10 * (1+0) * 2 = 20, no floor applied
    expect(computeRest(10, null, noMax, riskLevelFor(10, noMax), false)).toBe(20);
  });

  it('multiplies by 1.5 when injured', () => {
    expect(computeRest(1800, 1800, cat, riskLevelFor(1800, cat), true)).toBe(Math.floor(86400 * 1.5));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/backend && npx vitest run tests/db/calculations.test.ts`
Expected: FAIL — exports `restWeight`/`computeSessionStart`/etc. not defined.

- [ ] **Step 3: Rewrite calculations.ts**

```typescript
// src/backend/src/db/calculations.ts
export interface RiskLevel {
  lower: number | null;
  upper: number | null;
  text: string;
  severity: number;
  rest_weight?: number;
}

export interface Category {
  id: number;
  name: string;
  icon: string;
  initial_target_wear_duration_seconds: number;
  initial_max_wear_duration_seconds: number | null;
  rest_multiplier: number;
  minimum_rest: number;
  risk_levels: string | RiskLevel[];
  break_decay_multiplier: number;
  break_grace_time: number;
}

export interface PreviousSession {
  target_wear_seconds: number;
  max_wear_seconds: number | null;
  ended_at: number;
  rest_seconds: number;
}

/** Normalised rest contribution for a 0-indexed band among `count` bands: 0 (lowest) .. 2 (highest). */
export function restWeight(index: number, count: number): number {
  return count > 1 ? 2 * (index / (count - 1)) : 0;
}

/** Parse risk_levels and attach rest_weight by ordered position. */
export function parseRiskLevels(category: Category): RiskLevel[] {
  const levels =
    typeof category.risk_levels === 'string'
      ? (JSON.parse(category.risk_levels) as RiskLevel[])
      : category.risk_levels;
  return levels.map((l, i) => ({ ...l, rest_weight: restWeight(i, levels.length) }));
}

/** Risk band whose [lower, upper) range contains `elapsed`, or null below the first threshold. */
export function riskLevelFor(elapsed: number, category: Category): RiskLevel | null {
  const levels = parseRiskLevels(category);
  for (const level of levels) {
    const aboveLower = level.lower === null || elapsed > level.lower;
    const belowUpper = level.upper === null || elapsed <= level.upper;
    if (aboveLower && belowUpper) return level;
  }
  return null;
}

/** Session-Start formula from docs/design/duration-formula.md. */
export function computeSessionStart(
  category: Category,
  item: { difficulty_multiplier: number },
  previous: PreviousSession | null,
  startTime: number,
  injuryActive: boolean,
): { target: number; max: number | null } {
  const dm = 1 / item.difficulty_multiplier;
  const maxIsSet = category.initial_max_wear_duration_seconds !== null;

  let target: number;
  let max: number | null;

  if (previous) {
    const earliestStart = previous.ended_at + previous.rest_seconds;
    const latestStart = earliestStart + category.break_grace_time;

    if (startTime < earliestStart) {
      target = previous.target_wear_seconds / 2;
      max = maxIsSet ? (previous.max_wear_seconds ?? 0) / 2 : null;
    } else {
      target = dm * (previous.target_wear_seconds + category.initial_target_wear_duration_seconds);
      max = maxIsSet
        ? dm * ((previous.max_wear_seconds ?? 0) + category.initial_max_wear_duration_seconds!)
        : null;
    }

    if (startTime > latestStart) {
      const daysSinceGrace = Math.floor((startTime - latestStart) / 86400);
      const decay = category.break_decay_multiplier ** daysSinceGrace;
      target *= decay;
      if (max !== null) max *= decay;
    }
  } else {
    target = dm * category.initial_target_wear_duration_seconds;
    max = maxIsSet ? dm * category.initial_max_wear_duration_seconds! : null;
  }

  if (injuryActive) {
    target /= 2;
    if (max !== null) max /= 2;
  }

  return { target: Math.floor(target), max: max === null ? null : Math.floor(max) };
}

/** Session-End rest formula from docs/design/duration-formula.md. */
export function computeRest(
  elapsed: number,
  sessionMax: number | null,
  category: Category,
  riskLevel: RiskLevel | null,
  injuryActive: boolean,
): number {
  const weight = riskLevel?.rest_weight ?? 0;
  const combined = (1 + weight) * category.rest_multiplier;
  let rest = elapsed * combined;

  if (sessionMax !== null && elapsed > sessionMax) {
    rest += (elapsed - sessionMax) * 2;
  }

  const maxIsSet = category.initial_max_wear_duration_seconds !== null;
  rest = Math.max(rest, maxIsSet ? category.minimum_rest : 0);

  if (injuryActive) rest *= 1.5;

  return Math.floor(rest);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/backend && npx vitest run tests/db/calculations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/db/calculations.ts src/backend/tests/db/calculations.test.ts
git commit -m "feat(calc): target/max session-start and risk-weighted rest"
```

---

### Task 3: Category store

**Files:**
- Modify: `src/backend/src/db/stores/category-store.ts`
- Test: `src/backend/tests/categories/controller.test.ts` (fixture + setup updates only in this task; full controller behaviour in Task 6)

**Interfaces:**
- Consumes: `Category` shape from Task 2.
- Produces: `CategoryRow`/`Category`/`CategoryCreate` with fields `initial_target_wear_duration_seconds: number`, `initial_max_wear_duration_seconds: number | null`, `rest_multiplier`, `minimum_rest: number`, `risk_levels`, `break_decay_multiplier`, `break_grace_time: number`. `create`/`update`/`find` operate on the new column set.

- [ ] **Step 1: Update the controller test setup to run the full migration chain and new fixtures**

Replace the import + fixture at the top of `src/backend/tests/categories/controller.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../src/server.js';
import { runMigrations } from '../../src/db/migrations/index.js';

const BASE = '/api/categories';
const ITEMS = '/api/items';
const SESSIONS = '/api/sessions';

const sampleCategory = {
  name: 'Footwear',
  icon: 'figure.walk',
  initial_target_wear_duration_seconds: 900,
  initial_max_wear_duration_seconds: 1800,
  rest_multiplier: 6,
  minimum_rest: 86400,
  risk_levels: [
    { lower: null, upper: 14400, text: 'safe', severity: 1 },
    { lower: 14400, upper: 28800, text: 'moderate', severity: 2 },
    { lower: 28800, upper: null, text: 'high', severity: 3 },
  ],
  break_decay_multiplier: 0.91,
  break_grace_time: 86400,
};

beforeAll(() => {
  runMigrations();
});
```

- [ ] **Step 2: Run the store-shape assertion to verify failure**

Run: `cd src/backend && npx vitest run tests/categories/controller.test.ts -t "creates a category"`
Expected: FAIL — store still references `initial_wear_duration_seconds`/`rest_constant_seconds`.

- [ ] **Step 3: Rewrite category-store.ts for the new columns**

```typescript
// src/backend/src/db/stores/category-store.ts
import db from '../index.js';
import type { RiskLevel } from '../calculations.js';

interface CategoryRow {
  id: number;
  name: string;
  icon: string;
  initial_target_wear_duration_seconds: number;
  initial_max_wear_duration_seconds: number | null;
  rest_multiplier: number;
  minimum_rest: number;
  risk_levels: string;
  break_decay_multiplier: number;
  break_grace_time: number;
}

export interface Category extends Omit<CategoryRow, 'risk_levels'> {
  risk_levels: RiskLevel[];
}

export interface CategoryCreate {
  name: string;
  icon: string;
  initial_target_wear_duration_seconds: number;
  initial_max_wear_duration_seconds: number | null;
  rest_multiplier: number;
  minimum_rest: number;
  risk_levels: RiskLevel[];
  break_decay_multiplier: number;
  break_grace_time: number;
}

export type CategoryUpdate = Partial<CategoryCreate>;

function deserialize(row: CategoryRow): Category {
  return { ...row, risk_levels: JSON.parse(row.risk_levels) as RiskLevel[] };
}

class CategoryStore {
  findAll(): Category[] {
    return (db.prepare('SELECT * FROM categories ORDER BY id').all() as CategoryRow[]).map(deserialize);
  }

  find(id: number): Category | undefined {
    const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
    return row ? deserialize(row) : undefined;
  }

  /** Raw DB row (risk_levels as JSON string) — used by calculation callers. */
  findRaw(id: number): CategoryRow | undefined {
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
  }

  create(data: CategoryCreate): Category {
    const result = db
      .prepare(
        `INSERT INTO categories
           (name, icon, initial_target_wear_duration_seconds, initial_max_wear_duration_seconds,
            rest_multiplier, minimum_rest, risk_levels, break_decay_multiplier, break_grace_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.name,
        data.icon,
        data.initial_target_wear_duration_seconds,
        data.initial_max_wear_duration_seconds,
        data.rest_multiplier,
        data.minimum_rest,
        JSON.stringify(data.risk_levels),
        data.break_decay_multiplier,
        data.break_grace_time,
      );
    const category = this.find(result.lastInsertRowid as number)!;
    db.prepare('INSERT OR IGNORE INTO category_stats (category_id) VALUES (?)').run(category.id);
    return category;
  }

  update(id: number, data: CategoryUpdate): Category {
    const dbData: Record<string, unknown> = { ...data };
    if (data.risk_levels !== undefined) {
      dbData.risk_levels = JSON.stringify(data.risk_levels);
    }
    const keys = Object.keys(dbData);
    const setClauses = keys.map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE categories SET ${setClauses} WHERE id = ?`).run(...Object.values(dbData), id);
    return this.find(id)!;
  }

  delete(id: number): void {
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  }
}

export const categoryStore = new CategoryStore();
```

- [ ] **Step 4: Run the create test to verify it passes**

Run: `cd src/backend && npx vitest run tests/categories/controller.test.ts -t "creates a category"`
Expected: PASS. (Other tests in the file are fixed in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/db/stores/category-store.ts src/backend/tests/categories/controller.test.ts
git commit -m "feat(store): category store for target/max/grace/min-rest columns"
```

---

### Task 4: Session store

**Files:**
- Modify: `src/backend/src/db/stores/session-store.ts`
- Modify: `src/backend/src/db/stores/injury-store.ts` (add `hasActiveInCategory`, fix `lastSessionWear`)
- Test: `src/backend/tests/sessions/controller.test.ts` (setup + fixtures), `src/backend/tests/db/session-store.test.ts` (new)

**Interfaces:**
- Consumes: `computeSessionStart`, `computeRest`, `riskLevelFor`, `PreviousSession` (Task 2); `Category` raw row (Task 3).
- Produces:
  - `Session { id; item_id; started_at; ended_at: number|null; target_wear_seconds: number; max_wear_seconds: number|null; rest_seconds: number|null; ended_in_injury: number }`
  - `start(itemId: number, category: CategoryRow, item: { difficulty_multiplier: number }, startedAt: number): Session`
  - `end(session: Session, category: CategoryRow, endedAt: number): Session`
  - `findLastEndedInCategory(categoryId: number): PreviousSession | undefined`
  - `ItemWithLastSession { item_id; category_id; name; color; difficulty_multiplier; ended_at: number|null; started_at: number|null; target_wear_seconds: number|null; max_wear_seconds: number|null; rest_seconds: number|null }`
  - `injuryStore.hasActiveInCategory(categoryId: number): boolean`

- [ ] **Step 1: Write failing store tests**

```typescript
// src/backend/tests/db/session-store.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import db from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrations/index.js';
import { sessionStore } from '../../src/db/stores/session-store.js';
import { categoryStore } from '../../src/db/stores/category-store.js';

beforeAll(() => {
  runMigrations();
  categoryStore.create({
    name: 'C', icon: 'x',
    initial_target_wear_duration_seconds: 900,
    initial_max_wear_duration_seconds: 1800,
    rest_multiplier: 2, minimum_rest: 86400,
    risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
    break_decay_multiplier: 0.91, break_grace_time: 86400,
  });
  db.prepare(`INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (1,'i','#fff',1)`).run();
});

const rawCat = () => db.prepare('SELECT * FROM categories WHERE id = 1').get() as never;
const item = { difficulty_multiplier: 1 };

describe('sessionStore.start', () => {
  it('writes target and max at start (first session = initial values)', () => {
    const s = sessionStore.start(1, rawCat(), item, 1000);
    expect(s.target_wear_seconds).toBe(900);
    expect(s.max_wear_seconds).toBe(1800);
    expect(s.ended_at).toBeNull();
  });
});

describe('sessionStore.end', () => {
  it('derives elapsed and writes rest_seconds without changing target/max', () => {
    const started = sessionStore.start(1, rawCat(), item, 10_000);
    const ended = sessionStore.end(started, rawCat(), 10_000 + 1800);
    expect(ended.target_wear_seconds).toBe(900); // unchanged
    expect(ended.max_wear_seconds).toBe(1800); // unchanged
    // elapsed 1800, weight 0, mult 2 => 3600, floored to minimum_rest 86400
    expect(ended.rest_seconds).toBe(86400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src/backend && npx vitest run tests/db/session-store.test.ts`
Expected: FAIL — `start` signature/columns mismatch.

- [ ] **Step 3: Add injury helpers**

In `src/backend/src/db/stores/injury-store.ts`, add a per-category check and fix `lastSessionWear` to derive elapsed:

```typescript
  hasActiveInCategory(categoryId: number): boolean {
    const row = db
      .prepare(
        `SELECT 1 FROM injuries inj
         JOIN items i ON i.id = inj.item_id
         WHERE i.category_id = ? AND inj.healed_at IS NULL LIMIT 1`,
      )
      .get(categoryId);
    return row !== undefined;
  }

  /** Elapsed (ended_at - started_at) of the most recent ended session for an item. */
  lastSessionWear(itemId: number): number {
    const row = db
      .prepare(
        `SELECT (ended_at - started_at) AS elapsed FROM sessions
         WHERE item_id = ? AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1`,
      )
      .get(itemId) as { elapsed: number } | undefined;
    return row?.elapsed ?? 0;
  }
```

- [ ] **Step 4: Rewrite session-store.ts**

```typescript
// src/backend/src/db/stores/session-store.ts
import db from '../index.js';
import {
  computeSessionStart,
  computeRest,
  riskLevelFor,
  type Category,
  type PreviousSession,
} from '../calculations.js';
import { statsStore } from './stats-store.js';
import { injuryStore } from './injury-store.js';

export interface Session {
  id: number;
  item_id: number;
  started_at: number;
  ended_at: number | null;
  target_wear_seconds: number;
  max_wear_seconds: number | null;
  rest_seconds: number | null;
  ended_in_injury: number;
}

export interface OpenSessionWithItem extends Session {
  category_id: number;
  item_name: string;
  item_color: string;
  item_difficulty_multiplier: number;
}

export interface ItemWithLastSession {
  item_id: number;
  category_id: number;
  name: string;
  color: string;
  difficulty_multiplier: number;
  ended_at: number | null;
  started_at: number | null;
  target_wear_seconds: number | null;
  max_wear_seconds: number | null;
  rest_seconds: number | null;
}

class SessionStore {
  findAllLastSessions(): ItemWithLastSession[] {
    return db
      .prepare(
        `SELECT
           i.id AS item_id, i.category_id, i.name, i.color, i.difficulty_multiplier,
           s.ended_at, s.started_at, s.target_wear_seconds, s.max_wear_seconds, s.rest_seconds
         FROM items i
         LEFT JOIN sessions s ON s.id = (
           SELECT id FROM sessions
           WHERE item_id = i.id AND ended_at IS NOT NULL
           ORDER BY ended_at DESC LIMIT 1
         )`,
      )
      .all() as ItemWithLastSession[];
  }

  findAll(itemId?: number): Session[] {
    if (itemId !== undefined) {
      return db.prepare('SELECT * FROM sessions WHERE item_id = ? ORDER BY started_at DESC').all(itemId) as Session[];
    }
    return db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all() as Session[];
  }

  find(id: number): Session | undefined {
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;
  }

  /** Most recently ended session for ANY item in the category (the formula's previous_session). */
  findLastEndedInCategory(categoryId: number): PreviousSession | undefined {
    return db
      .prepare(
        `SELECT s.target_wear_seconds, s.max_wear_seconds, s.ended_at, s.rest_seconds
         FROM sessions s JOIN items i ON i.id = s.item_id
         WHERE i.category_id = ? AND s.ended_at IS NOT NULL AND s.ended_in_injury = 0
         ORDER BY s.ended_at DESC LIMIT 1`,
      )
      .get(categoryId) as PreviousSession | undefined;
  }

  findOpenInCategory(categoryId: number): { session_id: number; item_id: number; item_name: string } | undefined {
    return db
      .prepare(
        `SELECT s.id AS session_id, i.id AS item_id, i.name AS item_name
         FROM sessions s JOIN items i ON i.id = s.item_id
         WHERE i.category_id = ? AND s.ended_at IS NULL`,
      )
      .get(categoryId) as { session_id: number; item_id: number; item_name: string } | undefined;
  }

  findOpenForItem(itemId: number): { id: number } | undefined {
    return db.prepare('SELECT id FROM sessions WHERE item_id = ? AND ended_at IS NULL').get(itemId) as
      | { id: number }
      | undefined;
  }

  findOpenWithItemData(): OpenSessionWithItem[] {
    return db
      .prepare(
        `SELECT s.*, i.category_id, i.name AS item_name, i.color AS item_color,
                i.difficulty_multiplier AS item_difficulty_multiplier
         FROM sessions s JOIN items i ON i.id = s.item_id
         WHERE s.ended_at IS NULL`,
      )
      .all() as OpenSessionWithItem[];
  }

  /** Start a new session. category is the raw DB row; item supplies difficulty. */
  start(itemId: number, category: Category, item: { difficulty_multiplier: number }, startedAt: number): Session {
    const previous = this.findLastEndedInCategory(category.id) ?? null;
    const injuryActive = injuryStore.hasActiveInCategory(category.id);
    const { target, max } = computeSessionStart(category, item, previous, startedAt, injuryActive);

    const result = db
      .prepare(
        'INSERT INTO sessions (item_id, started_at, target_wear_seconds, max_wear_seconds) VALUES (?, ?, ?, ?)',
      )
      .run(itemId, startedAt, target, max);
    return this.find(result.lastInsertRowid as number)!;
  }

  /** End a session: derive elapsed, compute rest, persist; target/max stay as set at start. */
  end(session: Session, category: Category, endedAt: number): Session {
    return db.transaction(() => {
      const elapsed = endedAt - session.started_at;
      const injuryActive = injuryStore.hasActiveInCategory(category.id);
      const riskLevel = riskLevelFor(elapsed, category);
      const rest = computeRest(elapsed, session.max_wear_seconds, category, riskLevel, injuryActive);

      db.prepare('UPDATE sessions SET ended_at = ?, rest_seconds = ? WHERE id = ?').run(endedAt, rest, session.id);

      const updated = this.find(session.id)!;
      const snapshot = { ...updated, ended_at: endedAt };
      statsStore.recordItemSession(snapshot);
      statsStore.recordCategorySession(category.id, category.break_grace_time, snapshot);
      return updated;
    })();
  }

  endWithInjury(sessionId: number, endedAt: number): void {
    db.prepare('UPDATE sessions SET ended_at = ?, ended_in_injury = 1 WHERE id = ?').run(endedAt, sessionId);
  }
}

export const sessionStore = new SessionStore();
```

Note: `start`/`end` are typed to accept `Category`, and `findRaw` returns a `CategoryRow` whose shape is structurally compatible (risk_levels as string is allowed by the `Category` union). The controller passes `findRaw(...)` as before.

- [ ] **Step 5: Run store tests to verify they pass**

Run: `cd src/backend && npx vitest run tests/db/session-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/backend/src/db/stores/session-store.ts src/backend/src/db/stores/injury-store.ts src/backend/tests/db/session-store.test.ts
git commit -m "feat(store): session start/end on target/max + per-category previous & injury"
```

---

### Task 5: Stats store

**Files:**
- Modify: `src/backend/src/db/stores/stats-store.ts`
- Test: `src/backend/tests/sessions/controller.test.ts` covers via integration (Task 7); add a focused unit test here.
- Test: `src/backend/tests/db/stats-store.test.ts` (new)

**Interfaces:**
- Consumes: `Session` snapshot from Task 4.
- Produces:
  - `SessionSnapshot { id; item_id; started_at; ended_at: number; target_wear_seconds: number; max_wear_seconds: number | null; rest_seconds: number | null }`
  - `recordItemSession(session: SessionSnapshot): void` — wear metric = `ended_at - started_at`.
  - `recordCategorySession(categoryId: number, breakGraceTime: number, session: SessionSnapshot): void`.

- [ ] **Step 1: Write failing stats test**

```typescript
// src/backend/tests/db/stats-store.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import db from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrations/index.js';
import { statsStore } from '../../src/db/stores/stats-store.js';
import { categoryStore } from '../../src/db/stores/category-store.js';

beforeAll(() => {
  runMigrations();
  categoryStore.create({
    name: 'C', icon: 'x',
    initial_target_wear_duration_seconds: 900, initial_max_wear_duration_seconds: 1800,
    rest_multiplier: 2, minimum_rest: 0,
    risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
    break_decay_multiplier: 0.91, break_grace_time: 86400,
  });
  db.prepare(`INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (1,'i','#fff',1)`).run();
  statsStore.initItem(1);
});

describe('recordItemSession', () => {
  it('counts wear as elapsed (ended_at - started_at), not the stored max', () => {
    statsStore.recordItemSession({
      id: 1, item_id: 1, started_at: 100, ended_at: 100 + 3600,
      target_wear_seconds: 900, max_wear_seconds: 1800, rest_seconds: 0,
    });
    const stats = statsStore.findForItem(1)!;
    expect(stats.total_wear_seconds).toBe(3600);
    expect(stats.max_single_session_wear_seconds).toBe(3600);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src/backend && npx vitest run tests/db/stats-store.test.ts`
Expected: FAIL — `SessionSnapshot` references removed `calculated_wear_seconds`.

- [ ] **Step 3: Update stats-store.ts**

Change the snapshot type, both record methods, and `history()`:

```typescript
// SessionSnapshot
export interface SessionSnapshot {
  id: number;
  item_id: number;
  started_at: number;
  ended_at: number;
  target_wear_seconds: number;
  max_wear_seconds: number | null;
  rest_seconds: number | null;
}
```

```typescript
  recordItemSession(session: SessionSnapshot): void {
    const duration = session.ended_at - session.started_at;
    db.prepare(`
      UPDATE stats SET
        total_wear_seconds              = total_wear_seconds + ?,
        session_count                   = session_count + 1,
        max_single_session_wear_seconds = MAX(max_single_session_wear_seconds, ?)
      WHERE item_id = ?
    `).run(duration, duration, session.item_id);
  }
```

```typescript
  history(itemId: number, unit: 'month' | 'week'): unknown[] {
    const format = unit === 'month' ? '%Y-%m' : '%Y-%W';
    return db
      .prepare(
        `SELECT strftime('${format}', datetime(ended_at, 'unixepoch')) AS period,
                SUM(ended_at - started_at) AS total_wear_seconds,
                COUNT(*) AS session_count
         FROM sessions
         WHERE item_id = ? AND ended_at IS NOT NULL
         GROUP BY period ORDER BY period ASC`,
      )
      .all(itemId);
  }
```

```typescript
  recordCategorySession(categoryId: number, breakGraceTime: number, session: SessionSnapshot): void {
    const stats = db
      .prepare('SELECT * FROM category_stats WHERE category_id = ?')
      .get(categoryId) as CategoryStats | undefined;
    if (!stats) return;

    const duration = session.ended_at - session.started_at;

    const prev = db
      .prepare(
        `SELECT s.* FROM sessions s JOIN items i ON i.id = s.item_id
         WHERE i.category_id = ? AND s.ended_at IS NOT NULL AND s.id != ?
         ORDER BY s.ended_at DESC LIMIT 1`,
      )
      .get(categoryId, session.id) as
      | { ended_at: number; rest_seconds: number | null }
      | undefined;

    let streakWear = stats.streak_wear_seconds + duration;
    let streakCount = stats.streak_count + 1;

    if (prev && prev.rest_seconds !== null) {
      const breakSeconds = session.started_at - prev.ended_at;
      if (breakSeconds > prev.rest_seconds + breakGraceTime) {
        streakWear = duration;
        streakCount = 1;
      }
    }

    const newBestStreakWear = Math.max(stats.best_streak_wear_seconds, streakWear);
    const newBestStreakCount =
      streakWear > stats.best_streak_wear_seconds ? streakCount : stats.best_streak_count;

    db.prepare(`
      UPDATE category_stats SET
        total_wear_seconds              = total_wear_seconds + ?,
        session_count                   = session_count + 1,
        max_single_session_wear_seconds = MAX(max_single_session_wear_seconds, ?),
        streak_wear_seconds             = ?, streak_count = ?,
        best_streak_wear_seconds        = ?, best_streak_count = ?
      WHERE category_id = ?
    `).run(duration, duration, streakWear, streakCount, newBestStreakWear, newBestStreakCount, categoryId);
  }
```

Also delete the now-unused `const GRACE_SECONDS = 24 * 3600;` line.

- [ ] **Step 4: Run to verify pass**

Run: `cd src/backend && npx vitest run tests/db/stats-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/db/stores/stats-store.ts src/backend/tests/db/stats-store.test.ts
git commit -m "feat(stats): derive wear from elapsed; per-category break grace for streaks"
```

---

### Task 6: Categories controller validation

**Files:**
- Modify: `src/backend/src/controllers/categories.ts`
- Test: `src/backend/tests/categories/controller.test.ts`

**Interfaces:**
- Consumes: `categoryStore` (Task 3).
- Produces: POST/PATCH accept `initial_target_wear_duration_seconds` (number), `initial_max_wear_duration_seconds` (number | null), `rest_multiplier`, `minimum_rest` (number), `risk_levels`, `break_decay_multiplier`, `break_grace_time` (number).

- [ ] **Step 1: Add validation tests**

Append to `src/backend/tests/categories/controller.test.ts`:

```typescript
describe('target/max validation', () => {
  it('accepts a null maximum', async () => {
    const res = await createCategory({ name: 'NoMax', initial_max_wear_duration_seconds: null });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.initial_max_wear_duration_seconds).toBeNull();
  });

  it('rejects a non-number, non-null maximum', async () => {
    const res = await createCategory({ initial_max_wear_duration_seconds: 'nope' });
    expect(res.status).toBe(400);
  });

  it('rejects a missing target', async () => {
    const res = await createCategory({ initial_target_wear_duration_seconds: undefined });
    expect(res.status).toBe(400);
  });

  it('patches break_grace_time and minimum_rest', async () => {
    const created = await (await createCategory({ name: 'Patchable' })).json();
    const res = await app.request(`${BASE}/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ break_grace_time: 3600, minimum_rest: 1200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.break_grace_time).toBe(3600);
    expect(body.minimum_rest).toBe(1200);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src/backend && npx vitest run tests/categories/controller.test.ts`
Expected: FAIL — controller still validates old field names.

- [ ] **Step 3: Update categories.ts POST and PATCH**

Replace the destructuring + validation in POST:

```typescript
  const {
    name, icon,
    initial_target_wear_duration_seconds,
    initial_max_wear_duration_seconds,
    rest_multiplier, minimum_rest, risk_levels,
    break_decay_multiplier, break_grace_time,
  } = body;

  if (!name || typeof name !== 'string') throw new ValidationError('name is required');
  if (!icon || typeof icon !== 'string') throw new ValidationError('icon is required');
  if (typeof initial_target_wear_duration_seconds !== 'number')
    throw new ValidationError('initial_target_wear_duration_seconds must be a number');
  if (initial_max_wear_duration_seconds !== null && typeof initial_max_wear_duration_seconds !== 'number')
    throw new ValidationError('initial_max_wear_duration_seconds must be a number or null');
  if (typeof rest_multiplier !== 'number') throw new ValidationError('rest_multiplier must be a number');
  if (typeof minimum_rest !== 'number') throw new ValidationError('minimum_rest must be a number');
  if (!validateRiskLevels(risk_levels)) throw new ValidationError('risk_levels must be an array of valid risk level objects');
  if (typeof break_decay_multiplier !== 'number') throw new ValidationError('break_decay_multiplier must be a number');
  if (typeof break_grace_time !== 'number') throw new ValidationError('break_grace_time must be a number');

  const category = categoryStore.create({
    name, icon,
    initial_target_wear_duration_seconds,
    initial_max_wear_duration_seconds,
    rest_multiplier, minimum_rest, risk_levels,
    break_decay_multiplier, break_grace_time,
  });
  return c.json(category, 201);
```

Replace the PATCH field-by-field block with:

```typescript
  if ('name' in body) {
    if (typeof body.name !== 'string') throw new ValidationError('name must be a string');
    updates.name = body.name;
  }
  if ('icon' in body) {
    if (typeof body.icon !== 'string') throw new ValidationError('icon must be a string');
    updates.icon = body.icon;
  }
  if ('initial_target_wear_duration_seconds' in body) {
    if (typeof body.initial_target_wear_duration_seconds !== 'number')
      throw new ValidationError('initial_target_wear_duration_seconds must be a number');
    updates.initial_target_wear_duration_seconds = body.initial_target_wear_duration_seconds;
  }
  if ('initial_max_wear_duration_seconds' in body) {
    if (body.initial_max_wear_duration_seconds !== null && typeof body.initial_max_wear_duration_seconds !== 'number')
      throw new ValidationError('initial_max_wear_duration_seconds must be a number or null');
    updates.initial_max_wear_duration_seconds = body.initial_max_wear_duration_seconds;
  }
  if ('rest_multiplier' in body) {
    if (typeof body.rest_multiplier !== 'number') throw new ValidationError('rest_multiplier must be a number');
    updates.rest_multiplier = body.rest_multiplier;
  }
  if ('minimum_rest' in body) {
    if (typeof body.minimum_rest !== 'number') throw new ValidationError('minimum_rest must be a number');
    updates.minimum_rest = body.minimum_rest;
  }
  if ('risk_levels' in body) {
    if (!validateRiskLevels(body.risk_levels)) throw new ValidationError('risk_levels must be an array of valid risk level objects');
    updates.risk_levels = body.risk_levels;
  }
  if ('break_decay_multiplier' in body) {
    if (typeof body.break_decay_multiplier !== 'number') throw new ValidationError('break_decay_multiplier must be a number');
    updates.break_decay_multiplier = body.break_decay_multiplier;
  }
  if ('break_grace_time' in body) {
    if (typeof body.break_grace_time !== 'number') throw new ValidationError('break_grace_time must be a number');
    updates.break_grace_time = body.break_grace_time;
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd src/backend && npx vitest run tests/categories/controller.test.ts`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/controllers/categories.ts src/backend/tests/categories/controller.test.ts
git commit -m "feat(api): validate target/max/grace/min-rest on category create & patch"
```

---

### Task 7: Sessions & injuries controllers (expected target/max + renames)

**Files:**
- Modify: `src/backend/src/controllers/sessions.ts`
- Modify: `src/backend/src/controllers/injuries.ts`
- Test: `src/backend/tests/sessions/controller.test.ts`, `src/backend/tests/injuries/controller.test.ts`, `src/backend/tests/items/controller.test.ts`, `src/backend/tests/leaderboards/controller.test.ts`

**Interfaces:**
- Consumes: `sessionStore.start/end/findLastEndedInCategory` (Task 4), `computeSessionStart` (Task 2), `injuryStore.hasActiveInCategory` (Task 4), `riskLevelFor` (Task 2).
- Produces: `GET /api/sessions/current` entries where each item in `items[]` gains `expected_target: number` and `expected_max: number | null`; active `session` object exposes `target_wear_seconds`, `max_wear_seconds`, `rest_seconds`.

- [ ] **Step 1: Migrate all backend controller test fixtures to the new schema**

Every controller test POSTs a category and so breaks under the new validation (Task 6). In each of `tests/sessions/controller.test.ts`, `tests/injuries/controller.test.ts`, `tests/items/controller.test.ts`, and `tests/leaderboards/controller.test.ts`:

1. Change the migration import/call from the single `runMigration` (001) to the full runner:

```typescript
import { runMigrations } from '../../src/db/migrations/index.js';
// ... in beforeAll:
runMigrations();
```

2. Replace the shared `sampleCategory` object's formula fields with:

```typescript
  initial_target_wear_duration_seconds: 900,
  initial_max_wear_duration_seconds: 1800,
  rest_multiplier: 6,
  minimum_rest: 86400,
  risk_levels: [
    { lower: null, upper: 14400, text: 'safe', severity: 1 },
    { lower: 14400, upper: 28800, text: 'moderate', severity: 2 },
    { lower: 28800, upper: null, text: 'high', severity: 3 },
  ],
  break_decay_multiplier: 0.91,
  break_grace_time: 86400,
```

(Remove the old `initial_wear_duration_seconds`, `rest_constant_seconds`, `break_starts_after_seconds` keys.)

In `tests/sessions/controller.test.ts` there is also a second, inline category posted inside the `lists the item with null last-session fields` test (~line 267) — replace its formula fields the same way, keeping its single-band `risk_levels: [{ lower: null, upper: null, text: 'safe', severity: 1 }]`.

- [ ] **Step 2: Rewrite the session-shape assertions in sessions/controller.test.ts**

The session object no longer has `calculated_wear_seconds`/`calculated_rest_seconds`. Apply these exact replacements:

- In `starts a session and returns 201` (~line 70):
  ```typescript
    expect(body.target_wear_seconds).toBeTypeOf('number');
    expect(body.max_wear_seconds).toBeTypeOf('number');
  ```
- Retitle and rewrite `ends a session and sets calculated_wear_seconds and calculated_rest_seconds` (~line 132):
  ```typescript
  it('ends a session, leaves target/max unchanged, and sets rest_seconds', async () => {
    const started = await (await startSession()).json();
    const res = await endSession(started.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ended_at).toBeTypeOf('number');
    expect(body.target_wear_seconds).toBe(started.target_wear_seconds);
    expect(body.max_wear_seconds).toBe(started.max_wear_seconds);
    expect(body.rest_seconds).toBeTypeOf('number');
    expect(body.rest_seconds).toBeGreaterThan(0);
  });
  ```
- In `accepts an explicit ended_at timestamp` (~line 151), replace the final wear assertion with a rest check (1h elapsed, safe band, floored to minimum_rest 86400):
  ```typescript
    expect(body.rest_seconds).toBe(86400);
  ```
- In `lists the item with null last-session fields` (~line 298):
  ```typescript
    expect(ourItem.target_wear_seconds).toBeNull();
    expect(ourItem.max_wear_seconds).toBeNull();
    expect(ourItem.rest_seconds).toBeNull();
  ```
- In `populates last-session fields after a session ends` (~line 313):
  ```typescript
    expect(ourItem.max_wear_seconds).toBeTypeOf('number');
    expect(ourItem.rest_seconds).toBeTypeOf('number');
  ```

- [ ] **Step 3: Add the expected-durations test**

Append to `tests/sessions/controller.test.ts`:

```typescript
describe('GET /api/sessions/current expected durations', () => {
  it('returns expected_target/expected_max for an idle item (first session)', async () => {
    // sampleCategory: target 900, max 1800; Test Shoe difficulty 1; idle
    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === categoryId);
    const ourItem = entry.items.find((i: { item_id: number }) => i.item_id === itemId);
    expect(ourItem.expected_target).toBe(900);
    expect(ourItem.expected_max).toBe(1800);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `cd src/backend && npx vitest run tests/sessions/controller.test.ts`
Expected: FAIL — controller does not yet emit `expected_target`; `start` signature mismatch.

- [ ] **Step 5: Update sessions controller**

In `/start`, pass the item to `start`:

```typescript
  const category = categoryStore.findRaw(item.category_id)!;
  const startTs = typeof started_at === 'number' ? started_at : nowSeconds();
  const session = sessionStore.start(item_id, category, item, startTs);
  return c.json(session, 201);
```

Rewrite the `/current` handler to attach expected durations and use renamed session fields:

```typescript
import { computeSessionStart } from '../db/calculations.js';
import { injuryStore } from '../db/stores/injury-store.js';
// ...
router.get('/current', (c) => {
  const categories = categoryStore.findAll();
  const openSessions = sessionStore.findOpenWithItemData();
  const allItems = sessionStore.findAllLastSessions();
  const now = nowSeconds();

  const sessionByCategory = new Map(openSessions.map((s) => [s.category_id, s]));
  const itemsByCategory = new Map<number, ItemWithLastSession[]>();
  for (const item of allItems) {
    if (!itemsByCategory.has(item.category_id)) itemsByCategory.set(item.category_id, []);
    itemsByCategory.get(item.category_id)!.push(item);
  }

  return c.json(
    categories.map((cat) => {
      const rawCat = categoryStore.findRaw(cat.id)!;
      const previous = sessionStore.findLastEndedInCategory(cat.id) ?? null;
      const injuryActive = injuryStore.hasActiveInCategory(cat.id);
      const items = (itemsByCategory.get(cat.id) ?? []).map((it) => {
        const { target, max } = computeSessionStart(
          rawCat,
          { difficulty_multiplier: it.difficulty_multiplier },
          previous,
          now,
          injuryActive,
        );
        return { ...it, expected_target: target, expected_max: max };
      });

      const s = sessionByCategory.get(cat.id);
      if (!s) return { category: cat, item: null, session: null, items };

      const item = {
        id: s.item_id, category_id: s.category_id, name: s.item_name,
        color: s.item_color, difficulty_multiplier: s.item_difficulty_multiplier,
      };
      const session = {
        id: s.id, item_id: s.item_id, started_at: s.started_at, ended_at: s.ended_at,
        target_wear_seconds: s.target_wear_seconds, max_wear_seconds: s.max_wear_seconds,
        rest_seconds: s.rest_seconds, ended_in_injury: s.ended_in_injury,
      };
      return { category: cat, item, session, items };
    }),
  );
});
```

- [ ] **Step 6: Update injuries controller import**

In `src/backend/src/controllers/injuries.ts`, replace `getRiskLevel` with `riskLevelFor`:

```typescript
import { riskLevelFor } from '../db/calculations.js';
// ...
  const category = categoryStore.findRaw(item.category_id)!;
  const riskLevel = riskLevelFor(wearSeconds, category);
  const severity = riskLevel?.severity ?? 1;
```

- [ ] **Step 7: Run full backend suite to verify pass**

Run: `cd src/backend && npx vitest run`
Expected: PASS (all backend tests, including the migrated items/leaderboards/injuries fixtures).

- [ ] **Step 8: Commit**

```bash
git add src/backend/src/controllers/sessions.ts src/backend/src/controllers/injuries.ts src/backend/tests/
git commit -m "feat(api): expected target/max in /sessions/current; renamed session fields"
```

---

### Task 8: Frontend types, wear calculations & composable

**Files:**
- Modify: `src/frontend/src/composables/useWear.ts`
- Modify: `src/frontend/src/composables/useCalendar.ts`
- Modify: `src/frontend/src/utils/wearCalculations.ts`
- Test: `src/frontend/src/utils/wearCalculations.test.ts`

**Interfaces:**
- Consumes: API field names from Task 7.
- Produces:
  - `Session` & `ItemWithLastSession` types with `target_wear_seconds`, `max_wear_seconds: number|null`, `rest_seconds`; `ItemWithLastSession` adds `started_at: number|null`, `expected_target: number`, `expected_max: number|null`.
  - `targetWearSeconds(session: { target_wear_seconds: number }): number`
  - `maxWearSeconds(session: { max_wear_seconds: number | null }): number | null`
  - `currentWear(session: { started_at: number; ended_at: number | null }, now: number): number`

- [ ] **Step 1: Rewrite wearCalculations.test.ts**

```typescript
// src/frontend/src/utils/wearCalculations.test.ts
import { describe, it, expect } from 'vitest';
import { targetWearSeconds, maxWearSeconds } from './wearCalculations.js';

describe('targetWearSeconds', () => {
  it('reads the stored session target', () => {
    expect(targetWearSeconds({ target_wear_seconds: 900 })).toBe(900);
  });
});

describe('maxWearSeconds', () => {
  it('reads the stored session max', () => {
    expect(maxWearSeconds({ max_wear_seconds: 1800 })).toBe(1800);
  });
  it('returns null when there is no maximum', () => {
    expect(maxWearSeconds({ max_wear_seconds: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src/frontend && npx vitest run src/utils/wearCalculations.test.ts`
Expected: FAIL — `targetWearSeconds` not exported; old `maxWearSeconds` signature.

- [ ] **Step 3: Rewrite wearCalculations.ts**

```typescript
// src/frontend/src/utils/wearCalculations.ts
export function targetWearSeconds(session: { target_wear_seconds: number }): number {
  return session.target_wear_seconds;
}

export function maxWearSeconds(session: { max_wear_seconds: number | null }): number | null {
  return session.max_wear_seconds;
}

/** Elapsed wear for a session: now (seconds) minus start; freezes at ended_at once ended. */
export function currentWear(session: { started_at: number; ended_at: number | null }, now: number): number {
  const end = session.ended_at ?? now;
  return Math.max(0, end - session.started_at);
}
```

- [ ] **Step 4: Update useWear.ts types**

```typescript
export interface Session {
  id: number;
  item_id: number;
  started_at: number;
  ended_at: number | null;
  target_wear_seconds: number;
  max_wear_seconds: number | null;
  rest_seconds: number | null;
  ended_in_injury: number;
}

export interface ItemWithLastSession {
  item_id: number;
  category_id: number;
  name: string;
  color: string;
  difficulty_multiplier: number;
  ended_at: number | null;
  started_at: number | null;
  target_wear_seconds: number | null;
  max_wear_seconds: number | null;
  rest_seconds: number | null;
  expected_target: number;
  expected_max: number | null;
}
```

Also update `Category` in `useWear.ts` to the new fields:

```typescript
export interface Category {
  id: number;
  name: string;
  icon: string;
  initial_target_wear_duration_seconds: number;
  initial_max_wear_duration_seconds: number | null;
  rest_multiplier: number;
  minimum_rest: number;
  risk_levels: Array<{ lower: number | null; upper: number | null; text: string; severity: number }>;
  break_decay_multiplier: number;
  break_grace_time: number;
}
```

Replace the old `currentWear` function in `useWear.ts` (the one reading `calculated_wear_seconds`) by re-exporting from the util:

```typescript
import { currentWear } from '../utils/wearCalculations.js';
// remove the old inline currentWear definition; keep returning `currentWear` in the composable's return object,
// callers pass (session, now) — see ActionPane changes in Task 11.
```

- [ ] **Step 5: Fix the calendar daily total to use derived elapsed**

`useCalendar.ts` sums the removed `calculated_wear_seconds`. The calendar wants actual wear, which is now elapsed. These sessions are always ended (filtered on `ended_at !== null`), so replace line 45's reducer:

```typescript
      totalWearSeconds: daySessions.reduce((sum, s) => sum + ((s.ended_at ?? s.started_at) - s.started_at), 0),
```

- [ ] **Step 6: Run to verify pass + typecheck**

Run: `cd src/frontend && npx vitest run src/utils/wearCalculations.test.ts && npx vue-tsc --noEmit`
Expected: tests PASS. (vue-tsc may report errors in ActionPane/CategoryForm — those are fixed in Tasks 10–11; if so, proceed and re-run typecheck at the end of Task 11.)

- [ ] **Step 7: Commit**

```bash
git add src/frontend/src/utils/wearCalculations.ts src/frontend/src/utils/wearCalculations.test.ts src/frontend/src/composables/useWear.ts src/frontend/src/composables/useCalendar.ts
git commit -m "feat(fe): session-based wear calc + target/max types"
```

---

### Task 9: Category form mapping & defaults

**Files:**
- Modify: `src/frontend/src/components/CategoryForm.vue` (state shape + DEFAULT_STATE only; UI in Task 10)
- Modify: `src/frontend/src/utils/categoryForm.ts`
- Modify: `src/frontend/src/utils/categoryDefaults.ts`
- Test: `src/frontend/src/utils/categoryForm.test.ts`

**Interfaces:**
- Consumes: `CategoryFormState` (extended below).
- Produces:
  - `CategoryFormState` adds `initialWearTargetSeconds: number`, `initialWearMaxSeconds: number | null`, `minimumRestSeconds: number`, `breakGraceSeconds: number`, `breakDecayMultiplier: number` (removes `initialWearSeconds`).
  - `formStateToApiPayload(data)` returns `{ name, icon, initial_target_wear_duration_seconds, initial_max_wear_duration_seconds, rest_multiplier, minimum_rest, risk_levels, break_decay_multiplier, break_grace_time }`.
  - `categoryToFormState(cat)` maps the new API shape.

- [ ] **Step 1: Rewrite categoryForm.test.ts**

```typescript
// src/frontend/src/utils/categoryForm.test.ts
import { describe, it, expect } from 'vitest';
import { categoryToFormState, formStateToApiPayload } from './categoryForm.js';
import type { CategoryApiShape } from './categoryForm.js';

const BASE_CATEGORY: CategoryApiShape = {
  id: 1,
  name: 'Earrings',
  icon: '💎',
  initial_target_wear_duration_seconds: 900,
  initial_max_wear_duration_seconds: 1800,
  rest_multiplier: 2,
  minimum_rest: 86400,
  break_decay_multiplier: 0.91,
  break_grace_time: 86400,
  risk_levels: [
    { lower: null, upper: 3600, text: 'Low', severity: 1 },
    { lower: 3600, upper: 7200, text: 'Medium', severity: 2 },
    { lower: 7200, upper: null, text: 'High', severity: 3 },
  ],
};

describe('categoryToFormState', () => {
  it('maps target/max/min-rest/grace/decay', () => {
    const s = categoryToFormState(BASE_CATEGORY);
    expect(s.initialWearTargetSeconds).toBe(900);
    expect(s.initialWearMaxSeconds).toBe(1800);
    expect(s.minimumRestSeconds).toBe(86400);
    expect(s.breakGraceSeconds).toBe(86400);
    expect(s.breakDecayMultiplier).toBeCloseTo(0.91);
    expect(s.restMultiplier).toBe(2);
  });

  it('preserves a null maximum', () => {
    const s = categoryToFormState({ ...BASE_CATEGORY, initial_max_wear_duration_seconds: null });
    expect(s.initialWearMaxSeconds).toBeNull();
  });

  it('derives bandCount and crossoverPoints', () => {
    const s = categoryToFormState(BASE_CATEGORY);
    expect(s.bandCount).toBe(3);
    expect(s.crossoverPoints).toEqual([3600, 7200]);
  });
});

describe('formStateToApiPayload', () => {
  it('maps all fields to snake_case incl. null max', () => {
    const payload = formStateToApiPayload({
      name: 'Test', icon: '🎯',
      initialWearTargetSeconds: 1800, initialWearMaxSeconds: null,
      restMultiplier: 1.5, minimumRestSeconds: 1200,
      breakGraceSeconds: 3600, breakDecayMultiplier: 0.8,
      bandCount: 2, crossoverPoints: [3600],
    });
    expect(payload.initial_target_wear_duration_seconds).toBe(1800);
    expect(payload.initial_max_wear_duration_seconds).toBeNull();
    expect(payload.minimum_rest).toBe(1200);
    expect(payload.break_grace_time).toBe(3600);
    expect(payload.break_decay_multiplier).toBe(0.8);
    expect(payload.rest_multiplier).toBe(1.5);
    expect(payload.risk_levels).toEqual([
      { lower: null, upper: 3600, text: 'Low', severity: 1 },
      { lower: 3600, upper: null, text: 'High', severity: 2 },
    ]);
  });

  it('round-trips', () => {
    const payload = formStateToApiPayload(categoryToFormState(BASE_CATEGORY));
    expect(payload.initial_target_wear_duration_seconds).toBe(900);
    expect(payload.initial_max_wear_duration_seconds).toBe(1800);
    expect(payload.break_grace_time).toBe(86400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src/frontend && npx vitest run src/utils/categoryForm.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend CategoryFormState + DEFAULT_STATE in CategoryForm.vue**

```typescript
export interface CategoryFormState {
  name: string;
  icon: string;
  initialWearTargetSeconds: number;
  initialWearMaxSeconds: number | null;
  minimumRestSeconds: number;
  breakGraceSeconds: number;
  breakDecayMultiplier: number;
  restMultiplier: number;
  bandCount: number;
  crossoverPoints: number[];
}

const DEFAULT_STATE: CategoryFormState = {
  name: '',
  icon: '',
  initialWearTargetSeconds: 900,
  initialWearMaxSeconds: 1350,
  minimumRestSeconds: 86400,
  breakGraceSeconds: 86400,
  breakDecayMultiplier: 0.91,
  restMultiplier: 2,
  bandCount: 3,
  crossoverPoints: [3600, 7200],
};
```

- [ ] **Step 4: Rewrite categoryForm.ts mapping**

```typescript
// src/frontend/src/utils/categoryForm.ts
import { buildRiskLevels } from './riskLevels.js';
import type { CategoryFormState } from '../components/CategoryForm.vue';
import type { RiskLevel } from './riskLevels.js';

export interface CategoryApiShape {
  name: string;
  icon: string;
  initial_target_wear_duration_seconds: number;
  initial_max_wear_duration_seconds: number | null;
  rest_multiplier: number;
  minimum_rest: number;
  break_decay_multiplier: number;
  break_grace_time: number;
  risk_levels: RiskLevel[];
  [key: string]: unknown;
}

export function categoryToFormState(cat: CategoryApiShape): CategoryFormState {
  return {
    name: cat.name,
    icon: cat.icon,
    initialWearTargetSeconds: cat.initial_target_wear_duration_seconds,
    initialWearMaxSeconds: cat.initial_max_wear_duration_seconds,
    minimumRestSeconds: cat.minimum_rest,
    breakGraceSeconds: cat.break_grace_time,
    breakDecayMultiplier: cat.break_decay_multiplier,
    restMultiplier: cat.rest_multiplier,
    bandCount: cat.risk_levels.length,
    crossoverPoints: cat.risk_levels.slice(0, -1).map((l) => l.upper as number),
  };
}

export function formStateToApiPayload(data: CategoryFormState): {
  name: string;
  icon: string;
  initial_target_wear_duration_seconds: number;
  initial_max_wear_duration_seconds: number | null;
  rest_multiplier: number;
  minimum_rest: number;
  break_decay_multiplier: number;
  break_grace_time: number;
  risk_levels: RiskLevel[];
} {
  return {
    name: data.name,
    icon: data.icon,
    initial_target_wear_duration_seconds: data.initialWearTargetSeconds,
    initial_max_wear_duration_seconds: data.initialWearMaxSeconds,
    rest_multiplier: data.restMultiplier,
    minimum_rest: data.minimumRestSeconds,
    break_decay_multiplier: data.breakDecayMultiplier,
    break_grace_time: data.breakGraceSeconds,
    risk_levels: buildRiskLevels(data.bandCount, data.crossoverPoints),
  };
}
```

- [ ] **Step 5: Update categoryDefaults.ts**

```typescript
// src/frontend/src/utils/categoryDefaults.ts
import type { Category } from '../composables/useWear.js';

export type CategoryDefaults = Omit<Category, 'id' | 'name' | 'icon'>;

export const DEFAULT_CATEGORY_FIELDS: CategoryDefaults = {
  initial_target_wear_duration_seconds: 900,
  initial_max_wear_duration_seconds: 1350,
  rest_multiplier: 2,
  minimum_rest: 86400,
  risk_levels: [
    { lower: null, upper: 3600, text: 'Low', severity: 1 },
    { lower: 3600, upper: 7200, text: 'Medium', severity: 2 },
    { lower: 7200, upper: null, text: 'High', severity: 3 },
  ],
  break_decay_multiplier: 0.91,
  break_grace_time: 86400,
};
```

Note: `CategoriesSection.vue` `onAddCategory` already spreads `formStateToApiPayload(data)` and then adds extra defaults. Since the payload now carries every field, remove the extra spread keys there in Task 10 (UI task). For now this file still compiles because the extra keys it references (`rest_constant_seconds`, etc.) come from `DEFAULT_CATEGORY_FIELDS`, which no longer has them — so this will break compilation until Task 10. That is expected; Tasks 9 and 10 land together logically but are committed separately. If running typecheck between them, expect a `CategoriesSection.vue` error to be resolved in Task 10.

- [ ] **Step 6: Run to verify pass**

Run: `cd src/frontend && npx vitest run src/utils/categoryForm.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/frontend/src/utils/categoryForm.ts src/frontend/src/utils/categoryDefaults.ts src/frontend/src/components/CategoryForm.vue src/frontend/src/utils/categoryForm.test.ts
git commit -m "feat(fe): category form state + mapping for target/max/grace/min-rest/decay"
```

---

### Task 10: Category form UI

**Files:**
- Modify: `src/frontend/src/components/CategoryForm.vue`
- Modify: `src/frontend/src/components/CategoriesSection.vue`
- Test: `src/frontend/tests/e2e/categories.spec.ts` (extended in Task 12)

**Interfaces:**
- Consumes: `CategoryFormState` (Task 9), `DurationPickerSheet`, `formStateToApiPayload`.
- Produces: form with Target wear, Maximum wear (clearable to null), Minimum rest period (disabled when max null), Break grace time, Break decay multiplier, plus existing rest-multiplier and bands.

- [ ] **Step 1: Replace the "Initial wear" row and add new fields in CategoryForm.vue template**

Replace the initial-wear block (the `<div class="flex gap-4 flex-wrap items-end">` containing "Initial wear" + the help `<p>`) with:

```html
<div class="flex gap-4 flex-wrap items-end">
  <div>
    <label class="block text-sm font-medium text-gray-700 mb-1">Target wear</label>
    <button type="button" class="flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
      @click="openDurationPicker('target')">
      <span>{{ shortDuration(catForm.initialWearTargetSeconds) }}</span><span class="text-gray-400">▾</span>
    </button>
  </div>
  <div>
    <label class="block text-sm font-medium text-gray-700 mb-1">Maximum wear</label>
    <div class="flex items-center gap-1">
      <button type="button" class="flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
        @click="openDurationPicker('max')">
        <span>{{ catForm.initialWearMaxSeconds === null ? 'None' : shortDuration(catForm.initialWearMaxSeconds) }}</span>
        <span class="text-gray-400">▾</span>
      </button>
      <button v-if="catForm.initialWearMaxSeconds !== null" type="button" data-testid="clear-max"
        class="text-xs text-gray-400 underline" @click="catForm.initialWearMaxSeconds = null">clear</button>
    </div>
  </div>
  <div>
    <label for="cat-rest-mult" class="block text-sm font-medium text-gray-700 mb-1">Rest multiplier</label>
    <input id="cat-rest-mult" :value="catForm.restMultiplier"
      @input="catForm.restMultiplier = Number(($event.target as HTMLInputElement).value)" @blur="onRestMultiplierBlur"
      type="number" min="0" step="0.1"
      class="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
  </div>
</div>

<div class="flex gap-4 flex-wrap items-end">
  <div>
    <label class="block text-sm font-medium text-gray-700 mb-1">Minimum rest period</label>
    <button type="button" :disabled="catForm.initialWearMaxSeconds === null" data-testid="min-rest"
      class="flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-40"
      @click="openDurationPicker('minRest')">
      <span>{{ shortDuration(catForm.minimumRestSeconds) }}</span><span class="text-gray-400">▾</span>
    </button>
  </div>
  <div>
    <label class="block text-sm font-medium text-gray-700 mb-1">Break grace time</label>
    <button type="button" class="flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
      @click="openDurationPicker('grace')">
      <span>{{ shortDuration(catForm.breakGraceSeconds) }}</span><span class="text-gray-400">▾</span>
    </button>
  </div>
  <div>
    <label for="cat-decay" class="block text-sm font-medium text-gray-700 mb-1">Break decay / day</label>
    <input id="cat-decay" :value="catForm.breakDecayMultiplier"
      @input="catForm.breakDecayMultiplier = Number(($event.target as HTMLInputElement).value)"
      type="number" min="0" max="0.99" step="0.01"
      class="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
  </div>
</div>
<p class="text-xs text-gray-400 -mt-1">
  <strong>Target</strong> is the goal duration; <strong>Maximum</strong> (optional) is the hard ceiling.
  Minimum rest only applies when a maximum is set.
</p>
```

- [ ] **Step 2: Update the duration-picker target type + handlers in the `<script setup>`**

```typescript
const durationPickerTarget = ref<'target' | 'max' | 'minRest' | 'grace' | number>('target');

function openDurationPicker(target: 'target' | 'max' | 'minRest' | 'grace' | number) {
  durationPickerTarget.value = target;
  if (target === 'target') durationPickerValue.value = catForm.initialWearTargetSeconds;
  else if (target === 'max') durationPickerValue.value = catForm.initialWearMaxSeconds ?? catForm.initialWearTargetSeconds;
  else if (target === 'minRest') durationPickerValue.value = catForm.minimumRestSeconds;
  else if (target === 'grace') durationPickerValue.value = catForm.breakGraceSeconds;
  else durationPickerValue.value = catForm.crossoverPoints[target as number];
  showDurationPicker.value = true;
}

function onDurationPicked(seconds: number) {
  const target = durationPickerTarget.value;
  if (target === 'target') { catForm.initialWearTargetSeconds = seconds; return; }
  if (target === 'max') { catForm.initialWearMaxSeconds = seconds; return; }
  if (target === 'minRest') { catForm.minimumRestSeconds = seconds; return; }
  if (target === 'grace') { catForm.breakGraceSeconds = seconds; return; }
  const idx = target as number;
  const prev = idx > 0 ? catForm.crossoverPoints[idx - 1] : 0;
  const next = idx < catForm.crossoverPoints.length - 1 ? catForm.crossoverPoints[idx + 1] : Infinity;
  catForm.crossoverPoints[idx] = Math.max(prev + 60, Math.min(next - 60, seconds));
}
```

- [ ] **Step 3: Update onSubmit to emit the full state**

```typescript
function onSubmit() {
  if (!catForm.name || !catForm.icon) return;
  emit('submit', {
    name: catForm.name,
    icon: catForm.icon,
    initialWearTargetSeconds: catForm.initialWearTargetSeconds,
    initialWearMaxSeconds: catForm.initialWearMaxSeconds,
    minimumRestSeconds: catForm.minimumRestSeconds,
    breakGraceSeconds: catForm.breakGraceSeconds,
    breakDecayMultiplier: catForm.breakDecayMultiplier,
    restMultiplier: catForm.restMultiplier,
    bandCount: catForm.bandCount,
    crossoverPoints: [...catForm.crossoverPoints],
  });
}
```

- [ ] **Step 4: Simplify CategoriesSection.onAddCategory**

`formStateToApiPayload` now returns every field, so drop the extra spread:

```typescript
async function onAddCategory(data: CategoryFormState) {
  try {
    await createCategory(formStateToApiPayload(data));
    showCatForm.value = false;
  } catch (e) {
    showError(String(e));
  }
}
```

Remove the now-unused `DEFAULT_CATEGORY_FIELDS` import from `CategoriesSection.vue` if it is no longer referenced.

- [ ] **Step 5: Typecheck + build**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: PASS (no remaining references to removed fields).

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/components/CategoryForm.vue src/frontend/src/components/CategoriesSection.vue
git commit -m "feat(fe): category form UI for target/max/min-rest/grace/decay"
```

---

### Task 11: ActionPane — target marker & idle display

**Files:**
- Modify: `src/frontend/src/components/ActionPane.vue`
- Test: covered by `src/frontend/tests/e2e/wear.spec.ts` (Task 12)

**Interfaces:**
- Consumes: `targetWearSeconds`, `maxWearSeconds`, `currentWear` (Task 8); `expected_target`/`expected_max` on idle items (Task 7).

- [ ] **Step 1: Update script imports & helpers**

Replace the `maxWearSeconds` import and the `maxWear`/`wearProgress`/`rowBg`/`idleMaxWear` helpers:

```typescript
import { targetWearSeconds, maxWearSeconds, currentWear } from '../utils/wearCalculations.js';

function sessionSeconds(session: Session): number {
  return currentWear(session, Math.floor(now.value / 1000));
}

function elapsed(session: Session): string {
  return formatDuration(sessionSeconds(session));
}

/** Denominator for the bar: max when set, else target. */
function barCeiling(entry: CurrentEntry): number {
  if (!entry.session) return 0;
  const max = maxWearSeconds(entry.session);
  return max ?? targetWearSeconds(entry.session);
}

function maxWear(entry: CurrentEntry): string {
  if (!entry.session) return '';
  const max = maxWearSeconds(entry.session);
  return max === null ? '—' : formatDuration(max);
}

function targetLabel(entry: CurrentEntry): string {
  if (!entry.session) return '';
  return formatDuration(targetWearSeconds(entry.session));
}

function wearProgress(entry: CurrentEntry): number {
  const ceiling = barCeiling(entry);
  if (!entry.session || ceiling <= 0) return 0;
  return Math.min((sessionSeconds(entry.session) / ceiling) * 100, 100);
}

/** Target marker position as a percentage of the bar ceiling. */
function targetMarkerPercent(entry: CurrentEntry): number {
  const ceiling = barCeiling(entry);
  if (!entry.session || ceiling <= 0) return 100;
  return Math.min((targetWearSeconds(entry.session) / ceiling) * 100, 100);
}

function rowBg(entry: CurrentEntry): string {
  const ceiling = barCeiling(entry);
  if (!entry.session || ceiling <= 0) return '';
  const remaining = 1 - sessionSeconds(entry.session) / ceiling;
  if (remaining <= 0) return 'bg-red-100';
  if (remaining <= 0.05) return 'bg-orange-100';
  if (remaining <= 0.10) return 'bg-yellow-100';
  return '';
}

function selectedItemData(entry: CurrentEntry): ItemWithLastSession | null {
  const id = selectedItem[entry.category.id];
  if (!id) return null;
  return entry.items.find((i) => i.item_id === id) ?? null;
}

function idleTarget(entry: CurrentEntry): string {
  const item = selectedItemData(entry);
  return item ? formatDuration(item.expected_target) : '';
}

function idleMax(entry: CurrentEntry): string {
  const item = selectedItemData(entry);
  if (!item || item.expected_max === null) return '';
  return formatDuration(item.expected_max);
}

function restRemainingMinutes(entry: CurrentEntry): number {
  const item = selectedItemData(entry);
  if (!item || item.ended_at === null || item.rest_seconds === null) return 0;
  const remainingSeconds = item.ended_at + item.rest_seconds - now.value / 1000;
  return Math.max(0, Math.ceil(remainingSeconds / 60));
}
```

- [ ] **Step 2: Add the target marker to the bar and target row to the template**

Replace the `#inner` progress-bar block:

```html
<template v-if="entry.session && entry.item" #inner>
  <div class="relative h-1.5 rounded-full bg-gray-200 overflow-hidden mt-1">
    <div class="h-full rounded-full transition-all duration-1000"
      :style="{ width: wearProgress(entry) + '%', background: entry.item.color }"></div>
    <div class="absolute top-0 bottom-0 w-0.5 bg-gray-600"
      :style="{ left: targetMarkerPercent(entry) + '%' }" data-testid="target-marker"></div>
  </div>
</template>
```

In the active-session `#after` block, show Target and Max:

```html
<div class="text-right tabular-nums leading-snug whitespace-nowrap">
  <div class="text-sm text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Worn</span>{{ elapsed(entry.session) }}</div>
  <div class="text-sm text-gray-600 mt-0.5"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Target</span>{{ targetLabel(entry) }}</div>
  <div v-if="entry.session.max_wear_seconds !== null" class="text-sm text-gray-600 mt-0.5"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Max</span>{{ maxWear(entry) }}</div>
</div>
```

In the idle `#after` block, replace the idle Max line with Target + optional Max:

```html
<div v-if="selectedItemData(entry)" class="text-right tabular-nums leading-snug whitespace-nowrap">
  <div class="text-sm text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Target</span>{{ idleTarget(entry) }}</div>
  <div v-if="idleMax(entry)" class="text-sm text-gray-600 mt-0.5"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Max</span>{{ idleMax(entry) }}</div>
  <div v-if="restRemainingMinutes(entry) > 0" class="text-sm text-amber-600 mt-0.5">
    <Icon icon="ph:bed" class="inline w-3.5 h-3.5 mr-0.5" />Rest {{ restRemainingMinutes(entry) }}m more
  </div>
</div>
```

- [ ] **Step 3: Typecheck + unit suite**

Run: `cd src/frontend && npx vue-tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/src/components/ActionPane.vue
git commit -m "feat(fe): target marker on wear bar + target/max idle display"
```

---

### Task 12: End-to-end verification

**Files:**
- Modify: `src/frontend/tests/e2e/helpers.ts` (shared `createCategoryViaApi` fixture)
- Modify: `src/frontend/tests/e2e/wear.spec.ts` (inline fixture + marker test)
- Modify: `src/frontend/tests/e2e/categories.spec.ts` (new no-maximum test)

**Interfaces:**
- Consumes: full stack from Tasks 1–11.

- [ ] **Step 1: Update the shared API category fixture to new field names**

The new category validation (Task 6) rejects the old field names, so every e2e that creates a category via the API must be updated. Replace the `data` object in `createCategoryViaApi` in `tests/e2e/helpers.ts`:

```typescript
    data: {
      name,
      icon,
      initial_target_wear_duration_seconds: 900,
      initial_max_wear_duration_seconds: 1800,
      rest_multiplier: 2,
      minimum_rest: 86400,
      risk_levels: [
        { lower: null, upper: 3600, text: 'Low', severity: 1 },
        { lower: 3600, upper: 7200, text: 'Medium', severity: 2 },
        { lower: 7200, upper: null, text: 'High', severity: 3 },
      ],
      break_decay_multiplier: 0.91,
      break_grace_time: 86400,
    },
```

- [ ] **Step 2: Update the inline fixture in wear.spec.ts**

`wear.spec.ts` posts its own category in `beforeAll` (it needs zero rest so items can be re-worn immediately). Replace its `data` object:

```typescript
      data: {
        name: categoryName,
        icon: '👟',
        initial_target_wear_duration_seconds: 600,
        initial_max_wear_duration_seconds: 900,
        rest_multiplier: 0,
        minimum_rest: 0,
        risk_levels: [
          { lower: null, upper: 3600, text: 'Low', severity: 1 },
          { lower: 3600, upper: 7200, text: 'Medium', severity: 2 },
          { lower: 7200, upper: null, text: 'High', severity: 3 },
        ],
        break_decay_multiplier: 0.91,
        break_grace_time: 86400,
      },
```

- [ ] **Step 3: Fix the existing custom-duration assertion in categories.spec.ts**

The `can create a category with custom initial wear...` test reads the API back and asserts the old field. The first `▾` duration picker is now "Target wear", so update the type and assertion (~lines 163–172):

```typescript
    const cats: Array<{
      name: string;
      initial_target_wear_duration_seconds: number;
      rest_multiplier: number;
      risk_levels: unknown[];
    }> = await res.json();
    const saved = cats.find((c) => c.name === name);

    expect(saved).toBeDefined();
    expect(saved!.initial_target_wear_duration_seconds).toBe(1 * 3600 + 30 * 60); // 5400
    expect(saved!.rest_multiplier).toBe(1.5);
    expect(saved!.risk_levels).toHaveLength(4);
```

- [ ] **Step 4: Run the existing e2e specs to verify the renames fix them**

Run: `cd src/frontend && npx playwright test wear.spec.ts items.spec.ts stats.spec.ts categories.spec.ts`
Expected: PASS (these previously-passing specs now work against the new schema).

- [ ] **Step 5: Add a wear e2e asserting the target marker renders**

Append to the `Wear sessions` describe block in `wear.spec.ts` (the start-session flow matches the existing `can start a wear session` test):

```typescript
  test('active session shows a target marker on the bar', async ({ page }) => {
    const wearBtn = page.getByRole('button', { name: /^wear$/i }).filter({ enabled: true }).first();
    await wearBtn.click();
    await expect(page.getByRole('button', { name: /stop/i }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('target-marker').first()).toBeVisible();
  });
```

- [ ] **Step 6: Add a category-form e2e for the no-maximum path**

Append to the `Category management` describe block in `categories.spec.ts`. It follows the icon-pick flow used by the existing `can add a category` test, then clears the maximum and asserts the minimum-rest picker is disabled:

```typescript
  test('clearing the maximum disables the minimum rest picker', async ({ page }) => {
    const name = `NoMax-${uid()}`;
    createdName = name;

    await page.getByRole('button', { name: '+ Add' }).first().click();
    await page.getByLabel('Name').first().fill(name);
    await page.getByRole('button', { name: /choose icon/i }).first().click();
    await page.waitForSelector('.overflow-y-auto');
    await page.locator('.overflow-y-auto button').first().click();

    await expect(page.getByTestId('min-rest')).toBeEnabled();
    await page.getByTestId('clear-max').click();
    await expect(page.getByTestId('min-rest')).toBeDisabled();

    await page.getByTestId('category-form-submit').click();
    await expect(page.getByText(name).first()).toBeVisible();
  });
```

- [ ] **Step 7: Run the whole project test suite (backend + frontend + e2e)**

Run: `cd src/backend && npx vitest run && cd ../frontend && npx vitest run && npx playwright test`
Expected: PASS everywhere. (`tests/e2e/global-setup.ts` resets the DB via `POST /api/__reset`; the server runs the migration runner at startup, so the schema is current.)

- [ ] **Step 8: Commit**

```bash
git add src/frontend/tests/e2e/helpers.ts src/frontend/tests/e2e/wear.spec.ts src/frontend/tests/e2e/categories.spec.ts
git commit -m "test(e2e): new-schema fixtures, target marker, no-maximum category"
```

---

## Notes for the implementer

- The backend reads categories via `categoryStore.findRaw(id)` (risk_levels as a JSON string) when passing into calculation functions; `parseRiskLevels`/`riskLevelFor` handle the string form. Do not pass the deserialized `Category` where a raw row is expected and vice versa unless the field shapes match — both satisfy the `Category` union type used by calculations.
- `injuryStore.lastSessionWear` now returns elapsed; the injuries controller's severity derivation is unchanged otherwise.
- After Task 8, `vue-tsc` may report transient errors in components fixed in Tasks 10–11; the final typecheck in Task 11 must be clean.
- `dev-server.ts` and `server.ts` run the migration runner at startup; no change needed there for migrations to apply on deploy.
