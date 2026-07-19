# Rotation Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second category type, `rotation`, where items are worn in strict rotation (no repeat until every other active item has had a turn) with a fixed wear duration and no rest/decay/injury mechanics, plus a frontend-only consecutive-wear-days nudge with a "wear something else" escape hatch.

**Architecture:** One new pure function (`rotationAvailability`) in `calculations.ts` is the single source of truth for "which items can start next" — it's called both to validate `POST /api/sessions/start` and to annotate `GET /api/sessions/current`. Two new category columns (`type`, `consecutive_wear_days`) drive branching in the session store and controllers. No new tables; the consecutive-day lock is derived client-side from session history already fetched and never touches the backend.

**Tech Stack:** Hono (backend routes), better-sqlite3, Vue 3 + Konsta UI (frontend), Vitest.

## Global Constraints

- Existing `duration` categories must be completely unaffected — every branch is `type === 'rotation'` gated, defaulting to today's behaviour.
- No new tables. No persisted skip/lock state.
- `rotationAvailability` is pure (no DB access) so it's unit-testable in isolation, matching the existing pattern for `computeSessionStart`/`computeRest`.
- Migration is additive only (`ALTER TABLE ... ADD COLUMN`), run via `src/backend/src/db/migrations/009_rotation_categories.ts`, registered in `src/backend/src/db/migrations/index.ts` as version 9.
- Backend tests run with `npm --prefix src/backend run test:ci` (vitest run). Frontend tests run with `npm --prefix src/frontend run test:ci`.

---

### Task 1: Migration 009 — add `type` and `consecutive_wear_days` to `categories`

**Files:**
- Create: `src/backend/src/db/migrations/009_rotation_categories.ts`
- Modify: `src/backend/src/db/migrations/index.ts`
- Test: `src/backend/tests/db/migration-009.test.ts`

**Interfaces:**
- Produces: `categories.type TEXT NOT NULL DEFAULT 'duration'`, `categories.consecutive_wear_days INTEGER NOT NULL DEFAULT 1`. Every later task reads/writes these two columns under exactly these names.

- [ ] **Step 1: Write the failing test**

```ts
// src/backend/tests/db/migration-009.test.ts
import { describe, it, expect } from 'vitest';
import { runMigrations } from '../../src/db/migrations/index.js';
import { prepare } from '../../src/db/index.js';

describe('migration 009: rotation categories', () => {
  it('adds type and consecutive_wear_days columns with correct defaults', () => {
    runMigrations();
    const columns = prepare(`PRAGMA table_info(categories)`).all() as { name: string }[];
    const names = columns.map((c) => c.name);
    expect(names).toContain('type');
    expect(names).toContain('consecutive_wear_days');
  });

  it('existing categories default to type=duration, consecutive_wear_days=1', () => {
    runMigrations();
    prepare(
      `INSERT INTO categories
         (name, icon, rest_multiplier, risk_levels, break_decay_multiplier,
          initial_target_wear_duration_seconds, initial_max_wear_duration_seconds,
          break_grace_time, minimum_rest)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('Migration009 Test', 'x', 2, '[]', 0.91, 900, 1800, 86400, 86400);
    const row = prepare(`SELECT type, consecutive_wear_days FROM categories WHERE name = ?`).get(
      'Migration009 Test',
    ) as { type: string; consecutive_wear_days: number };
    expect(row.type).toBe('duration');
    expect(row.consecutive_wear_days).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend exec vitest run tests/db/migration-009.test.ts`
Expected: FAIL — `type` / `consecutive_wear_days` not in `PRAGMA table_info` output (columns don't exist yet).

- [ ] **Step 3: Write the migration**

```ts
// src/backend/src/db/migrations/009_rotation_categories.ts
import { dbExport } from '../index.js';

export default function runMigration009() {
  dbExport.exec(`
    ALTER TABLE categories ADD COLUMN type TEXT NOT NULL DEFAULT 'duration';
    ALTER TABLE categories ADD COLUMN consecutive_wear_days INTEGER NOT NULL DEFAULT 1;
  `);
}
```

- [ ] **Step 4: Register the migration**

In `src/backend/src/db/migrations/index.ts`, add the import and the array entry:

```ts
import runMigration009 from './009_rotation_categories.js';
```

```ts
  { version: 9, name: '009_rotation_categories', run: runMigration009 },
```

(Add both after the existing version-8 line, keeping the array in ascending version order.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix src/backend exec vitest run tests/db/migration-009.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/backend/src/db/migrations/009_rotation_categories.ts src/backend/src/db/migrations/index.ts src/backend/tests/db/migration-009.test.ts
git commit -m "feat(db): add rotation category type + consecutive_wear_days columns"
```

---

### Task 2: `rotationAvailability` in `calculations.ts`

**Files:**
- Modify: `src/backend/src/db/calculations.ts`
- Test: `src/backend/tests/db/calculations.test.ts`

**Interfaces:**
- Consumes: nothing new (pure function, plain arrays).
- Produces: `rotationAvailability(activeItemIds: number[], recentSessions: { item_id: number }[]): Set<number>`. `recentSessions` must be **newest first**. Task 3 (session-store) and Task 6/7 (controllers) call this exact signature.

- [ ] **Step 1: Write the failing tests**

Append to `src/backend/tests/db/calculations.test.ts`:

```ts
import { rotationAvailability } from '../../src/db/calculations.js';

describe('rotationAvailability', () => {
  it('all items available when there is no history', () => {
    const result = rotationAvailability([1, 2, 3], []);
    expect(result).toEqual(new Set([1, 2, 3]));
  });

  it('excludes items worn since the last reset (partial cycle)', () => {
    // Newest first: C then B were worn; A was not.
    const result = rotationAvailability([1, 2, 3], [{ item_id: 3 }, { item_id: 2 }]);
    expect(result).toEqual(new Set([1]));
  });

  it('resets to all available once every active item has had a turn with no repeat', () => {
    // Newest first: A, C, B — covers all three active items before any repeat.
    const result = rotationAvailability([1, 2, 3], [{ item_id: 1 }, { item_id: 3 }, { item_id: 2 }]);
    expect(result).toEqual(new Set([1, 2, 3]));
  });

  it('a newly added item (never worn) is immediately available even mid-cycle', () => {
    // Item 4 was added after B and C were worn; it has never appeared in history.
    const result = rotationAvailability([1, 2, 3, 4], [{ item_id: 3 }, { item_id: 2 }]);
    expect(result).toEqual(new Set([1, 4]));
  });

  it('a removed item drops out of consideration even if it was worn most recently', () => {
    // Item 3 was worn most recently but has since been removed from the category (not in activeItemIds).
    const result = rotationAvailability([1, 2], [{ item_id: 3 }, { item_id: 1 }]);
    // Scan: 3 (not active, skip for seen-tracking purposes but still "consumes" the repeat-stop check only for active items)
    // 1 is active and unseen -> seen={1}. No repeat among active items encountered. seen({1}) != full active set {1,2}.
    expect(result).toEqual(new Set([2]));
  });

  it('lock scenario: two consecutive sessions of the same item collapse to one occurrence', () => {
    // A worn on day1 and day2 (consecutive-wear-days lock), B and C never worn.
    const result = rotationAvailability([1, 2, 3], [{ item_id: 1 }, { item_id: 1 }]);
    expect(result).toEqual(new Set([2, 3]));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix src/backend exec vitest run tests/db/calculations.test.ts -t rotationAvailability`
