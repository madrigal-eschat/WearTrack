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

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | /api/categories | CategoriesController#list | List all categories |
| POST | /api/categories | CategoriesController#create | Create new category |
| GET | /api/categories/:id | CategoriesController#get | Get category by ID |
| PUT | /api/categories/:id | CategoriesController#update | Update category formula |
| DELETE | /api/categories/:id | CategoriesController#delete | Delete category |

### Items

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | /api/items | ItemsController#list | List all items |
| POST | /api/items | ItemsController#create | Create new item |
| GET | /api/items/:id | ItemsController#get | Get item by ID |
| PUT | /api/items/:id | ItemsController#update | Update item |
| DELETE | /api/items/:id | ItemsController#delete | Delete item |

### Sessions

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| POST | /api/sessions/start/:itemId | SessionsController#start | Start wear session |
| POST | /api/sessions/end/:itemId | SessionsController#end | End wear session |
| GET | /api/sessions/:itemId | SessionsController#recent | List recent sessions |
| GET | /api/sessions/:itemId/current | SessionsController#current | Get current session |
| DELETE | /api/sessions/:itemId/current | SessionsController#forceEnd | Force end current session |

### Injuries

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| POST | /api/injuries/:itemId | InjuriesController#create | Report injury |
| GET | /api/injuries/:itemId | InjuriesController#get | Check injury status |
| DELETE | /api/injuries/:itemId | InjuriesController#delete | Mark healed |

### Stats

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | /api/stats/:itemId | StatsController#get | Get item stats |
| GET | /api/stats/category/:categoryId | StatsController#category | Category stats |
| GET | /api/stats/category/:categoryId/leaderboard | StatsController#leaderboard | Items ranked by wear |

## Categories Model

```typescript
interface CategorySchema {
  id: number;
  name: string;
  icon: string; // SF Symbols name (e.g., "dumbbell", "footprints")
  
  // Rest formula
  initial_wear: number; // Base wear time in seconds
  rest_multiplier: number; // y = mx + c coefficient
  rest_constant: number; // y = mx + c intercept
  
  // Risk levels (JSON array)
  risk_levels: {
    lower_threshold?: number; // null for first level
    upper_threshold: number; // upper bound, or null for last
    text: string; // e.g., "mild", "moderate", "severe"
    severity: 1 | 2 | 3 | 4 | 5; // numeric for calculations
  }[]; // validated non-overlapping: > lower, <= upper
  
  // Break penalty calculation
  break_decay_multiplier: number; // e.g., 0.75 for 75%
  break_penalty_period: number; // hours until break penalty starts

  // Injury handling
  injury_rest_multiplier: number; // e.g., 1.5x normal rest
}
```

### Categories API

#### GET /api/categories

Returns: `200 OK` - Array of category objects

```json
[{
  "id": 1,
  "name": "lifting",
  "icon": "dumbbell",
  "initial_wear": 900, // 15 minutes
  "rest_multiplier": 0.5,
  "rest_constant": 86400, // 24 hours
  "risk_levels": [
    { "lower_threshold": null, "upper_threshold": 14400, "text": "safe", "severity": 1 },
    { "lower_threshold": 14400, "upper_threshold": 28800, "text": "moderate", "severity": 2 },
    { "lower_threshold": 28800, "upper_threshold": 43200, "text": "high", "severity": 3 },
    { "lower_threshold": 43200, "upper_threshold": 64800, "text": "very_high", "severity": 4 },
    { "lower_threshold": 64800, "upper_threshold": null, "text": "extreme", "severity": 5 }
  ],
  "break_decay_multiplier": 0.75,
  "break_penalty_period": 24,
  "injury_rest_multiplier": 1.5
}]
```

#### POST /api/categories

Returns: `201 Created`

```json
// Request
{
  "name": "running",
  "icon": "footprints",
  "initial_wear": 1800, // 30 minutes
  "rest_multiplier": 0.4,
  "rest_constant": 172800, // 48 hours
  "risk_levels": [], // empty or array
  "break_decay_multiplier": 0.75,
  "break_penalty_period": 24,
  "injury_rest_multiplier": 1.5
}

// Note: risk_levels validation skipped for brevity
```

