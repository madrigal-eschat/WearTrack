# Sub-Project 4: Backend API — Design

## Goal

Expose REST API for Weartrack data layer using Hono + better-sqlite3, with middleware for logging and error handling.

## Stack

- **Runtime**: Node 24
- **Server**: Hono 4.x
- **Database**: better-sqlite3 (from sub-project 3)
- **Static serving**: Hono's static() middleware

## API Routes

### Categories

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/categories | List all categories |
| POST | /api/categories | Create new category |
| GET | /api/categories/:id | Get category by ID |
| PATCH | /api/categories/:id | Update category fields |
| DELETE | /api/categories/:id | Delete category (cascades) |

### Items

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/items | List all items |
| POST | /api/items | Create new item |
| GET | /api/items/:id | Get item by ID |
| PATCH | /api/items/:id | Update item fields |
| DELETE | /api/items/:id | Delete item (cascades) |

### Sessions

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/sessions | List sessions; optional `?item_id=` filter |
| GET | /api/sessions/current | One entry per category (null-object for idle) |
| GET | /api/sessions/:id | Get session by ID |
| POST | /api/sessions/start | Begin wear session |
| POST | /api/sessions/:id/end | Finish wear session |

### Injuries

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/injuries | List injuries; optional `?item_id=` filter |
| GET | /api/injuries/:id | Get injury by ID |
| POST | /api/injuries | Report a new injury |
| POST | /api/injuries/:id/heal | Mark injury as healed |

### Stats

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/stats/leaderboard/:type | Cross-item leaderboard (registered before /:item_id) |
| GET | /api/stats/:item_id | Cumulative stats for one item |
| GET | /api/stats/:item_id/history | Time-series from sessions; `?unit=month\|week` |

---

## Categories Model

```typescript
interface CategoryRow {
  id: number;
  name: string;
  icon: string;                          // SF Symbols name (e.g. "figure.walk")
  initial_wear_duration_seconds: number; // T0 — base wear before rest matters
  rest_multiplier: number;               // m in rest = m*wear + c
  rest_constant_seconds: number;         // c in rest = m*wear + c
  risk_levels: string;                   // JSON — parsed to RiskLevel[] on read
  break_decay_multiplier: number;        // e.g. 0.75
  break_starts_after_seconds: number;    // seconds before decay kicks in
}
```

`risk_levels` is stored as JSON text in SQLite and parsed on read. Each element:
```typescript
interface RiskLevel {
  lower: number | null;   // null means "from zero"
  upper: number | null;   // null means "no upper bound"
  text: string;           // e.g. "safe", "moderate", "high"
  severity: number;       // 1–5
}
```

### Categories API

#### GET /api/categories

Returns `200 OK` — array of category objects with `risk_levels` parsed as an array.

#### POST /api/categories

Returns `201 Created`.

```json
// Request
{
  "name": "Footwear",
  "icon": "figure.walk",
  "initial_wear_duration_seconds": 900,
  "rest_multiplier": 6,
  "rest_constant_seconds": 86400,
  "risk_levels": [
    { "lower": null, "upper": 14400, "text": "safe", "severity": 1 },
    { "lower": 14400, "upper": 28800, "text": "moderate", "severity": 2 },
    { "lower": 28800, "upper": null, "text": "high", "severity": 3 }
  ],
  "break_decay_multiplier": 0.75,
  "break_starts_after_seconds": 604800
}
```

#### PATCH /api/categories/:id

Returns `200 OK` — updated object. Accepts any subset of the writable fields.

#### DELETE /api/categories/:id

Returns `204 No Content`. Cascades to items → sessions, injuries, stats.

---

## Items Model

```typescript
interface ItemRow {
  id: number;
  category_id: number;
  name: string;
  color: string;                // hex colour e.g. "#ff0000"
  difficulty_multiplier: number; // 1.0 = normal; higher = harder
}
```

