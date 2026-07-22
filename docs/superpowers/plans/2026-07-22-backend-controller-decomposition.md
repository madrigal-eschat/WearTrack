# Backend Controller Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Category/Session controllers' write handlers into thin controllers + Command objects (validation + state change), add a Query object for the `/current` read endpoint, and enforce a cyclomatic-complexity lint gate so future growth is caught automatically.

**Architecture:** Controllers keep only request-level concerns (param coercion, response shaping). New `Command`/`Query` classes in `src/backend/src/commands/` and `src/backend/src/queries/` own validation and state changes/data assembly, using field-level validator functions composed together (the "validate() fans out" pattern). ESLint's built-in `complexity` rule (max 10) is scoped to `src/controllers/**` to enforce this going forward.

**Tech Stack:** TypeScript, Hono, better-sqlite3, Vitest, ESLint (typescript-eslint flat config).

## Global Constraints

- Scope: `src/backend/src/controllers/**/*.ts` only — do not touch `src/backend/src/db/stores/**` or `src/backend/src/db/calculations.ts`.
- No behavior change. Every existing test in `src/backend/tests/` must still pass unmodified.
- Reuse the existing error types (`ValidationError`, `NotFoundError`, `ConflictError` from `src/backend/src/middleware/errors.js`) — no new error-handling mechanism.
- Command/Query classes: one per file per domain (`src/backend/src/commands/categories.ts`, `src/backend/src/commands/sessions.ts`, `src/backend/src/queries/sessions.ts`).
- Only Category and Session domains get Command objects. `items.ts` PATCH (also over the complexity threshold) gets a narrower `validate()`/`buildUpdates()` helper fix, not a Command class.
- No Query objects beyond `sessions.ts` `/current`.

---

### Task 1: Extract Category Commands

**Files:**
- Create: `src/backend/src/commands/categories.ts`
- Create: `src/backend/tests/commands/categories.test.ts`
- Modify: `src/backend/src/controllers/categories.ts`

**Interfaces:**
- Consumes: `categoryStore` (`src/backend/src/db/stores/category-store.js`) — `create(data: CategoryCreate): Category`, `update(id: number, data: CategoryUpdate): Category`, exported types `Category`, `CategoryCreate`, `CategoryUpdate`. `RiskLevel` type from `src/backend/src/db/calculations.js`. `ValidationError` from `src/backend/src/middleware/errors.js`.
- Produces: `CreateCategoryCommand` (constructor takes `body: Record<string, unknown>`, method `run(): Category`), `UpdateCategoryCommand` (constructor takes `existing: Category, body: Record<string, unknown>`, method `run(): Category`) — both exported from `src/backend/src/commands/categories.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/backend/tests/commands/categories.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../src/db/migrations/index.js';
import { CreateCategoryCommand, UpdateCategoryCommand } from '../../src/commands/categories.js';
import { ValidationError } from '../../src/middleware/errors.js';

const validBody = {
  name: 'Rings',
  icon: 'ring',
  initial_target_wear_duration_seconds: 3600,
  initial_max_wear_duration_seconds: 7200,
  rest_multiplier: 2,
  minimum_rest: 1800,
  risk_levels: [{ lower: null, upper: null, text: 'Default', severity: 1 }],
  break_decay_multiplier: 0.9,
  break_grace_time: 3600,
};

beforeAll(() => {
  runMigrations();
});

describe('CreateCategoryCommand', () => {
  it('creates a category from a valid body', () => {
    const category = new CreateCategoryCommand({ ...validBody, name: 'Command Test 1' }).run();
    expect(category.id).toBeTypeOf('number');
    expect(category.name).toBe('Command Test 1');
    expect(category.type).toBe('duration');
    expect(category.consecutive_wear_days).toBe(1);
  });

  it('throws ValidationError when name is missing', () => {
    expect(() => new CreateCategoryCommand({ ...validBody, name: undefined }).run()).toThrow(ValidationError);
  });

  it('throws ValidationError when risk_levels is invalid', () => {
    expect(() => new CreateCategoryCommand({ ...validBody, risk_levels: 'nope' }).run()).toThrow(ValidationError);
  });

  it('throws ValidationError when type is invalid', () => {
    expect(() => new CreateCategoryCommand({ ...validBody, type: 'bogus' }).run()).toThrow(ValidationError);
  });

  it('accepts an explicit rotation type and consecutive_wear_days', () => {
    const category = new CreateCategoryCommand({
      ...validBody, name: 'Command Test Rotation', type: 'rotation', consecutive_wear_days: 3,
    }).run();
    expect(category.type).toBe('rotation');
    expect(category.consecutive_wear_days).toBe(3);
  });
});

describe('UpdateCategoryCommand', () => {
  it('applies only the fields present in the body', () => {
    const existing = new CreateCategoryCommand({ ...validBody, name: 'Command Test 2' }).run();
    const updated = new UpdateCategoryCommand(existing, { name: 'Renamed' }).run();
    expect(updated.name).toBe('Renamed');
    expect(updated.icon).toBe(existing.icon);
  });

  it('returns the existing category unchanged when the body has no recognised fields', () => {
    const existing = new CreateCategoryCommand({ ...validBody, name: 'Command Test 3' }).run();
    const updated = new UpdateCategoryCommand(existing, {}).run();
    expect(updated).toEqual(existing);
  });

  it('throws ValidationError when a present field is the wrong type', () => {
    const existing = new CreateCategoryCommand({ ...validBody, name: 'Command Test 4' }).run();
    expect(() => new UpdateCategoryCommand(existing, { rest_multiplier: 'nope' }).run()).toThrow(ValidationError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/backend && npx vitest run tests/commands/categories.test.ts`