Expected: FAIL — `rotationAvailability` is not exported / not defined.

- [ ] **Step 3: Implement `rotationAvailability`**

Add to `src/backend/src/db/calculations.ts` (near the other exported pure functions, after `lapCount`):

```ts
/**
 * Derived rotation availability: no stored cycle state. Walk `recentSessions`
 * (newest first) collecting active items into `seen`; stop at the first
 * item already in `seen` (that session belongs to a prior, completed cycle).
 * If `seen` ends up covering every active item with no repeat encountered,
 * the most recent session just completed a full rotation, so everyone is
 * available again. Items not in `activeItemIds` (removed from the category)
 * are ignored entirely.
 */
export function rotationAvailability(
  activeItemIds: number[],
  recentSessions: { item_id: number }[],
): Set<number> {
  const active = new Set(activeItemIds);
  const seen = new Set<number>();

  for (const session of recentSessions) {
    if (!active.has(session.item_id)) continue;
    if (seen.has(session.item_id)) break;
    seen.add(session.item_id);
  }

  if (seen.size === active.size) return active;
  return new Set([...active].filter((id) => !seen.has(id)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix src/backend exec vitest run tests/db/calculations.test.ts -t rotationAvailability`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/db/calculations.ts src/backend/tests/db/calculations.test.ts