#### PUT /api/categories/:id

Returns: `200 OK` - Updated object

#### DELETE /api/categories/:id

Returns: `204 No Content` (cascading delete from items)

## Items Model

```typescript
interface ItemSchema {
  id: number;
  category_id: number;
  name: string;
  icon: string; // SF Symbols name
  color: string; // hex or name (e.g., "#FF6B6B")
  difficulty: number; // e.g., 1.0, 0.66 for 150% difficulty
}
```

### Items API

#### GET /api/items

Returns: `200 OK` - Array of items with category info

```json
[{
  "id": 1,
  "category_id": 1,
  "category": {
    "id": 1,
    "name": "lifting",
    "icon": "dumbbell"
  },
  "name": "Barbell",
  "icon": "dumbbell",
  "color": "#FF4444",
  "difficulty": 1.0
}]
```

#### POST /api/items

Returns: `201 Created`

```json
// Request
{
  "category_id": 1,
  "name": "Dumbbell",
  "icon": "dumbbell",
  "color": "#44FF44",
  "difficulty": 0.8
}
```

## Sessions Model

```typescript
interface WearSessionSchema {
  id: number;
  item_id: number;
  category_id: number; // FK cascade via items
  started_at: string; // ISO 8601
  ended_at: string | null; // ISO 8601, null if active
  calculated_wear: number; // seconds
  calculated_rest: number | null; // seconds, null if still wearing
  injury: boolean;
}
```

### Sessions API

#### POST /api/sessions/start/:itemId

Returns: `201 Created`

```json
// Response
{
  "id": 123,
  "item_id": 5,
  "started_at": "2026-04-21T10:00:00Z",
  "category_id": 1,
  "item": { "id": 5, "name": "Barbell", "icon": "dumbbell" },
  "state": "wearing",
  "effective_wear": 3600,
  "effective_rest": 900
}
```

Note: Injury check not done here - injury state retrieved via `/api/injuries/:itemId` endpoint.

Error responses:

- `409 Conflict` - Already wearing (active session exists)
- `500 Internal Server Error` - DB error

#### POST /api/sessions/end/:itemId

Returns: `200 OK` - Session with calculated rest and injury info

```json
// Normal end (no injury)
{
  "id": 123,
  "ended_at": "2026-04-21T12:00:00Z",
  "calculated_wear": 3600,
  "calculated_rest": 1800,
  "injury_reported": false,
  "state": "resting"
}

// Injury occurred
{
  "id": 123,
  "ended_at": "2026-04-21T12:00:00Z",
  "calculated_wear": 3600,
  "calculated_rest": 5400, // extended with injury rest multiplier
  "injury_reported": true,
  "injury": {
    "id": 456,
    "severity": 2,
    "occurred_at": "2026-04-21T12:00:00Z",
    "heals_at": "2026-04-24T12:00:00Z"
  },
  "state": "injured"
}
```

Error:

- `409 Conflict` - No active session to end
- `400 Bad Request` - Injury already active

Returns injury record with injury ID for tracking.

#### GET /api/sessions/:itemId

Returns: `200 OK` - Recent sessions (last 30 days, descending by started_at)

#### GET /api/sessions/:itemId/current

Returns: `200 OK` - Active session or null

#### DELETE /api/sessions/:itemId/current

Returns: `204 No Content` (forces end current session)

### Injuries API

#### POST /api/sessions/:itemId

Reports injury when ending session (injured: true in response).

#### GET /api/injuries/:itemId

Returns: `200 OK` - Active injury or null

```json
// With injury
{
  "item_id": 5,
  "injury_id": 456,
  "occurred_at": "2026-04-21T12:00:00Z",
  "heals_at": "2026-04-24T12:00:00Z",
  "severity": 2,
  "days_remaining": 3
}

// No injury
null
```

#### DELETE /api/injuries/:itemId

Returns: `204 No Content` - Mark injury as healed

## Stats Model