Expected: FAIL — `Cannot find module '../../src/commands/categories.js'`

- [ ] **Step 3: Write the Command implementation**

Create `src/backend/src/commands/categories.ts`:

```ts
import { categoryStore, type Category, type CategoryCreate, type CategoryUpdate } from '../db/stores/category-store.js';
import { ValidationError } from '../middleware/errors.js';
import type { RiskLevel } from '../db/calculations.js';

function validateName(value: unknown): string {
  if (!value || typeof value !== 'string') throw new ValidationError('name is required');
  return value;
}

function validateIcon(value: unknown): string {
  if (!value || typeof value !== 'string') throw new ValidationError('icon is required');
  return value;
}

function validateTargetDuration(value: unknown): number {
  if (typeof value !== 'number') throw new ValidationError('initial_target_wear_duration_seconds must be a number');
  return value;
}

function validateMaxDuration(value: unknown): number | null {
  if (value !== null && typeof value !== 'number') {
    throw new ValidationError('initial_max_wear_duration_seconds must be a number or null');
  }
  return value === undefined ? null : value;
}

function validateRestMultiplier(value: unknown): number {
  if (typeof value !== 'number') throw new ValidationError('rest_multiplier must be a number');
  return value;
}

function validateMinimumRest(value: unknown): number {
  if (typeof value !== 'number') throw new ValidationError('minimum_rest must be a number');
  return value;
}

function validateRiskLevels(value: unknown): RiskLevel[] {
  const valid =
    Array.isArray(value) &&
    value.every(
      (l) =>
        typeof l === 'object' &&
        l !== null &&
        (l.lower === null || typeof l.lower === 'number') &&
        (l.upper === null || typeof l.upper === 'number') &&
        typeof l.text === 'string' &&
        typeof l.severity === 'number',
    );
  if (!valid) throw new ValidationError('risk_levels must be an array of valid risk level objects');
  return value as RiskLevel[];
}

function validateBreakDecayMultiplier(value: unknown): number {
  if (typeof value !== 'number') throw new ValidationError('break_decay_multiplier must be a number');
  return value;
}

function validateBreakGraceTime(value: unknown): number {
  if (typeof value !== 'number') throw new ValidationError('break_grace_time must be a number');
  return value;
}

function validateType(value: unknown): 'duration' | 'rotation' {
  if (value !== 'duration' && value !== 'rotation') throw new ValidationError("type must be 'duration' or 'rotation'");
  return value;
}

function validateConsecutiveWearDays(value: unknown): number {
  if (typeof value !== 'number' || value < 1) throw new ValidationError('consecutive_wear_days must be a positive number');
  return value;
}

export class CreateCategoryCommand {
  constructor(private readonly body: Record<string, unknown>) {}

  private validate(): CategoryCreate {
    const data: CategoryCreate = {
      name: validateName(this.body.name),
      icon: validateIcon(this.body.icon),
      initial_target_wear_duration_seconds: validateTargetDuration(this.body.initial_target_wear_duration_seconds),
      initial_max_wear_duration_seconds: validateMaxDuration(this.body.initial_max_wear_duration_seconds),
      rest_multiplier: validateRestMultiplier(this.body.rest_multiplier),
      minimum_rest: validateMinimumRest(this.body.minimum_rest),
      risk_levels: validateRiskLevels(this.body.risk_levels),
      break_decay_multiplier: validateBreakDecayMultiplier(this.body.break_decay_multiplier),
      break_grace_time: validateBreakGraceTime(this.body.break_grace_time),
    };
    if (this.body.type !== undefined) data.type = validateType(this.body.type);
    if (this.body.consecutive_wear_days !== undefined) {
      data.consecutive_wear_days = validateConsecutiveWearDays(this.body.consecutive_wear_days);
    }
    return data;
  }

  run(): Category {
    return categoryStore.create(this.validate());
  }
}

export class UpdateCategoryCommand {
  constructor(
    private readonly existing: Category,
    private readonly body: Record<string, unknown>,
  ) {}

  private buildUpdates(): CategoryUpdate {
    const updates: CategoryUpdate = {};
    if ('name' in this.body) updates.name = validateName(this.body.name);
    if ('icon' in this.body) updates.icon = validateIcon(this.body.icon);
    if ('initial_target_wear_duration_seconds' in this.body) {
      updates.initial_target_wear_duration_seconds = validateTargetDuration(this.body.initial_target_wear_duration_seconds);
    }
    if ('initial_max_wear_duration_seconds' in this.body) {
      updates.initial_max_wear_duration_seconds = validateMaxDuration(this.body.initial_max_wear_duration_seconds);
    }
    if ('rest_multiplier' in this.body) updates.rest_multiplier = validateRestMultiplier(this.body.rest_multiplier);
    if ('minimum_rest' in this.body) updates.minimum_rest = validateMinimumRest(this.body.minimum_rest);
    if ('risk_levels' in this.body) updates.risk_levels = validateRiskLevels(this.body.risk_levels);
    if ('break_decay_multiplier' in this.body) {
      updates.break_decay_multiplier = validateBreakDecayMultiplier(this.body.break_decay_multiplier);
    }
    if ('break_grace_time' in this.body) updates.break_grace_time = validateBreakGraceTime(this.body.break_grace_time);
    if ('type' in this.body) updates.type = validateType(this.body.type);
    if ('consecutive_wear_days' in this.body) {
      updates.consecutive_wear_days = validateConsecutiveWearDays(this.body.consecutive_wear_days);
    }
    return updates;
  }

  run(): Category {
    const updates = this.buildUpdates();
    if (Object.keys(updates).length === 0) return this.existing;
    return categoryStore.update(this.existing.id, updates);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/backend && npx vitest run tests/commands/categories.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Rewire the controller**

In `src/backend/src/controllers/categories.ts`, remove the `validateRiskLevels` and `validateType` module-level functions (lines 7–21) and add an import. The top of the file becomes:

```ts
import { Hono } from 'hono';
import { categoryStore } from '../db/stores/category-store.js';
import { statsStore } from '../db/stores/stats-store.js';
import { NotFoundError } from '../middleware/errors.js';
import { CreateCategoryCommand, UpdateCategoryCommand } from '../commands/categories.js';