git commit -m "feat(db): add rotationAvailability derived-rotation algorithm"
```

---

### Task 3: `category-store.ts` — `type` and `consecutive_wear_days`

**Files:**
- Modify: `src/backend/src/db/stores/category-store.ts`
- Test: `src/backend/tests/db/category-store.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Category` / `CategoryRow` gain `type: 'duration' | 'rotation'` and `consecutive_wear_days: number`. `CategoryCreate` gains the same two fields as **optional**, defaulting to `'duration'` / `1` inside `create()` — this keeps every existing call site (tests, controller) that omits them working unchanged. Task 4 (controller) and Task 5 (session-store) rely on `category.type` and `category.consecutive_wear_days` being present on every `Category`/raw row.

- [ ] **Step 1: Write the failing test**

Append to `src/backend/tests/db/category-store.test.ts`:

```ts
describe('categoryStore rotation fields', () => {
  it('defaults type to duration and consecutive_wear_days to 1 when omitted', () => {
    const cat = categoryStore.create({ ...baseCategory, name: 'Default Type' });
    expect(cat.type).toBe('duration');
    expect(cat.consecutive_wear_days).toBe(1);
  });

  it('persists an explicit rotation type and consecutive_wear_days', () => {
    const cat = categoryStore.create({
      ...baseCategory,
      name: 'Rotation Cat',
      type: 'rotation',
      consecutive_wear_days: 2,
    });
    expect(cat.type).toBe('rotation');
    expect(cat.consecutive_wear_days).toBe(2);

    const found = categoryStore.find(cat.id)!;
    expect(found.type).toBe('rotation');
    expect(found.consecutive_wear_days).toBe(2);
  });

  it('update() can change type and consecutive_wear_days', () => {
    const cat = categoryStore.create({ ...baseCategory, name: 'Update Type' });
    const updated = categoryStore.update(cat.id, { type: 'rotation', consecutive_wear_days: 3 });
    expect(updated.type).toBe('rotation');
    expect(updated.consecutive_wear_days).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend exec vitest run tests/db/category-store.test.ts -t "rotation fields"`
Expected: FAIL — TS error / `cat.type` undefined (property doesn't exist yet), or runtime `undefined`.

- [ ] **Step 3: Implement the store changes**

In `src/backend/src/db/stores/category-store.ts`:

```ts
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
  type: 'duration' | 'rotation';
  consecutive_wear_days: number;
}
```

```ts
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
  type?: 'duration' | 'rotation';
  consecutive_wear_days?: number;
}
```

Update `create()`:

```ts
  create(data: CategoryCreate): Category {
    const result = db
      .prepare(
        `INSERT INTO categories
           (name, icon, initial_target_wear_duration_seconds, initial_max_wear_duration_seconds,
            rest_multiplier, minimum_rest, risk_levels, break_decay_multiplier, break_grace_time,
            type, consecutive_wear_days)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        data.type ?? 'duration',
        data.consecutive_wear_days ?? 1,
      );
    const category = this.find(result.lastInsertRowid as number)!;
    db.prepare('INSERT OR IGNORE INTO category_stats (category_id) VALUES (?)').run(category.id);
    return category;
  }
```

Update `ALLOWED_COLUMNS` in `update()` to include `'type'` and `'consecutive_wear_days'`:

```ts
    const ALLOWED_COLUMNS = new Set([
      'name',
      'icon',
      'initial_target_wear_duration_seconds',
      'initial_max_wear_duration_seconds',
      'rest_multiplier',
      'minimum_rest',
      'break_decay_multiplier',
      'break_grace_time',
      'risk_levels',
      'type',
      'consecutive_wear_days',
    ]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend exec vitest run tests/db/category-store.test.ts`
Expected: PASS (all tests in file, including the 3 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/db/stores/category-store.ts src/backend/tests/db/category-store.test.ts
git commit -m "feat(db): add type + consecutive_wear_days to category store"
```

---

### Task 4: `controllers/categories.ts` — accept `type` / `consecutive_wear_days`

**Files:**
- Modify: `src/backend/src/controllers/categories.ts`
- Test: `src/backend/tests/categories/controller.test.ts`

**Interfaces:**
- Consumes: `categoryStore.create` / `categoryStore.update` from Task 3 (both accept optional `type` / `consecutive_wear_days`).
- Produces: `POST /api/categories` and `PATCH /api/categories/:id` accept optional `type` (`'duration' | 'rotation'`) and `consecutive_wear_days` (positive integer) in the request body.

- [ ] **Step 1: Write the failing test**

Append to `src/backend/tests/categories/controller.test.ts` (check the top of that file first for its existing `CATEGORIES` base path constant and `sampleCategory` import pattern from `../fixtures.js`, then match it):

```ts
describe('rotation category fields', () => {
  it('POST accepts type=rotation and consecutive_wear_days', async () => {
    const res = await createCategory({ name: 'Socks', type: 'rotation', consecutive_wear_days: 2 });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.type).toBe('rotation');
    expect(body.consecutive_wear_days).toBe(2);
  });

  it('POST defaults type to duration when omitted', async () => {
    const res = await createCategory({ name: 'Default Socks' });
    const body = await res.json();
    expect(body.type).toBe('duration');
    expect(body.consecutive_wear_days).toBe(1);
  });

  it('POST rejects an invalid type', async () => {
    const res = await createCategory({ name: 'Bad Type', type: 'weekly' });
    expect(res.status).toBe(400);
  });

  it('PATCH updates type and consecutive_wear_days', async () => {
    const created = await (await createCategory({ name: 'Patchable' })).json();
    const res = await app.request(`/api/categories/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'rotation', consecutive_wear_days: 3 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe('rotation');
    expect(body.consecutive_wear_days).toBe(3);
  });
});
```

(Use whatever `app` import and `createCategory` helper the existing file already uses — it imports `createCategory` from `../fixtures.js` per the `sessions/controller.test.ts` pattern; match the exact import already present at the top of `categories/controller.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend exec vitest run tests/categories/controller.test.ts -t "rotation category fields"`
Expected: FAIL — `body.type` is `undefined` (controller doesn't read/return it) or 400 case fails because nothing validates `type`.

- [ ] **Step 3: Implement the controller changes**

In `src/backend/src/controllers/categories.ts`, add a validator near `validateRiskLevels`:

```ts
function validateType(type: unknown): type is 'duration' | 'rotation' {
  return type === 'duration' || type === 'rotation';
}
```

In the `POST /` handler, destructure and validate the two new optional fields, then pass them through:

```ts
  const {
    name,
    icon,
    initial_target_wear_duration_seconds,
    initial_max_wear_duration_seconds,
    rest_multiplier,
    minimum_rest,
    risk_levels,
    break_decay_multiplier,
    break_grace_time,
    type,
    consecutive_wear_days,
  } = body;

  if (!name || typeof name !== 'string') throw new ValidationError('name is required');
  if (!icon || typeof icon !== 'string') throw new ValidationError('icon is required');
  if (typeof initial_target_wear_duration_seconds !== 'number') throw new ValidationError('initial_target_wear_duration_seconds must be a number');
  if (initial_max_wear_duration_seconds !== null && typeof initial_max_wear_duration_seconds !== 'number') throw new ValidationError('initial_max_wear_duration_seconds must be a number or null');
  if (typeof rest_multiplier !== 'number') throw new ValidationError('rest_multiplier must be a number');
  if (typeof minimum_rest !== 'number') throw new ValidationError('minimum_rest must be a number');
  if (!validateRiskLevels(risk_levels)) throw new ValidationError('risk_levels must be an array of valid risk level objects');
  if (typeof break_decay_multiplier !== 'number') throw new ValidationError('break_decay_multiplier must be a number');
  if (typeof break_grace_time !== 'number') throw new ValidationError('break_grace_time must be a number');
  if (type !== undefined && !validateType(type)) throw new ValidationError("type must be 'duration' or 'rotation'");
  if (consecutive_wear_days !== undefined && (typeof consecutive_wear_days !== 'number' || consecutive_wear_days < 1)) {
    throw new ValidationError('consecutive_wear_days must be a positive number');
  }

  // categoryStore.create() also initialises the category_stats row
  const category = categoryStore.create({
    name,
    icon,
    initial_target_wear_duration_seconds,
    initial_max_wear_duration_seconds,
    rest_multiplier,
    minimum_rest,
    risk_levels,
    break_decay_multiplier,
    break_grace_time,
    type,
    consecutive_wear_days,
  });
```

In the `PATCH /:id` handler, add after the existing `break_grace_time` block:

```ts
  if ('type' in body) {
    if (!validateType(body.type)) throw new ValidationError("type must be 'duration' or 'rotation'");
    updates.type = body.type;
  }
  if ('consecutive_wear_days' in body) {
    if (typeof body.consecutive_wear_days !== 'number' || body.consecutive_wear_days < 1) {
      throw new ValidationError('consecutive_wear_days must be a positive number');
    }
    updates.consecutive_wear_days = body.consecutive_wear_days;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend exec vitest run tests/categories/controller.test.ts`
Expected: PASS (full file, including the 4 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/controllers/categories.ts src/backend/tests/categories/controller.test.ts
git commit -m "feat(api): accept type + consecutive_wear_days on category create/update"
```

---

### Task 5: `session-store.ts` — branch `start()`/`end()` by category type, add `findRecentInCategory`

**Files:**
- Modify: `src/backend/src/db/stores/session-store.ts`
- Test: `src/backend/tests/db/session-store.test.ts`

**Interfaces:**
- Consumes: `rotationAvailability` is NOT called here (that's controller-level, Task 6) — this task only makes `start`/`end` skip the duration formula for rotation categories, and adds the history lookup they'll need.
- Produces: `sessionStore.findRecentInCategory(categoryId: number, limit: number): { item_id: number }[]` (newest first). `start()`/`end()` behaviour: for `category.type === 'rotation'`, `target_wear_seconds = category.initial_target_wear_duration_seconds`, `max_wear_seconds = null`, `rest_seconds` stays `null` after `end()`.

- [ ] **Step 1: Write the failing tests**

Append to `src/backend/tests/db/session-store.test.ts`:

```ts
describe('sessionStore rotation category behaviour', () => {
  it('start() uses the fixed target and null max for a rotation category', () => {
    const rotationCat = categoryStore.create({
      name: 'Rotation', icon: 'x',
      initial_target_wear_duration_seconds: 57600, // 16h "all day"
      initial_max_wear_duration_seconds: null,
      rest_multiplier: 2, minimum_rest: 0,
      risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
      break_decay_multiplier: 0.91, break_grace_time: 86400,
      type: 'rotation', consecutive_wear_days: 1,
    });
    db.prepare(`INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (?,'ri','#fff',1)`).run(rotationCat.id);
    const rawRotationCat = db.prepare('SELECT * FROM categories WHERE id = ?').get(rotationCat.id) as never;
    const rotationItemId = (db.prepare('SELECT id FROM items WHERE category_id = ?').get(rotationCat.id) as { id: number }).id;

    const s = sessionStore.start(rotationItemId, rawRotationCat, item, 1000);
    expect(s.target_wear_seconds).toBe(57600);
    expect(s.max_wear_seconds).toBeNull();
  });

  it('end() leaves rest_seconds null for a rotation category', () => {
    const rotationCat = categoryStore.create({
      name: 'Rotation2', icon: 'x',
      initial_target_wear_duration_seconds: 57600,
      initial_max_wear_duration_seconds: null,
      rest_multiplier: 2, minimum_rest: 0,
      risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
      break_decay_multiplier: 0.91, break_grace_time: 86400,
      type: 'rotation', consecutive_wear_days: 1,
    });
    db.prepare(`INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (?,'ri2','#fff',1)`).run(rotationCat.id);
    const rawRotationCat = db.prepare('SELECT * FROM categories WHERE id = ?').get(rotationCat.id) as never;
    const rotationItemId = (db.prepare('SELECT id FROM items WHERE category_id = ? AND name = ?').get(rotationCat.id, 'ri2') as { id: number }).id;

    const started = sessionStore.start(rotationItemId, rawRotationCat, item, 20_000);
    const ended = sessionStore.end(started, rawRotationCat, 20_000 + 57600);
    expect(ended.rest_seconds).toBeNull();
    expect(ended.target_wear_seconds).toBe(57600);
  });
});

describe('sessionStore.findRecentInCategory', () => {
  it('returns sessions newest first, limited', () => {
    const cat = categoryStore.create({
      name: 'Recent', icon: 'x',
      initial_target_wear_duration_seconds: 100,
      initial_max_wear_duration_seconds: null,
      rest_multiplier: 1, minimum_rest: 0,
      risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
      break_decay_multiplier: 0.91, break_grace_time: 86400,
      type: 'rotation', consecutive_wear_days: 1,
    });
    db.prepare(`INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (?,'ra','#fff',1)`).run(cat.id);
    db.prepare(`INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (?,'rb','#fff',1)`).run(cat.id);
    const rawCat2 = db.prepare('SELECT * FROM categories WHERE id = ?').get(cat.id) as never;
    const itemA = (db.prepare('SELECT id FROM items WHERE category_id = ? AND name = ?').get(cat.id, 'ra') as { id: number }).id;
    const itemB = (db.prepare('SELECT id FROM items WHERE category_id = ? AND name = ?').get(cat.id, 'rb') as { id: number }).id;

    const s1 = sessionStore.start(itemA, rawCat2, item, 1_000_000);
    sessionStore.end(s1, rawCat2, 1_000_100);
    const s2 = sessionStore.start(itemB, rawCat2, item, 1_000_200);
    sessionStore.end(s2, rawCat2, 1_000_300);

    const recent = sessionStore.findRecentInCategory(cat.id, 10);
    expect(recent.map((r) => r.item_id)).toEqual([itemB, itemA]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix src/backend exec vitest run tests/db/session-store.test.ts -t "rotation category behaviour"`
Run: `npm --prefix src/backend exec vitest run tests/db/session-store.test.ts -t findRecentInCategory`
Expected: FAIL — `start()`/`end()` still run the duration formula (target won't equal the raw fixed value, max won't be `null`); `findRecentInCategory` doesn't exist.

- [ ] **Step 3: Implement the store changes**

In `src/backend/src/db/stores/session-store.ts`, update the `Category` import to include `type` and `consecutive_wear_days` (they already flow through from `calculations.ts`'s `Category` interface — that interface needs the two fields too; add them there in this same step):

In `src/backend/src/db/calculations.ts`, extend the `Category` interface used by the store/calculations layer:

```ts
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
  type: 'duration' | 'rotation';
  consecutive_wear_days: number;
}
```

Now in `session-store.ts`, replace `start()` and `end()`:

```ts
  /** Start a new session. category is the raw DB row; item supplies difficulty. */
  start(itemId: number, category: Category, item: { difficulty_multiplier: number }, startedAt: number): Session {
    let target: number;
    let max: number | null;

    if (category.type === 'rotation') {
      target = category.initial_target_wear_duration_seconds;
      max = null;
    } else {
      const previous = this.findLastEndedInCategory(category.id) ?? null;
      const injuryActive = injuryStore.hasActiveInCategory(category.id);
      ({ target, max } = computeSessionStart(category, item, previous, startedAt, injuryActive));
    }

    const result = db
      .prepare(
        'INSERT INTO sessions (item_id, started_at, target_wear_seconds, max_wear_seconds) VALUES (?, ?, ?, ?)',
      )
      .run(itemId, startedAt, target, max);
    return this.find(result.lastInsertRowid as number)!;
  }
```

```ts
  /** End a session: derive elapsed, compute rest, persist; target/max stay as set at start. */
  end(session: Session, category: Category, endedAt: number): Session {
    return db.transaction(() => {
      let rest: number | null;
      if (category.type === 'rotation') {
        rest = null;
      } else {
        const elapsed = endedAt - session.started_at;
        const injuryActive = injuryStore.hasActiveInCategory(category.id);
        const riskLevel = riskLevelFor(elapsed, category);
        rest = computeRest(elapsed, session.max_wear_seconds, category, riskLevel, injuryActive);
      }

      db.prepare('UPDATE sessions SET ended_at = ?, rest_seconds = ? WHERE id = ?').run(endedAt, rest, session.id);

      const updated = this.find(session.id)!;
      const snapshot = { ...updated, ended_at: endedAt };
      statsStore.recordItemSession(snapshot);
      statsStore.recordCategorySession(category.id, category.break_grace_time, snapshot);
      this.recordDayIndex(session.id);
      return updated;
    })();
  }
```

Add `findRecentInCategory` as a new method (near `findLastEndedInCategory`):

```ts
  /** Last `limit` sessions (any item) in a category, newest first. Feeds rotationAvailability. */
  findRecentInCategory(categoryId: number, limit: number): { item_id: number }[] {
    return db
      .prepare(
        `SELECT s.item_id FROM sessions s JOIN items i ON i.id = s.item_id
         WHERE i.category_id = ? AND s.ended_at IS NOT NULL
         ORDER BY s.ended_at DESC LIMIT ?`,
      )
      .all(categoryId, limit) as { item_id: number }[];
  }
```

Note: `updateEnd()` also calls `computeRest`/`riskLevelFor` directly — leave it as-is for this task; Task 5b below (folded into this task, see Step 3b) guards it too since a rotation session could in principle be edited.

- [ ] **Step 3b: Guard `updateEnd()` for rotation categories**

In the same file, update `updateEnd()`'s non-injury branch:

```ts
      const elapsed = newEndedAt - session.started_at;
      let rest: number | null;
      if (category.type === 'rotation') {
        rest = null;
      } else {
        const injuryActive = injuryStore.hasActiveInCategory(category.id);
        const riskLevel = riskLevelFor(elapsed, category);
        rest = computeRest(elapsed, session.max_wear_seconds, category, riskLevel, injuryActive);
      }

      db.prepare('UPDATE sessions SET ended_at = ?, rest_seconds = ? WHERE id = ?').run(
        newEndedAt,
        rest,
        session.id,
      );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix src/backend exec vitest run tests/db/session-store.test.ts`
Expected: PASS (full file)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/db/calculations.ts src/backend/src/db/stores/session-store.ts src/backend/tests/db/session-store.test.ts
git commit -m "feat(db): skip duration formula for rotation-category sessions"
```

---

### Task 6: `POST /api/sessions/start` — reject unavailable items for rotation categories

**Files:**
- Modify: `src/backend/src/controllers/sessions.ts`
- Test: `src/backend/tests/sessions/controller.test.ts`

**Interfaces:**
- Consumes: `rotationAvailability` (Task 2), `sessionStore.findRecentInCategory` (Task 5), `itemStore.findAll(categoryId)` (existing).
- Produces: `POST /api/sessions/start` returns 400 with a `ValidationError` when `item_id` belongs to a `rotation` category and isn't in the derived-available set. `duration` categories are unaffected (no new check runs for them).

- [ ] **Step 1: Write the failing test**

Append to `src/backend/tests/sessions/controller.test.ts` (reuse the file's existing `app`, `SESSIONS`, `createCategory`, `createItem` imports):

```ts
describe('POST /api/sessions/start — rotation availability', () => {
  it('rejects starting an item that was just worn, before the rest of the rotation has had a turn', async () => {
    const cat = await (await createCategory({
      name: 'Rotation Sessions', type: 'rotation', consecutive_wear_days: 1,
      initial_target_wear_duration_seconds: 57600, initial_max_wear_duration_seconds: null,
    })).json();
    const itemA = await (await createItem(cat.id, { name: 'A' })).json();
    await createItem(cat.id, { name: 'B' });

    const start1 = await app.request(`${SESSIONS}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemA.id }),
    });
    const session1 = await start1.json();
    await app.request(`${SESSIONS}/${session1.id}/end`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });

    const start2 = await app.request(`${SESSIONS}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemA.id }),
    });
    expect(start2.status).toBe(400);
  });

  it('allows starting an item whose turn it is', async () => {
    const cat = await (await createCategory({
      name: 'Rotation Sessions 2', type: 'rotation', consecutive_wear_days: 1,
      initial_target_wear_duration_seconds: 57600, initial_max_wear_duration_seconds: null,
    })).json();
    const itemA = await (await createItem(cat.id, { name: 'A2' })).json();
    const itemB = await (await createItem(cat.id, { name: 'B2' })).json();

    const start1 = await app.request(`${SESSIONS}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemA.id }),
    });
    const session1 = await start1.json();
    await app.request(`${SESSIONS}/${session1.id}/end`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });

    const start2 = await app.request(`${SESSIONS}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemB.id }),
    });
    expect(start2.status).toBe(201);
  });

  it('does not restrict duration categories', async () => {
    // itemId/categoryId from the outer beforeAll are a plain duration category.
    const s1 = await startSession();
    const body1 = await s1.json();
    await endSession(body1.id);
    const s2 = await startSession();
    expect(s2.status).toBe(201);
    const body2 = await s2.json();
    await endSession(body2.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend exec vitest run tests/sessions/controller.test.ts -t "rotation availability"`
Expected: FAIL — first test gets 201 instead of 400 (no validation exists yet).

- [ ] **Step 3: Implement the controller check**

In `src/backend/src/controllers/sessions.ts`, add imports:

```ts
import { itemStore } from '../db/stores/item-store.js';
import { rotationAvailability } from '../db/calculations.js';
```

(`itemStore` is already imported; just add `rotationAvailability` to the existing `calculations.js` import line.)

In the `POST /start` handler, after resolving `category` and before calling `sessionStore.start`:

```ts
  const category = categoryStore.findRaw(item.category_id)!;

  if (category.type === 'rotation') {
    const activeItemIds = itemStore.findAll(item.category_id).map((i) => i.id);
    const recent = sessionStore.findRecentInCategory(item.category_id, 100);
    const available = rotationAvailability(activeItemIds, recent);
    if (!available.has(item_id)) {
      throw new ValidationError(`Item ${item_id} is not available yet — it's another item's turn in the rotation`);
    }
  }

  const startTs = typeof started_at === 'number' ? started_at : nowSeconds();
  const session = sessionStore.start(item_id, category, item, startTs);
  return c.json(session, 201);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend exec vitest run tests/sessions/controller.test.ts`
Expected: PASS (full file)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/controllers/sessions.ts src/backend/tests/sessions/controller.test.ts
git commit -m "feat(api): reject session start for unavailable rotation-category items"
```

---

### Task 7: `GET /api/sessions/current` — `rotation_available` per item

**Files:**
- Modify: `src/backend/src/controllers/sessions.ts`
- Test: `src/backend/tests/sessions/controller.test.ts`

**Interfaces:**
- Consumes: `rotationAvailability` (Task 2), `sessionStore.findRecentInCategory` (Task 5).
- Produces: each entry in `items` returned by `GET /api/sessions/current` gains `rotation_available: boolean`. Always `true` for `duration` categories. Frontend Task 12 (`ActionPane.vue`) reads this exact field name.

- [ ] **Step 1: Write the failing test**

Append to `src/backend/tests/sessions/controller.test.ts`:

```ts
describe('GET /api/sessions/current — rotation_available', () => {
  it('marks the just-worn item unavailable and others available', async () => {
    const cat = await (await createCategory({
      name: 'Rotation Current', type: 'rotation', consecutive_wear_days: 1,
      initial_target_wear_duration_seconds: 57600, initial_max_wear_duration_seconds: null,
    })).json();
    const itemA = await (await createItem(cat.id, { name: 'CA' })).json();
    const itemB = await (await createItem(cat.id, { name: 'CB' })).json();

    const start1 = await app.request(`${SESSIONS}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemA.id }),
    });
    const session1 = await start1.json();
    await app.request(`${SESSIONS}/${session1.id}/end`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === cat.id);
    const rowA = entry.items.find((i: { item_id: number }) => i.item_id === itemA.id);
    const rowB = entry.items.find((i: { item_id: number }) => i.item_id === itemB.id);
    expect(rowA.rotation_available).toBe(false);
    expect(rowB.rotation_available).toBe(true);
  });

  it('duration category items are always rotation_available=true', async () => {
    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === categoryId);
    const ourItem = entry.items.find((i: { item_id: number }) => i.item_id === itemId);
    expect(ourItem.rotation_available).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend exec vitest run tests/sessions/controller.test.ts -t rotation_available`
Expected: FAIL — `rowA.rotation_available` / `ourItem.rotation_available` is `undefined`.

- [ ] **Step 3: Implement it**

In `src/backend/src/controllers/sessions.ts`, extend `ItemWithExpected` and `enrichItemsWithExpected`:

```ts
interface ItemWithExpected extends ItemWithLastSession {
  expected_target: number;
  expected_max: number | null;
  rotation_available: boolean;
}

function enrichItemsWithExpected(
  items: ItemWithLastSession[],
  category: Category,
  previous: PreviousSession | null,
  now: number,
  injuryActive: boolean,
  rotationAvailableIds: Set<number>,
): ItemWithExpected[] {
  return items.map((it) => {
    const { target, max } = computeSessionStart(
      category,
      { difficulty_multiplier: it.difficulty_multiplier },
      previous,
      now,
      injuryActive,
    );
    return {
      ...it,
      expected_target: target,
      expected_max: max,
      rotation_available: rotationAvailableIds.has(it.item_id),
    };
  });
}
```

In the `GET /current` handler, compute the rotation set per category before calling `enrichItemsWithExpected` and pass it through. Import `rotationAvailability` and `itemStore` (already imported from Task 6):

```ts
    categories.map((cat) => {
      const previous = sessionStore.findLastEndedInCategory(cat.id) ?? null;
      const injuryActive = injuryStore.hasActiveInCategory(cat.id);
      const { decay_start_time, decay_state, decay_full_time } = computeDecay(previous, cat, now);
      const streak_count = statsStore.findForCategory(cat.id)?.streak_count ?? 0;

      const rotationAvailableIds =
        cat.type === 'rotation'
          ? rotationAvailability(
              itemStore.findAll(cat.id).map((i) => i.id),
              sessionStore.findRecentInCategory(cat.id, 100),
            )
          : new Set((itemsByCategory.get(cat.id) ?? []).map((i) => i.item_id));

      const items = enrichItemsWithExpected(itemsByCategory.get(cat.id) ?? [], cat, previous, now, injuryActive, rotationAvailableIds);
```

(Everything after this line in the handler is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend exec vitest run tests/sessions/controller.test.ts`
Expected: PASS (full file)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/controllers/sessions.ts src/backend/tests/sessions/controller.test.ts
git commit -m "feat(api): expose rotation_available on GET /api/sessions/current"
```

---

### Task 8: `controllers/injuries.ts` — reject injuries for rotation categories

**Files:**
- Modify: `src/backend/src/controllers/injuries.ts`
- Test: `src/backend/tests/injuries/controller.test.ts`

**Interfaces:**
- Consumes: `category.type` (Task 3).
- Produces: `POST /api/injuries` returns 400 when the item's category has `type === 'rotation'`.

- [ ] **Step 1: Write the failing test**

Append to `src/backend/tests/injuries/controller.test.ts` (match the file's existing `app`/`createCategory`/`createItem`/`INJURIES` imports and constants):

```ts
describe('POST /api/injuries — rotation categories', () => {
  it('rejects recording an injury for a rotation-category item', async () => {
    const cat = await (await createCategory({
      name: 'Injury Rotation', type: 'rotation', consecutive_wear_days: 1,
      initial_target_wear_duration_seconds: 57600, initial_max_wear_duration_seconds: null,
    })).json();
    const item = await (await createItem(cat.id, { name: 'Injury Rotation Item' })).json();

    const res = await app.request(INJURIES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend exec vitest run tests/injuries/controller.test.ts -t "rotation categories"`
Expected: FAIL — currently returns 201 (injury recorded).

- [ ] **Step 3: Implement it**

In `src/backend/src/controllers/injuries.ts`, in the `POST /` handler, after resolving `category`:

```ts
  const category = categoryStore.findRaw(item.category_id)!;
  if (category.type === 'rotation') {
    throw new ValidationError('Injuries are not supported for rotation categories');
  }
```

Place this immediately after the existing `const category = categoryStore.findRaw(item.category_id)!;` line, before the `riskLevelFor` call.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend exec vitest run tests/injuries/controller.test.ts`
Expected: PASS (full file)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/controllers/injuries.ts src/backend/tests/injuries/controller.test.ts
git commit -m "feat(api): reject injuries for rotation categories"
```

---

### Task 9: Frontend types — `Category`, `ItemWithLastSession`

**Files:**
- Modify: `src/frontend/src/composables/useWear.ts`

**Interfaces:**
- Produces: `Category` gains `type: 'duration' | 'rotation'` and `consecutive_wear_days: number`. `ItemWithLastSession` gains `rotation_available: boolean`. Tasks 10–12 depend on these exact names.

No backend logic here — this is a pure type change consumed by the compiler, so there's no meaningful unit test; TypeScript compilation is the check (`npm --prefix src/frontend run build` or the existing `vue-tsc` step already in CI). Frontend tests in Task 10–12 exercise the new fields where behaviour actually changes.

- [ ] **Step 1: Update the types**

In `src/frontend/src/composables/useWear.ts`:

```ts
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
  type: 'duration' | 'rotation';
  consecutive_wear_days: number;
}
```

```ts
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
  rotation_available: boolean;
}
```

- [ ] **Step 2: Verify the frontend still type-checks**

Run: `npm --prefix src/frontend run build`
Expected: PASS — no TypeScript errors (no existing code destructures these interfaces in a way that would break from additive fields).

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/composables/useWear.ts
git commit -m "feat(frontend): add rotation fields to Category and ItemWithLastSession types"
```

---

### Task 10: `categoryDefaults.ts` / `categoryForm.ts` — rotation type + `consecutive_wear_days`

**Files:**
- Modify: `src/frontend/src/utils/categoryDefaults.ts`
- Modify: `src/frontend/src/utils/categoryForm.ts`
- Test: `src/frontend/src/utils/categoryForm.test.ts`

**Interfaces:**
- Consumes: `CategoryFormState` (Task 11 will add `type`/`consecutiveWearDays` fields to it — this task's mapping functions assume those fields exist, so do this task and Task 11's `CategoryFormState` change together in the same commit boundary: implement the `CategoryFormState` field additions here since `categoryForm.ts` needs them, and Task 11 wires up the actual form UI reading/writing them).
- Produces: `categoryToFormState(cat)` maps `cat.type` → `type`, `cat.consecutive_wear_days` → `consecutiveWearDays`. `formStateToApiPayload(data)` maps them back. `DEFAULT_CATEGORY_FIELDS` gains `type: 'duration'`, `consecutive_wear_days: 1`.

- [ ] **Step 1: Write the failing test**

Read `src/frontend/src/utils/categoryForm.test.ts` first to match its existing structure/fixtures, then append:

```ts
describe('rotation category mapping', () => {
  it('categoryToFormState maps type and consecutive_wear_days', () => {
    const state = categoryToFormState({
      name: 'Socks', icon: 'sock',
      initial_target_wear_duration_seconds: 57600,
      initial_max_wear_duration_seconds: null,
      rest_multiplier: 2, minimum_rest: 0,
      break_decay_multiplier: 0.91, break_grace_time: 86400,
      risk_levels: [{ lower: null, upper: null, text: 'x', severity: 1 }],
      type: 'rotation',
      consecutive_wear_days: 2,
    });
    expect(state.type).toBe('rotation');
    expect(state.consecutiveWearDays).toBe(2);
  });

  it('formStateToApiPayload maps type and consecutiveWearDays back', () => {
    const payload = formStateToApiPayload({
      name: 'Socks', icon: 'sock',
      initialWearTargetSeconds: 57600, initialWearMaxSeconds: null,
      minimumRestSeconds: 0, breakGraceSeconds: 86400, breakDecayMultiplier: 0.91,
      restMultiplier: 2, bandCount: 1, crossoverPoints: [],
      type: 'rotation', consecutiveWearDays: 2,
    });
    expect(payload.type).toBe('rotation');
    expect(payload.consecutive_wear_days).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/frontend exec vitest run src/utils/categoryForm.test.ts -t "rotation category mapping"`
Expected: FAIL — TS error, `type`/`consecutiveWearDays` don't exist on `CategoryFormState` / `CategoryApiShape` yet.

- [ ] **Step 3: Implement it**

In `src/frontend/src/utils/categoryForm.ts`:

```ts
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
  type: 'duration' | 'rotation';
  consecutive_wear_days: number;
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
    type: cat.type,
    consecutiveWearDays: cat.consecutive_wear_days,
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
  type: 'duration' | 'rotation';
  consecutive_wear_days: number;
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
    type: data.type,
    consecutive_wear_days: data.consecutiveWearDays,
  };
}
```

In `src/frontend/src/utils/categoryDefaults.ts`:

```ts
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
  type: 'duration',
  consecutive_wear_days: 1,
};
```

(This will not yet compile — `CategoryFormState` doesn't have `type`/`consecutiveWearDays` fields until Task 11. Do Task 11's `CategoryFormState` interface + `DEFAULT_STATE` edit now, as part of this same task, so the build is green before committing — see Step 3b.)

- [ ] **Step 3b: Add the two fields to `CategoryFormState` (prerequisite for the above to compile)**

In `src/frontend/src/components/CategoryForm.vue`, extend the exported interface and default state (template/UI wiring for these fields is Task 11 — this step only adds the data fields so the type-mapping in Step 3 compiles):

```ts
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
  type: 'duration' | 'rotation';
  consecutiveWearDays: number;
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
  type: 'duration',
  consecutiveWearDays: 1,
};
```

Also add both fields to the `emit('submit', ...)` payload in `onSubmit()`:

```ts
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
    type: catForm.type,
    consecutiveWearDays: catForm.consecutiveWearDays,
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/frontend exec vitest run src/utils/categoryForm.test.ts`
Expected: PASS (full file)

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/utils/categoryDefaults.ts src/frontend/src/utils/categoryForm.ts src/frontend/src/components/CategoryForm.vue src/frontend/src/utils/categoryForm.test.ts
git commit -m "feat(frontend): map rotation type + consecutive_wear_days in category form"
```

---

### Task 11: `CategoryForm.vue` — type selector + conditional fields

**Files:**
- Modify: `src/frontend/src/components/CategoryForm.vue`
- Test: `src/frontend/tests` — find the existing category-form component/E2E test file first (search for `CategoryForm` usage under `src/frontend/tests` or `src/frontend/src/components/__tests__`) and match its pattern; if none exists at the component level, add the assertions to the relevant E2E spec under `src/frontend/tests/e2e/` following its existing style for creating a category through the UI.

**Interfaces:**
- Consumes: `CategoryFormState.type` / `consecutiveWearDays` (Task 10).
- Produces: a segmented control (reuse the existing `SegmentedControl.vue` component already in `src/frontend/src/components/`) toggling `catForm.type` between `'duration'` and `'rotation'`; when `'rotation'`, the max/rest/decay/grace/risk-band sections are hidden and a `consecutiveWearDays` `NumberField` is shown instead.

- [ ] **Step 1: Inspect `SegmentedControl.vue` and `NumberField.vue` props**

Read `src/frontend/src/components/SegmentedControl.vue` and confirm its prop/event names (expect something like `modelValue`/`options`/`update:modelValue` per Vue convention — match whatever it actually exposes) before writing the template below. Adjust the template snippet in Step 2 to match the real prop names found.

- [ ] **Step 2: Add the type selector and conditional sections to the template**

In `src/frontend/src/components/CategoryForm.vue`, add directly under the icon/name row:

```html
    <SegmentedControl
      :modelValue="catForm.type"
      :options="[{ value: 'duration', label: 'Duration' }, { value: 'rotation', label: 'Rotation' }]"
      @update:modelValue="catForm.type = $event"
    />
```

(If `SegmentedControl`'s actual prop/event names differ from `modelValue`/`update:modelValue`, use the names found in Step 1 instead — do not guess past what the file shows.)

Wrap the existing "Maximum wear" `DurationTrigger`, the "Rest multiplier" `NumberField`, the "Minimum rest period" / "Break grace time" `DurationTrigger`s, the "Break decay / day" `NumberField`, the target/max explanatory `<p>`, and the whole "Risk bands" `<div>` block in:

```html
    <template v-if="catForm.type === 'duration'">
      <!-- ...existing max/rest/decay/grace/risk-band markup, unchanged... -->
    </template>
```

The "Target wear" `DurationTrigger` stays visible for both types (it's the fixed rotation target too). Add a rotation-only field right after it:

```html
    <NumberField
      v-if="catForm.type === 'rotation'"
      id="cat-consecutive-days"
      label="Consecutive wear days"
      v-model="catForm.consecutiveWearDays"
      :min="1"
      :default="1"
      :step="1"
    />
```

- [ ] **Step 3: Import `SegmentedControl` in the script block**

```ts
import SegmentedControl from './SegmentedControl.vue';
```

- [ ] **Step 4: Manually verify in the dev server**

Run: `npm run dev` (from repo root) and open the category creation form in a browser. Toggle Duration/Rotation and confirm the max/rest/decay/grace/risk-band UI hides and a "Consecutive wear days" field appears for Rotation, with Target wear staying visible in both modes.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/components/CategoryForm.vue
git commit -m "feat(frontend): add category type selector and rotation-only fields"
```

---

### Task 12: `ActionPane.vue` — rotation picker (forced label, "Wear something else", greyed options)

**Files:**
- Modify: `src/frontend/src/components/ActionPane.vue`

**Interfaces:**
- Consumes: `entry.category.type`, `entry.category.consecutive_wear_days` (Task 9), `entry.items[].rotation_available` (Task 7/9), `sessionStore` history already present in `entry` — the trailing-run count needs the same recent-session data used server-side; fetch it via a small new call to `GET /api/sessions?category_id=X&limit=N` (existing endpoint, `session-store.ts` `findAll`) since `entry.items` only carries the single last category-wide session per item, not a run of them.
- Produces: for `type === 'rotation'` categories in the idle (no active session) row, a forced-item label + "Wear something else" toggle, replacing the dropdown when locked; dropdown options `disabled` per `rotation_available` otherwise.

- [ ] **Step 1: Add a helper to fetch recent category sessions and derive the forced item**

In `src/frontend/src/components/ActionPane.vue`'s `<script setup>`, add local reactive state and a fetch helper:

```ts
import { ref } from 'vue'; // already imports reactive/onMounted — add ref to the existing import line

const recentSessionsByCategory = reactive<Record<number, { item_id: number }[]>>({});
const overrideLock = reactive<Record<number, boolean>>({});

async function loadRecentSessions(categoryId: number) {
  const res = await apiFetch(`/api/sessions?category_id=${categoryId}&limit=20`);
  if (!res.ok) return;
  const sessions: { item_id: number }[] = await res.json();
  recentSessionsByCategory[categoryId] = sessions; // already newest-first per session-store.findAll ORDER BY started_at DESC
}
```

Add `apiFetch` to the existing imports at the top of the file:

```ts
import { apiFetch } from '../utils/apiFetch.js';
```

- [ ] **Step 2: Compute the forced item per rotation category**

```ts
/** Trailing run length of the most-recent item at the front of `sessions` (newest first). */
function trailingRunLength(sessions: { item_id: number }[]): number {
  if (sessions.length === 0) return 0;
  const mostRecent = sessions[0].item_id;
  let count = 0;
  for (const s of sessions) {
    if (s.item_id !== mostRecent) break;
    count++;
  }
  return count;
}

function forcedItemId(entry: CurrentEntry): number | null {
  if (entry.category.type !== 'rotation') return null;
  const sessions = recentSessionsByCategory[entry.category.id];
  if (!sessions || sessions.length === 0) return null;
  const mostRecent = sessions[0].item_id;
  const runLength = trailingRunLength(sessions);
  if (runLength < entry.category.consecutive_wear_days) return mostRecent;
  return null;
}

function isLocked(entry: CurrentEntry): boolean {
  return forcedItemId(entry) !== null && !overrideLock[entry.category.id];
}

function forcedItemName(entry: CurrentEntry): string {
  const id = forcedItemId(entry);
  if (id === null) return '';
  return itemsForCategory(entry.category.id).find((i) => i.id === id)?.name ?? '';
}
```

- [ ] **Step 3: Load recent sessions on mount and after wear/stop for rotation categories**

In the existing `onMounted` block, after `await loadItems();`, add:

```ts
  for (const entry of currentSessions.value) {
    if (entry.category.type === 'rotation') await loadRecentSessions(entry.category.id);
  }
```

In `onWear` and `onStop`, after the existing `await startSession(itemId);` / `await endSession(entry.session.id);` calls succeed, add a refresh + reset of the override flag:

```ts
async function onWear(entry: CurrentEntry) {
  const itemId = selectedItem[entry.category.id];
  if (!itemId) return;
  try {
    await startSession(itemId);
    if (entry.category.type === 'rotation') {
      overrideLock[entry.category.id] = false;
      await loadRecentSessions(entry.category.id);
    }
  } catch (e) {
    showError(String(e));
  }
}

async function onStop(entry: CurrentEntry) {
  if (!entry.session) return;
  try {
    await endSession(entry.session.id);
    if (entry.category.type === 'rotation') {
      overrideLock[entry.category.id] = false;
      await loadRecentSessions(entry.category.id);
    }
  } catch (e) {
    showError(String(e));
  }
}
```

- [ ] **Step 4: Update the template's idle picker section**

Replace the existing `<template v-else>` (no-session) block inside `<template #after>` with a version that branches on lock state for rotation categories:

```html
            <template v-else>
              <div class="flex gap-2 items-center">
                <template v-if="isLocked(entry)">
                  <span class="text-sm font-medium" data-testid="forced-item-label">{{ forcedItemName(entry) }}</span>
                  <k-button small outline data-testid="wear-something-else" @click="overrideLock[entry.category.id] = true">Wear something else</k-button>
                  <k-button
                    small
                    @click="restRemainingSeconds(entry) > 0 ? showRestWarning(entry) : onWear({ ...entry, forcedItemOverride: forcedItemId(entry) })"
                  >Wear</k-button>
                </template>
                <template v-else>
                  <select
                    v-if="itemsForCategory(entry.category.id).length > 0"
                    v-model="selectedItem[entry.category.id]"
                    class="text-sm border rounded px-1 py-0.5"
                  >
                    <option
                      v-for="item in itemsForCategory(entry.category.id)"
                      :key="item.id"
                      :value="item.id"
                      :disabled="entry.category.type === 'rotation' && !itemRotationAvailable(entry, item.id)"
                    >{{ item.name }}</option>
                  </select>
                  <span v-else class="text-sm text-gray-400 italic">No items</span>
                  <k-button
                    small
                    :disabled="!selectedItem[entry.category.id]"
                    :class="{ 'opacity-60': restRemainingSeconds(entry) > 0 }"
                    @click="restRemainingSeconds(entry) > 0 ? showRestWarning(entry) : onWear(entry)"
                  >Wear</k-button>
                </template>
              </div>
            </template>
```

This introduces a simpler direct-wear path for the locked case instead of relying on `selectedItem`. Simplify `onWear` to accept an explicit item id and fall back to `selectedItem`:

```ts
async function onWear(entry: CurrentEntry, itemIdOverride?: number) {
  const itemId = itemIdOverride ?? selectedItem[entry.category.id];
  if (!itemId) return;
  try {
    await startSession(itemId);
    if (entry.category.type === 'rotation') {
      overrideLock[entry.category.id] = false;
      await loadRecentSessions(entry.category.id);
    }
  } catch (e) {
    showError(String(e));
  }
}
```

And simplify the locked-case Wear button to:

```html
                  <k-button
                    small
                    @click="restRemainingSeconds(entry) > 0 ? showRestWarning(entry) : onWear(entry, forcedItemId(entry) ?? undefined)"
                  >Wear</k-button>
```

Add the small helper used by the `:disabled` binding:

```ts
function itemRotationAvailable(entry: CurrentEntry, itemId: number): boolean {
  return entry.items.find((i) => i.item_id === itemId)?.rotation_available ?? true;
}
```

- [ ] **Step 5: Manually verify in the dev server**

Run: `npm run dev` from repo root. Create a rotation category with 3 items and `consecutive_wear_days = 2` via the UI (Task 11). Wear item A: verify a plain text label for A appears (not a dropdown) the next time the row is idle, with a "Wear something else" button. Click "Wear something else": verify the dropdown appears with B/C enabled and A disabled. Wear A again (via the forced label path) to complete the 2-day lock, then verify the dropdown appears directly (no forced label) with B/C available and A disabled.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/components/ActionPane.vue
git commit -m "feat(frontend): rotation category picker with consecutive-day lock UI"
```

---

## Self-review notes

- **Spec coverage:** migration (Task 1), derived availability algorithm (Task 2), category store/controller fields (Tasks 3–4), session start/end skipping the duration formula (Task 5), backend enforcement on start + `/current` annotation (Tasks 6–7), injury rejection (Task 8), frontend types (Task 9), form mapping + UI (Tasks 10–11), ActionPane picker incl. lock/override/greying (Task 12) — every section of the spec has a task.
- **No placeholders:** every step has literal code, not a description of code.
- **Type consistency:** `rotationAvailability(activeItemIds, recentSessions)` signature is identical everywhere it's called (Tasks 2, 6, 7). `rotation_available` (backend snake_case field name) is used consistently in Tasks 7, 9, 12. `consecutive_wear_days` (API/DB) vs `consecutiveWearDays` (frontend form state) follows the same snake_case/camelCase split already used for every other field in `categoryForm.ts` (e.g. `initial_target_wear_duration_seconds` / `initialWearTargetSeconds`).
- **Known follow-up for whoever executes Task 11/12:** `SegmentedControl.vue`'s exact prop names and the frontend test file location for `CategoryForm`/`ActionPane` weren't read during planning (to keep this plan finite) — Task 11 Step 1 and Task 12's manual-verification step are written to require checking the real file before finalizing the template, rather than guessing.