```typescript
interface ItemStatsSchema {
  id: number;
  item_id: number;
  max_wear: number; // max single session
  streak_count: number; // completed streaks
  streak_wear: number; // longest streak
  total_wear: number; // cumulative
  session_count: number; // total sessions
  month_wear_yoy: number | null; // current month vs last year
}
```

### Stats API

#### GET /api/stats/:itemId

Returns: `200 OK` - Item stats

```json
{
  "item_id": 5,
  "max_wear": 3600,
  "streak_count": 3,
  "streak_wear": 3300,
  "total_wear": 6300,
  "session_count": 3,
  "month_wear_yoy": 5
}
```

#### GET /api/stats/category/:categoryId

Returns: `200 OK` - Category stats (aggregate of items)

```json
{
  "category_id": 1,
  "category": { "id": 1, "name": "lifting" },
  "items": [
    { "id": 1, "name": "Barbell", "max_wear": 3600, "total_wear": 6300, "session_count": 3 },
    { "id": 2, "name": "Dumbbell", "max_wear": 2400, "total_wear": 2000, "session_count": 1 }
  ]
}
```

#### GET /api/stats/category/:categoryId/leaderboard

Returns: `200 OK` - Items sorted by total_wear descending

```json
[{
  "id": 1,
  "name": "Barbell",
  "rank": 1,
  "max_wear": 3600,
  "streak_count": 3,
  "streak_wear": 3300,
  "total_wear": 6300,
  "session_count": 3,
  "color": "#FF4444"
}]
```

## Middleware

### Logging Middleware

```typescript
// middleware/logging.js
const log = (req, res) => {
  const logger = console; // Could use winston/pino
  logger.info(`${req.method} ${req.url} - ${req.method} ${req.path}`);
};
```

### Error Handling Middleware

```typescript
// middleware/errors.js
const errorHandler = (err, c) => {
  if (err.name === 'NotFoundError') {
    return c.json({ error: 'Not found' }, 404);
  }
  if (err.name === 'ConflictError') {
    return c.json({ error: 'Conflict' }, 409);
  }
  // Other errors
  return c.json({ error: err.message || 'Internal error' }, 500);
};
```

### Usage in server.js

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import static from 'hono/jsx/static';
import { log } from './middleware/logging';
import { errorHandler } from './middleware/errors';
import { items, categories } from './controllers';

const app = new Hono();

// CORS for PWA
app.use('*', cors());

// Logging
app.use('*', log);

// Error handler (catch-all)
// Already registered below

// Static files
app.route('/', static(path.join(import.meta.dirname, 'frontend/build')));

// API routes
app.get('/api/categories', categories.list);
app.post('/api/categories', bodyParser(), categories.create);
// ... etc
```

## Directory Structure

```
src/backend/
├── src/
│   ├── server.js              # Hono app entry
│   ├── middleware/
│   │   ├── logging.js
│   │   └── errors.js
│   ├── items/
│   │   ├── controller.js
│   │   └── router.js
│   ├── categories/
│   │   ├── controller.js
│   │   └── router.js
│   ├── sessions/
│   │   ├── controller.js
│   │   └── router.js
│   ├── injuries/
│   │   ├── controller.js
│   │   └── router.js
│   └── stats/
│       ├── controller.js
│       └── router.js
├── db/
│   ├── index.js              # better-sqlite3 connection
│   └── schema.js             # Table definitions
├── package.json
└── tests/
    └── db/
```

## Validation

- **risk_levels array**: validated non-overlapping:

```typescript
function validateRiskLevels(levels) {
  let lower = null;
  for (const level of levels) {
    if (lower !== null && (level.lower_threshold ?? -Infinity) <= lower) {
      throw new Error('Overlapping risk levels');
    }
    lower = level.upper_threshold ?? Infinity;
  }
}
```

- **icon**: SF Symbols name (non-empty string)
- **color**: hex or named color

## Error Handling

- **NotFoundError**: 404
- **ConflictError**: 409
- **ValidationError**: 400
- **General errors**: 500

## Notes

- **Transactions**: Sessions CRUD use transactions (insert session, update stats)
- **Timestamps**: All timestamps ISO 8601 UTC
- **Cascading deletes**: items → wear_sessions, injuries, streaks, breaks, stats, goals