export const router = new Hono();
```

Replace the entire `POST /` handler body with:

```ts
router.post('/', async (c) => {
  const body = await c.req.json();
  const category = new CreateCategoryCommand(body).run();
  return c.json(category, 201);
});
```

Replace the entire `PATCH /:id` handler body with:

```ts
router.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = categoryStore.find(id);
  if (!existing) throw new NotFoundError(`Category ${id} not found`);

  const body = await c.req.json();
  const category = new UpdateCategoryCommand(existing, body).run();
  return c.json(category);
});
```

Leave every other handler (`GET /`, `GET /:id/stats`, `GET /:id`, `DELETE /:id`) untouched. Note `ValidationError` is no longer used directly in this file — remove it from the import if no other handler references it (check with a search before removing).

- [ ] **Step 6: Run the full existing categories test suite**

Run: `cd src/backend && npx vitest run tests/categories`
Expected: PASS, same test count as before this task (behavior-preserving refactor)

- [ ] **Step 7: Commit**

```bash
git add src/backend/src/commands/categories.ts src/backend/tests/commands/categories.test.ts src/backend/src/controllers/categories.ts
git commit -m "refactor(backend): extract Category Commands from controller"
```

Note: the complexity lint rule doesn't exist yet (it's added in Task 5, after every offending handler is already fixed) — there is no lint-based check to run here.

---

### Task 2: Extract StartSessionCommand

**Files:**
- Create: `src/backend/src/commands/sessions.ts`
- Create: `src/backend/tests/commands/sessions.test.ts`
- Modify: `src/backend/src/controllers/sessions.ts`

**Interfaces:**
- Consumes: `sessionStore.start(itemId, category, item, startedAt)`, `sessionStore.findOpenInCategory`, `sessionStore.findSessionStartedTodayInCategory`, `sessionStore.findRecentInCategory` (all from `src/backend/src/db/stores/session-store.js`); `itemStore.find`, `itemStore.findAll` (`src/backend/src/db/stores/item-store.js`); `categoryStore.findRaw` (`src/backend/src/db/stores/category-store.js`); `rotationAvailability`, `isConsecutiveLockEligible`, `startOfTodayLocal` (`src/backend/src/db/calculations.js`); `nowSeconds` (`src/backend/src/utils/time.js`); `ValidationError`, `NotFoundError`, `ConflictError` (`src/backend/src/middleware/errors.js`).
- Produces: `StartSessionCommand` — constructor takes `body: Record<string, unknown>`, method `run(): Session` — exported from `src/backend/src/commands/sessions.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/backend/tests/commands/sessions.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../src/db/migrations/index.js';
import { StartSessionCommand } from '../../src/commands/sessions.js';
import { itemStore } from '../../src/db/stores/item-store.js';
import { categoryStore } from '../../src/db/stores/category-store.js';
import { ValidationError, NotFoundError, ConflictError } from '../../src/middleware/errors.js';