### Items API

#### GET /api/items

Returns `200 OK` — array of items.

#### POST /api/items

Returns `201 Created`.

```json
// Request
{
  "category_id": 1,
  "name": "Test Shoe",
  "color": "#ff0000",
  "difficulty_multiplier": 1.0  // optional; defaults to 1.0
}
```

#### PATCH /api/items/:id

Returns `200 OK` — updated item. Accepts any subset of writable fields.

---

## Sessions Model

```typescript
interface SessionRow {
  id: number;
  item_id: number;
  started_at: number;            // Unix timestamp
  ended_at: number | null;       // null while wearing
  calculated_wear_seconds: number;
  calculated_rest_seconds: number | null;  // null while wearing
  ended_in_injury: number;       // 0 or 1
}
```

All timestamps are Unix (seconds since epoch), not ISO 8601.

### Sessions API

#### GET /api/sessions/current

Returns `200 OK` — one entry per category, always the full list. Categories without an open session use the null-object pattern:

```json
[
  {
    "category": {
      "id": 1,
      "name": "Footwear",
      "icon": "figure.walk",
      "initial_wear_duration_seconds": 900,
      "rest_multiplier": 6,
      "rest_constant_seconds": 86400,
      "risk_levels": [{ "lower": null, "upper": 14400, "text": "safe", "severity": 1 }, ...],
      "break_decay_multiplier": 0.75,
      "break_starts_after_seconds": 604800
    },
    "item": {
      "id": 5,
      "category_id": 1,
      "name": "Test Shoe",
      "color": "#ff0000",
      "difficulty_multiplier": 1.0
    },
    "session": {
      "id": 123,
      "item_id": 5,
      "started_at": 1745000000,
      "ended_at": null,
      "calculated_wear_seconds": 900,
      "calculated_rest_seconds": null,
      "ended_in_injury": 0
    }
  },
  {
    "category": { "id": 2, "name": "Lifting", ... },
    "item": null,
    "session": null
  }
]
```

#### POST /api/sessions/start

Returns `201 Created` — new session row.

```json
// Request
{
  "item_id": 5,
  "started_at": 1745000000  // optional; defaults to current Unix time
}
```

Validation:
- `item_id` must be a number → `400`
- `started_at` if present must be a number → `400`
- Item must exist → `404`
- One session per **category**: if another item in the same category has an open session → `409`

Error 409 response:
```json
{
  "error": "Category already has an open session on item \"Test Shoe\" (id 5)",
  "conflicting_item": { "id": 5, "name": "Test Shoe" }
}
```

#### POST /api/sessions/:id/end

Returns `200 OK` — updated session row with `ended_at`, `calculated_wear_seconds`, and `calculated_rest_seconds` set.

```json
// Request (body optional)
{
  "ended_at": 1745003600  // optional; defaults to current Unix time
}
```

Validation:
- `ended_at` if present must be a number → `400`
- Session must exist → `404`
- Session must not already be ended → `400`

After ending, stats are updated immediately:
- `total_wear_seconds += calculated_wear_seconds`
- `session_count += 1`
- `max_single_session_wear_seconds = MAX(...)`
- Streak logic: carries forward if break ≤ `previous.calculated_rest_seconds + 86400`; otherwise resets

---

## Injuries Model

```typescript
interface InjuryRow {
  id: number;
  item_id: number;
  occurred_at: number;       // Unix timestamp
  healed_at: number | null;  // null until healed
  severity: number;          // 1–5, derived from risk_levels at time of injury
}
```

### Injuries API

#### POST /api/injuries

Returns `201 Created` — new injury row.

```json
// Request
{
  "item_id": 5,
  "wear_seconds": 18000  // optional; used to derive severity
}
```

`severity` is derived from `getRiskLevel(wear_seconds, category).severity`. Defaults to 1 if no wear data is provided and item has no current session.