const baseCategory = {
  name: 'Command Sessions Test',
  icon: 'ring',
  initial_target_wear_duration_seconds: 3600,
  initial_max_wear_duration_seconds: 7200 as number | null,
  rest_multiplier: 2,
  minimum_rest: 1800,
  risk_levels: [{ lower: null, upper: null, text: 'Default', severity: 1 }],
  break_decay_multiplier: 0.9,
  break_grace_time: 3600,
};

beforeAll(() => {
  runMigrations();
});

describe('StartSessionCommand', () => {
  it('throws ValidationError when item_id is not a number', () => {
    expect(() => new StartSessionCommand({ item_id: 'x' }).run()).toThrow(ValidationError);
  });

  it('throws NotFoundError for an unknown item', () => {
    expect(() => new StartSessionCommand({ item_id: 999999 }).run()).toThrow(NotFoundError);
  });

  it('starts a duration-category session for a valid item', () => {
    const category = categoryStore.create({ ...baseCategory, name: 'Duration Cmd Cat' });
    const item = itemStore.create({ name: 'Item A', category_id: category.id, color: '#fff' });
    const session = new StartSessionCommand({ item_id: item.id, started_at: 1000 }).run();
    expect(session.item_id).toBe(item.id);
    expect(session.started_at).toBe(1000);
  });

  it('throws ConflictError when the category already has an open session', () => {
    const category = categoryStore.create({ ...baseCategory, name: 'Conflict Cmd Cat' });
    const itemA = itemStore.create({ name: 'A', category_id: category.id, color: '#fff' });
    const itemB = itemStore.create({ name: 'B', category_id: category.id, color: '#000' });
    new StartSessionCommand({ item_id: itemA.id, started_at: 2000 }).run();
    expect(() => new StartSessionCommand({ item_id: itemB.id, started_at: 2001 }).run()).toThrow(ConflictError);
  });

  it('throws ValidationError for a rotation item whose turn has not come up', () => {
    const category = categoryStore.create({ ...baseCategory, name: 'Rotation Cmd Cat', type: 'rotation' });
    const itemA = itemStore.create({ name: 'A', category_id: category.id, color: '#fff' });
    const itemB = itemStore.create({ name: 'B', category_id: category.id, color: '#000' });

    // A's session is on a prior day, so today's attempts don't trip the same-day daily cap —
    // this test is about rotation-availability, mirroring the existing controller test's convention.
    const yesterday = Math.floor(Date.now() / 1000) - 90000;
    const session = new StartSessionCommand({ item_id: itemA.id, started_at: yesterday }).run();
    sessionStore.end(sessionStore.find(session.id)!, categoryStore.findRaw(category.id)!, yesterday + 100);

    // itemA just went — itemB's turn now, itemA is not available yet.
    expect(() => new StartSessionCommand({ item_id: itemA.id }).run()).toThrow(ValidationError);
    expect(() => new StartSessionCommand({ item_id: itemB.id }).run()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/backend && npx vitest run tests/commands/sessions.test.ts`
Expected: FAIL — `Cannot find module '../../src/commands/sessions.js'`

- [ ] **Step 3: Write the Command implementation**

Create `src/backend/src/commands/sessions.ts`:

```ts
import { sessionStore, type Session } from '../db/stores/session-store.js';
import { itemStore, type Item } from '../db/stores/item-store.js';
import { categoryStore } from '../db/stores/category-store.js';
import { rotationAvailability, isConsecutiveLockEligible, startOfTodayLocal, type Category } from '../db/calculations.js';
import { NotFoundError, ValidationError, ConflictError } from '../middleware/errors.js';
import { nowSeconds } from '../utils/time.js';

export class StartSessionCommand {
  constructor(private readonly body: Record<string, unknown>) {}

  private validateInput(): { itemId: number; startedAt: number | undefined } {
    const { item_id, started_at } = this.body;
    if (typeof item_id !== 'number') throw new ValidationError('item_id must be a number');
    if (started_at !== undefined && typeof started_at !== 'number') {
      throw new ValidationError('started_at must be a Unix timestamp (number)');
    }
    return { itemId: item_id, startedAt: started_at as number | undefined };
  }

  private checkRotationEligibility(item: Item, category: Category, itemId: number): void {
    if (category.type !== 'rotation') return;

    const dayStart = startOfTodayLocal(nowSeconds());
    if (sessionStore.findSessionStartedTodayInCategory(item.category_id, dayStart)) {
      throw new ValidationError('Category has already had a session today');
    }

    const activeItemIds = itemStore.findAll(item.category_id).map((i) => i.id);
    const recent = sessionStore.findRecentInCategory(item.category_id, 100);
    const available = rotationAvailability(activeItemIds, recent);
    const consecutiveLockEligible = isConsecutiveLockEligible(recent, itemId, category.consecutive_wear_days);
    if (!available.has(itemId) && !consecutiveLockEligible) {
      throw new ValidationError(`Item ${itemId} is not available yet — it's another item's turn in the rotation`);
    }
  }

  run(): Session {
    const { itemId, startedAt } = this.validateInput();

    const item = itemStore.find(itemId);
    if (!item) throw new NotFoundError(`Item ${itemId} not found`);

    const conflict = sessionStore.findOpenInCategory(item.category_id);
    if (conflict) {
      throw new ConflictError(
        `Category already has an open session on item "${conflict.item_name}" (id ${conflict.item_id})`,
        { conflicting_item: { id: conflict.item_id, name: conflict.item_name } },
      );
    }

    const category = categoryStore.findRaw(item.category_id)!;
    this.checkRotationEligibility(item, category, itemId);

    const startTs = startedAt ?? nowSeconds();
    return sessionStore.start(itemId, category, item, startTs);
  }
}
```

Note: `categoryStore.findRaw` returns the raw DB row (risk_levels as JSON string), which matches the `Category` type expected by `db/calculations.js` — this is exactly what the current controller passes to `sessionStore.start`, so behavior is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/backend && npx vitest run tests/commands/sessions.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Rewire the controller**

In `src/backend/src/controllers/sessions.ts`, update the imports at the top — remove `rotationAvailability`, `isConsecutiveLockEligible` from the `calculations.js` import (still need `computeSessionStart`, `computeDecay`, `startOfTodayLocal`, `startOfNextLocalMidnight`, `type PreviousSession`, `type Category` for the rest of the file), and add:

```ts
import { StartSessionCommand } from '../commands/sessions.js';
```

Replace the entire `POST /start` handler body with:

```ts
router.post('/start', async (c) => {
  const body = await c.req.json();
  const session = new StartSessionCommand(body).run();
  return c.json(session, 201);
});
```

Leave every other handler untouched for now (the `/current` handler is Task 4).

- [ ] **Step 6: Run the full existing sessions test suite**

Run: `cd src/backend && npx vitest run tests/sessions`
Expected: PASS, same test count as before this task

- [ ] **Step 7: Commit**

```bash
git add src/backend/src/commands/sessions.ts src/backend/tests/commands/sessions.test.ts src/backend/src/controllers/sessions.ts
git commit -m "refactor(backend): extract StartSessionCommand from sessions controller"
```

---

### Task 3: Extract CurrentSessionsQuery

**Files:**
- Create: `src/backend/src/queries/sessions.ts`
- Create: `src/backend/tests/queries/sessions.test.ts`
- Modify: `src/backend/src/controllers/sessions.ts`

**Interfaces:**
- Consumes: `categoryStore.findAll`, `sessionStore.findOpenWithItemData`, `sessionStore.findAllLastSessions`, `sessionStore.findLastEndedInCategory`, `sessionStore.findRecentInCategory`, `sessionStore.findSessionStartedTodayInCategory`, `injuryStore.hasActiveInCategory`, `statsStore.findForCategory`, `itemStore.findAll`, `computeSessionStart`, `computeDecay`, `rotationAvailability`, `startOfTodayLocal`, `startOfNextLocalMidnight`, `nowSeconds`.
- Produces: `CurrentSessionsQuery` (no constructor args, method `run(): CurrentSessionEntry[]`), `CurrentSessionEntry` type — exported from `src/backend/src/queries/sessions.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/backend/tests/queries/sessions.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../src/db/migrations/index.js';
import { CurrentSessionsQuery } from '../../src/queries/sessions.js';
import { categoryStore } from '../../src/db/stores/category-store.js';
import { itemStore } from '../../src/db/stores/item-store.js';
import { sessionStore } from '../../src/db/stores/session-store.js';

const baseCategory = {
  name: 'Query Sessions Test',
  icon: 'ring',
  initial_target_wear_duration_seconds: 3600,
  initial_max_wear_duration_seconds: 7200 as number | null,
  rest_multiplier: 2,
  minimum_rest: 1800,
  risk_levels: [{ lower: null, upper: null, text: 'Default', severity: 1 }],
  break_decay_multiplier: 0.9,
  break_grace_time: 3600,
};

beforeAll(() => {
  runMigrations();
});

describe('CurrentSessionsQuery', () => {
  it('returns an entry per category with item=null/session=null when nothing is open', () => {
    const category = categoryStore.create({ ...baseCategory, name: 'Idle Query Cat' });
    const entries = new CurrentSessionsQuery().run();
    const entry = entries.find((e) => e.category.id === category.id)!;
    expect(entry).toBeDefined();
    expect(entry.item).toBeNull();
    expect(entry.session).toBeNull();
    expect(entry.decay_state).toBe('none');
  });

  it('returns item and session when a session is open', () => {
    const category = categoryStore.create({ ...baseCategory, name: 'Open Query Cat' });
    const item = itemStore.create({ name: 'Query Item', category_id: category.id, color: '#fff' });
    const raw = categoryStore.findRaw(category.id)!;
    sessionStore.start(item.id, raw, item, 1000);

    const entries = new CurrentSessionsQuery().run();
    const entry = entries.find((e) => e.category.id === category.id)!;
    expect(entry.item).not.toBeNull();
    expect(entry.item!.id).toBe(item.id);
    expect(entry.session).not.toBeNull();
    expect(entry.session!.item_id).toBe(item.id);
  });

  it('reports resting_until for a rotation category with a session already started today', () => {
    const category = categoryStore.create({ ...baseCategory, name: 'Rotation Query Cat', type: 'rotation' });
    const item = itemStore.create({ name: 'Rotation Item', category_id: category.id, color: '#fff' });
    const raw = categoryStore.findRaw(category.id)!;
    const session = sessionStore.start(item.id, raw, item, 500);
    sessionStore.end(session, raw, 900);

    const entries = new CurrentSessionsQuery().run();
    const entry = entries.find((e) => e.category.id === category.id)!;
    expect(entry.resting_until).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && npx vitest run tests/queries/sessions.test.ts`
Expected: FAIL — `Cannot find module '../../src/queries/sessions.js'`

- [ ] **Step 3: Write the Query implementation**

Create `src/backend/src/queries/sessions.ts`:

```ts
import { categoryStore, type Category } from '../db/stores/category-store.js';
import { itemStore } from '../db/stores/item-store.js';
import { sessionStore, type ItemWithLastSession, type OpenSessionWithItem } from '../db/stores/session-store.js';
import { injuryStore } from '../db/stores/injury-store.js';
import { statsStore } from '../db/stores/stats-store.js';
import {
  computeSessionStart,
  computeDecay,
  rotationAvailability,
  startOfTodayLocal,
  startOfNextLocalMidnight,
  type PreviousSession,
} from '../db/calculations.js';
import { nowSeconds } from '../utils/time.js';

interface ItemWithExpected extends ItemWithLastSession {
  expected_target: number;
  expected_max: number | null;
  rotation_available: boolean;
}

export interface CurrentSessionEntry {
  category: Category;
  item: { id: number; category_id: number; name: string; color: string; difficulty_multiplier: number } | null;
  session: {
    id: number;
    item_id: number;
    started_at: number;
    ended_at: number | null;
    target_wear_seconds: number;
    max_wear_seconds: number | null;
    rest_seconds: number | null;
    ended_in_injury: number;
  } | null;
  items: ItemWithExpected[];
  decay_start_time: number | null;
  decay_state: 'none' | 'decaying' | 'fully_decayed';
  decay_full_time: number | null;
  streak_count: number;
  resting_until: number | null;
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

export class CurrentSessionsQuery {
  run(): CurrentSessionEntry[] {
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

    return categories.map((cat) =>
      this.buildEntry(cat, sessionByCategory.get(cat.id), itemsByCategory.get(cat.id) ?? [], now),
    );
  }

  private buildEntry(
    cat: Category,
    openSession: OpenSessionWithItem | undefined,
    categoryItems: ItemWithLastSession[],
    now: number,
  ): CurrentSessionEntry {
    const previous = sessionStore.findLastEndedInCategory(cat.id) ?? null;
    const injuryActive = injuryStore.hasActiveInCategory(cat.id);
    const { decay_start_time, decay_state, decay_full_time } =
      cat.type === 'duration'
        ? computeDecay(previous, cat, now)
        : { decay_start_time: null, decay_state: 'none' as const, decay_full_time: null };
    const streak_count = statsStore.findForCategory(cat.id)?.streak_count ?? 0;

    const rotationAvailableIds =
      cat.type === 'rotation'
        ? rotationAvailability(
            itemStore.findAll(cat.id).map((i) => i.id),
            sessionStore.findRecentInCategory(cat.id, 100),
          )
        : new Set(categoryItems.map((i) => i.item_id));

    const restingUntil =
      cat.type === 'rotation' && sessionStore.findSessionStartedTodayInCategory(cat.id, startOfTodayLocal(now))
        ? startOfNextLocalMidnight(now)
        : null;

    const items = enrichItemsWithExpected(categoryItems, cat, previous, now, injuryActive, rotationAvailableIds);

    const entry: CurrentSessionEntry = {
      category: cat,
      item: null,
      session: null,
      items,
      decay_start_time,
      decay_state,
      decay_full_time,
      streak_count,
      resting_until: restingUntil,
    };

    if (openSession) {
      entry.item = {
        id: openSession.item_id,
        category_id: openSession.category_id,
        name: openSession.item_name,
        color: openSession.item_color,
        difficulty_multiplier: openSession.item_difficulty_multiplier,
      };
      entry.session = {
        id: openSession.id,
        item_id: openSession.item_id,
        started_at: openSession.started_at,
        ended_at: openSession.ended_at,
        target_wear_seconds: openSession.target_wear_seconds,
        max_wear_seconds: openSession.max_wear_seconds,
        rest_seconds: openSession.rest_seconds,
        ended_in_injury: openSession.ended_in_injury,
      };
    }

    return entry;
  }
}
```

This resolves the "build up one object" review comment: `buildEntry` now assembles a single `entry` object and conditionally fills in `item`/`session`, rather than branching into two near-duplicate `return` statements.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && npx vitest run tests/queries/sessions.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Rewire the controller**

In `src/backend/src/controllers/sessions.ts`:
- Remove the now-unused `enrichItemsWithExpected` function and `ItemWithExpected` interface (moved into the Query).
- Remove `computeDecay`, `rotationAvailability`, `startOfNextLocalMidnight` from the `calculations.js` import if nothing else in the file uses them (check remaining handlers first — `startOfTodayLocal` is still used by `/start`'s `StartSessionCommand`... no, that's now inside the Command, so check whether the controller file still needs any of these). Keep `computeSessionStart` only if still directly used elsewhere in the file (it isn't, after this change — remove it too).
- Add: `import { CurrentSessionsQuery } from '../queries/sessions.js';`

Replace the entire `GET /current` handler body with:

```ts
router.get('/current', (c) => {
  return c.json(new CurrentSessionsQuery().run());
});
```

- [ ] **Step 6: Run the full existing sessions test suite**

Run: `cd src/backend && npx vitest run tests/sessions`
Expected: PASS, same test count as before this task

- [ ] **Step 7: Commit**

```bash
git add src/backend/src/queries/sessions.ts src/backend/tests/queries/sessions.test.ts src/backend/src/controllers/sessions.ts
git commit -m "refactor(backend): extract CurrentSessionsQuery from sessions controller"
```

Note: the complexity lint rule doesn't exist yet (it's added in Task 5, after every offending handler is already fixed) — there is no lint-based check to run here.

---

### Task 4: Extract validate/buildUpdates helpers for items.ts PATCH

**Files:**
- Modify: `src/backend/src/controllers/items.ts`
- Modify: `src/backend/tests/items/controller.test.ts` (add coverage only if a gap is found in Step 1 — do not duplicate existing cases)

**Interfaces:**
- Produces: local (non-exported) functions `validateName`, `validateCategoryId`, `validateColor`, `validateDifficultyMultiplier`, `buildUpdates(body: Record<string, unknown>): ItemUpdate` in `src/backend/src/controllers/items.ts`.

- [ ] **Step 1: Check existing PATCH test coverage**

Run: `cd src/backend && npx vitest run tests/items/controller.test.ts --reporter=verbose`
Read the output and confirm there are existing cases for: valid partial update, invalid `category_id` type, non-existent `category_id`, invalid `color`/`difficulty_multiplier` type, and empty-body update returning the unchanged item. If any of these are missing, add a matching `it(...)` block to `src/backend/tests/items/controller.test.ts` following the existing file's style (`app.request` against `/api/items/:id`) before proceeding — this refactor must not reduce coverage.

- [ ] **Step 2: Extract the helpers**

In `src/backend/src/controllers/items.ts`, add above the router definitions:

```ts
function validateName(value: unknown): string {
  if (typeof value !== 'string') throw new ValidationError('name must be a string');
  return value;
}

function validateCategoryId(value: unknown): number {
  if (typeof value !== 'number') throw new ValidationError('category_id must be a number');
  if (!categoryStore.find(value)) throw new ValidationError(`Category ${value} does not exist`);
  return value;
}

function validateColor(value: unknown): string {
  if (typeof value !== 'string') throw new ValidationError('color must be a string');
  return value;
}

function validateDifficultyMultiplier(value: unknown): number {
  if (typeof value !== 'number') throw new ValidationError('difficulty_multiplier must be a number');
  return value;
}

function buildUpdates(body: Record<string, unknown>): Parameters<typeof itemStore.update>[1] {
  const updates: Parameters<typeof itemStore.update>[1] = {};
  if ('name' in body) updates.name = validateName(body.name);
  if ('category_id' in body) updates.category_id = validateCategoryId(body.category_id);
  if ('color' in body) updates.color = validateColor(body.color);
  if ('difficulty_multiplier' in body) updates.difficulty_multiplier = validateDifficultyMultiplier(body.difficulty_multiplier);
  return updates;
}
```

Replace the `PATCH /:id` handler body with:

```ts
router.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = itemStore.find(id);
  if (!existing) throw new NotFoundError(`Item ${id} not found`);

  const body = await c.req.json();
  const updates = buildUpdates(body);

  if (Object.keys(updates).length === 0) {
    return c.json(existing);
  }

  return c.json(itemStore.update(id, updates));
});
```

- [ ] **Step 3: Run the full existing items test suite**

Run: `cd src/backend && npx vitest run tests/items`
Expected: PASS, same or greater test count than before this task

- [ ] **Step 4: Commit**

```bash
git add src/backend/src/controllers/items.ts src/backend/tests/items/controller.test.ts
git commit -m "refactor(backend): extract validate/buildUpdates helpers in items PATCH"
```

Note: the complexity lint rule doesn't exist yet (it's added in Task 5, after every offending handler is already fixed) — there is no lint-based check to run here.

---

### Task 5: Add complexity lint gate for controllers

**Files:**
- Modify: `src/backend/eslint.config.js`

**Interfaces:** None (pure config change).

- [ ] **Step 1: Add the scoped `complexity` rule**

Replace the contents of `src/backend/eslint.config.js` with:

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  { ignores: ['node_modules/'] },
  {
    files: ['src/controllers/**/*.ts'],
    rules: {
      complexity: ['error', 10],
    },
  },
);
```

- [ ] **Step 2: Run lint to confirm the whole controllers directory is already clean**

Run: `cd src/backend && npm run lint`
Expected: zero errors. Tasks 1-4 already extracted Commands/Query/helpers from every handler that used to exceed complexity 10 (`categories.ts` POST/PATCH, `sessions.ts` `/current` and `/start`, `items.ts` PATCH), so this rule has nothing left to flag.

If anything unexpectedly fails, stop and report it before continuing — Tasks 1-4 should have already brought every controller handler under the threshold.

- [ ] **Step 3: Commit**

```bash
git add src/backend/eslint.config.js
git commit -m "chore(lint): gate backend controllers on cyclomatic complexity"
```

---

### Task 6: Full verification

**Files:** None (verification only).

- [ ] **Step 1: Run the full backend test suite**

Run: `cd src/backend && npm run test:ci`
Expected: All tests pass, count ≥ the pre-refactor 296 (per PR 11's own numbers), since new Command/Query tests were added and none were removed.

- [ ] **Step 2: Run lint across the whole backend**

Run: `cd src/backend && npm run lint`
Expected: Zero errors.

- [ ] **Step 3: Run a type-check**

Run: `cd src/backend && npx tsc -p tsconfig.build.json --noEmit`
Expected: Zero errors.

- [ ] **Step 4: Confirm no behavior change via a manual smoke check**

Run: `cd src/backend && npm run dev` in one terminal, then in another:

```bash
curl -s -X POST localhost:3000/api/categories -H 'Content-Type: application/json' -d '{"name":"Smoke","icon":"ring","initial_target_wear_duration_seconds":100,"initial_max_wear_duration_seconds":null,"rest_multiplier":1,"minimum_rest":0,"risk_levels":[],"break_decay_multiplier":1,"break_grace_time":0}'
```

Expected: `201` with a JSON category body (same shape as before this branch — compare against `git show worktree-rotation-category:src/backend/src/controllers/categories.ts`'s pre-refactor response if in doubt). Stop the dev server after checking.

This task produces no commit — it's a checkpoint before handing off for review/PR.