Error responses:
- `400` — item already has an active injury (`healed_at IS NULL`)
- `400` — `item_id` missing
- `404` — item does not exist

#### POST /api/injuries/:id/heal

Returns `200 OK` — updated injury row with `healed_at` set to current Unix time.

- `400` — already healed
- `404` — not found

---

## Stats Model

```typescript
interface StatsRow {
  item_id: number;
  total_wear_seconds: number;
  session_count: number;
  max_single_session_wear_seconds: number;
  streak_wear_seconds: number;
  streak_count: number;
  best_streak_wear_seconds: number;
  best_streak_count: number;
}
```

### Stats API

#### GET /api/stats/:item_id

Returns `200 OK` — stats row (or zeroed object if no sessions yet).

```json
{
  "item_id": 5,
  "total_wear_seconds": 21600,
  "session_count": 3,
  "max_single_session_wear_seconds": 10800,
  "streak_wear_seconds": 21600,
  "streak_count": 3,
  "best_streak_wear_seconds": 21600,
  "best_streak_count": 3
}
```

#### GET /api/stats/leaderboard/:type

**Must be registered before `/:item_id`** to avoid route shadowing.

Supported `:type` values:

| type | sorted by |
|------|-----------|
| `longest-wear` | `max_single_session_wear_seconds DESC` |
| `most-total-wear` | `total_wear_seconds DESC` |
| `best-streak` | `best_streak_wear_seconds DESC` |
| `most-sessions` | `session_count DESC` |

Returns top 20 rows joining `stats → items → categories`.

#### GET /api/stats/:item_id/history?unit=month|week

Returns time-series aggregated from sessions:

```json
[
  { "period": "2026-04", "total_wear_seconds": 21600, "session_count": 3 },
  { "period": "2026-05", "total_wear_seconds": 7200, "session_count": 1 }
]
```

`unit=month` → `%Y-%m` format; `unit=week` → `%Y-%W` format.

---

## Middleware

### Error Handling

Registered via `app.onError()`:

```typescript
// middleware/errors.ts
export class NotFoundError extends Error { ... }
export class ConflictError extends Error {
  readonly details?: Record<string, unknown>;
}
export class ValidationError extends Error { ... }

export const errorHandler = (): ErrorHandler => (e, c) => {
  if (e instanceof NotFoundError)  return c.json({ error: 'Not found' }, 404);
  if (e instanceof ConflictError)  return c.json({ error: e.message, ...(e.details ?? {}) }, 409);
  if (e instanceof ValidationError) return c.json({ error: e.message }, 400);
  console.error('Unhandled error:', e);
  return c.json({ error: 'Internal server error' }, 500);
};
```

`ConflictError` carries a structured `details` object spread into the 409 response body (e.g. `conflicting_item`).

## Directory Structure

```
src/backend/
├── src/
│   ├── server.ts
│   ├── middleware/
│   │   └── errors.ts
│   ├── categories/
│   │   ├── controller.ts
│   │   └── router.ts
│   ├── items/
│   │   ├── controller.ts
│   │   └── router.ts
│   ├── sessions/
│   │   ├── controller.ts
│   │   └── router.ts
│   ├── injuries/
│   │   ├── controller.ts
│   │   └── router.ts
│   └── stats/
│       ├── controller.ts
│       └── router.ts
└── tests/
    ├── db/
    ├── categories/
    ├── items/
    ├── sessions/
    ├── injuries/
    └── stats/
```

## Notes

- **Timestamps**: All timestamps are Unix seconds (integers), not ISO 8601
- **Cascading deletes**: categories → items → sessions, injuries, stats
- **route registration order**: `GET /api/sessions/current` must be before `GET /api/sessions/:id`; `GET /api/stats/leaderboard/:type` must be before `GET /api/stats/:item_id`
- **Testing**: Tests use an in-memory SQLite DB (`:memory:`) reset via `runMigration()` in `beforeAll`
