# Full Implementation Plan: Weartrack Monolith

**Date**: 2026-04-21
**Status**: Draft
**Target**: Implement all 5 sub-projects in order (1 → 5)

---

## Overview

This plan implements the Weartrack monolith with:
- **Subproject 1**: Infrastructure (Docker Compose, Dockerfile, package.json)
- **Subproject 2**: GitLab CI/CD pipeline
- **Subproject 3**: SQLite data layer with migrations
- **Subproject 4**: Hono backend API
- **Subproject 5**: Vue 3 PWA frontend

**Approach**: TDD — write test → verify fails → implement → verify passes → commit
**Time per task**: 2-5 minutes
**Total tasks**: ~50 (2-3 hours total)

IMPORTANT: Before each task, create a new branch. After implementing the task,
push the branch, and create a gitlab merge request against the previous tasks's branch.


---

## Project Structure

```
weartrack/
├── package.json                          # Root (npm workspaces)
├── docker-compose.yml
├── docker/
│   └── Dockerfile
├── .gitlab-ci.yml
├── .env
├── vitest.config.ts
├── src/
│   ├── backend/
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── middleware/
│   │   │   │   ├── logging.ts
│   │   │   │   └── errors.ts
│   │   │   ├── db/
│   │   │   │   ├── index.ts
│   │   │   │   ├── injury.ts
│   │   │   │   ├── calculations.ts
│   │   │   │   └── migrations/
│   │   │   │       ├── index.ts
│   │   │   │       └── 001_initial.ts
│   │   │   ├── categories/
│   │   │   │   ├── controller.ts
│   │   │   │   └── router.ts
│   │   │   ├── items/
│   │   │   │   ├── controller.ts
│   │   │   │   └── router.ts
│   │   │   ├── sessions/
│   │   │   │   ├── controller.ts
│   │   │   │   └── router.ts
│   │   │   ├── injuries/
│   │   │   │   ├── controller.ts
│   │   │   │   └── router.ts
│   │   │   └── stats/
│   │   │       ├── controller.ts
│   │   │       └── router.ts
│   │   └── tests/
│   │       ├── db/
│   │       ├── middleware/
│   │       ├── models/
│   │       └── e2e/
│   └── frontend/
│       ├── package.json
│       ├── vite.config.ts
│       ├── index.html
│       ├── src/
│       │   ├── App.vue
│       │   ├── main.ts
│       │   ├── router/
│       │   │   └── index.ts
│       │   ├── views/
│       │   │   ├── Home.vue
│       │   │   ├── Items.vue
│       │   │   ├── Stats.vue
│       │   │   └── Setup.vue
│       │   ├── components/
│       │   │   ├── ActionPane.vue
│       │   │   ├── CalendarPane.vue
│       │   │   ├── StatsPane.vue
│       │   │   ├── ItemsPane.vue
│       │   │   └── SettingsDrawer.vue
│       │   └── composables/
│       │       ├── useItems.ts
│       │       ├── useWear.ts
│       │       ├── useCalendar.ts
│       │       ├── useStats.ts
│       │       └── useCategories.ts
│       └── tests/
│           └── e2e/
│               └── playwright.config.ts
└── docs/
    └── superpowers/
        ├── specs/
        └── plans/
            └── 2026-04-21-full-implementation-plan.md
```

---

## Implementation Order

| Subproject | Description | Dependencies |
|------------|-------------|--------------|
| SP1 | Infrastructure | None |
| SP2 | CI/CD | SP1 (Dockerfile) |
| SP3 | Data Layer | SP1 (DB path) |
| SP4 | Backend API | SP3 (data layer) |
| SP5 | Frontend | SP4 (API) |

---

## Subproject 1: Infrastructure

### Task 1.1: Create Root package.json ✅

### Task 1.2: Create docker-compose.yml ✅

### Task 1.3: Create docker/Dockerfile ✅
- **Test**: `docker build -t weartrack:test .`
- **Steps**:
  - Stage 1: build (node:24-bookworm)
    - Copy package.json, package-lock.json
    - npm install
    - Copy source
    - Build Vue frontend
  - Stage 2: production (node:24-bookworm-slim)
    - Copy only prod deps
    - Copy built assets
    - Copy backend source
    - Expose port 3000
    - CMD: `node src/backend/src/server.ts`
- **File**: `docker/Dockerfile`

### Task 1.4: Create Frontend package.json ✅
- **Test**: N/A
- **Steps**:
  - Add Vue 3, Vite, Konsta UI, vite-plugin-pwa
  - Add testing deps (vitest, vue-test-utils)
  - Add Playwright for E2E
- **File**: `src/frontend/package.json`

### Task 1.5: Create Backend package.json ✅
- **Test**: N/A
- **Steps**:
  - Add Hono, better-sqlite3, cors
  - Add testing deps (vitest)
- **File**: `src/backend/package.json`

### Task 1.6: Create vitest.config.ts
- **Test**: N/A
- **Steps**:
  - Configure for monorepo
  - Set workspace root
- **File**: `vitest.config.ts`

### Task 1.7: Verify Docker Build
- **Steps**:
  - Run `docker compose build`
  - Run `docker compose up --build`
  - Verify API responds at localhost:3000

---

## Subproject 2: CI/CD

### Task 2.1: Create .gitlab-ci.yml
- **Test**: N/A
- **Steps**:
  - Define global variables
  - Include to-be-continuous templates
  - Configure lint, build, deploy stages
  - Set up manual approve for prod
- **File**: `.gitlab-ci.yml`

---

## Subproject 3: Data Layer

### Task 3.1: Create db/index.ts
- **Test**: Unit test connection
- **Steps**:
  - Create SQLite instance
  - Export prepared statements
- **File**: `src/backend/src/db/index.ts`

### Task 3.2: Create db/migrations/001_initial.ts
- **Test**: Verify migrations apply
- **Steps**:
  - Create meta table
  - Create categories table
  - Create items table
  - Create sessions table
  - Create injuries table
  - Create stats table
- **File**: `src/backend/src/db/migrations/001_initial.ts`

### Task 3.3: Create db/migrations/index.ts
- **Test**: Run migrations in temp DB
- **Steps**:
  - Read migration files
  - Track schema version
  - Apply pending migrations
- **File**: `src/backend/src/db/migrations/index.ts`

### Task 3.4: Create db/injury.ts
- **Test**: Unit tests for injury logic
- **Steps**:
  - Implement `getInjuredItem`
  - Implement `getHealedAt`
  - Implement `endInjury`
- **File**: `src/backend/src/db/injury.ts`

### Task 3.5: Create db/calculations.ts
- **Test**: Unit tests for formulas
- **Steps**:
  - Implement `calculateRest`
  - Implement `getRiskLevel`
  - Implement `calculateBreakWear`
- **File**: `src/backend/src/db/calculations.ts`

### Task 3.6: Create models/interfaces.ts
- **Test**: N/A
- **Steps**:
  - Define TypeScript interfaces
  - Category, Item, Session, Injury, Stats models
- **File**: `src/backend/src/models/interfaces.ts`

---

## Subproject 4: Backend API

### Task 4.1: Create src/backend/src/server.ts
- **Test**: Start server + test /api/health
- **Steps**:
  - Create Hono app
  - Register CORS middleware
  - Add logging middleware
  - Add error handler
  - Mount static frontend
  - Register API routes
- **File**: `src/backend/src/server.ts`

### Task 4.2: Create middleware/logging.ts
- **Test**: Log request/response
- **Steps**:
  - Log request method/path
  - Log response status
- **File**: `src/backend/src/middleware/logging.ts`

### Task 4.3: Create middleware/errors.ts
- **Test**: Test error throwing
- **Steps**:
  - Define error classes (NotFoundError, ConflictError, ValidationError)
  - Create error handler middleware
- **File**: `src/backend/src/middleware/errors.ts`

### Task 4.4: Create Categories Controller
- **Test**: CRUD operations
- **Steps**:
  - Implement `list` (GET /api/categories)
  - Implement `get` (GET /api/categories/:id)
  - Implement `create` (POST /api/categories)
  - Implement `update` (PUT /api/categories/:id)
  - Implement `delete` (DELETE /api/categories/:id)
- **File**: `src/backend/src/categories/controller.ts`

### Task 4.5: Create Categories Router
- **Test**: Register routes
- **Steps**:
  - Define route paths
  - Wire endpoints to controller methods
- **File**: `src/backend/src/categories/router.ts`

### Task 4.6: Create Items Controller
- **Test**: CRUD operations
- **Steps**:
  - Implement `list` (GET /api/items)
  - Implement `get` (GET /api/items/:id)
  - Implement `create` (POST /api/items)
  - Implement `update` (PUT /api/items/:id)
  - Implement `delete` (DELETE /api/items/:id)
- **File**: `src/backend/src/items/controller.ts`

### Task 4.7: Create Items Router
- **Test**: Register routes
- **File**: `src/backend/src/items/router.ts`

### Task 4.8: Create Sessions Controller
- **Test**: Session lifecycle
- **Steps**:
  - Implement `startSession` (POST /api/sessions/start/:itemId)
  - Implement `endSession` (POST /api/sessions/end/:itemId)
  - Implement `getCurrent` (GET /api/sessions/:itemId/current)
  - Implement `getRecent` (GET /api/sessions/:itemId)
  - Implement `forceEnd` (DELETE /api/sessions/:itemId/current)
- **File**: `src/backend/src/sessions/controller.ts`

### Task 4.9: Create Sessions Router
- **Test**: Register routes
- **File**: `src/backend/src/sessions/router.ts`

### Task 4.10: Create Injuries Controller
- **Test**: Injury lifecycle
- **Steps**:
  - Implement `createInjury` (POST /api/injuries/:itemId)
  - Implement `getInjury` (GET /api/injuries/:itemId)
  - Implement `deleteInjury` (DELETE /api/injuries/:itemId)
- **File**: `src/backend/src/injuries/controller.ts`

### Task 4.11: Create Injuries Router
- **Test**: Register routes
- **File**: `src/backend/src/injuries/router.ts`

### Task 4.12: Create Stats Controller
- **Test**: Stats aggregation
- **Steps**:
  - Implement `getItemStats` (GET /api/stats/:itemId)
  - Implement `getCategoryStats` (GET /api/stats/category/:categoryId)
  - Implement `getLeaderboard` (GET /api/stats/category/:categoryId/leaderboard)
- **File**: `src/backend/src/stats/controller.ts`

### Task 4.13: Create Stats Router
- **Test**: Register routes
- **File**: `src/backend/src/stats/router.ts`

### Task 4.14: Run Full Test Suite
- **Steps**:
  - Run `npm test` in backend
  - Verify all tests pass
- **Command**: `npm test`

---

## Subproject 5: Frontend

### Task 5.1: Create vite.config.ts
- **Test**: Build succeeds
- **Steps**:
  - Configure Vue plugin
  - Configure PWA plugin with manifest
  - Configure Workbox caching
  - Add base path for SSR compatibility
- **File**: `src/frontend/vite.config.ts`

### Task 5.2: Create index.html
- **Test**: Open in browser
- **Steps**:
  - Add meta tags for PWA
  - Add Konsta UI CDN reference
  - Add Apple meta tags
- **File**: `src/frontend/index.html`

### Task 5.3: Create main.ts
- **Test**: Import works
- **Steps**:
  - Create Vue app instance
  - Mount router
  - Mount App component
- **File**: `src/frontend/src/main.ts`

### Task 5.4: Create App.vue
- **Test**: Render successfully
- **Steps**:
  - Create root layout
  - Use Konsta UI KPage
- **File**: `src/frontend/src/App.vue`

### Task 5.5: Create Router
- **Test**: Navigation works
- **Steps**:
  - Create routes (/) → Home
  - (items) → Items view
  - (stats) → Stats view
  - (setup) → Setup view (empty state)
- **File**: `src/frontend/src/router/index.ts`

### Task 5.6: Create Home View
- **Test**: Layout renders
- **Steps**:
  - Create two-pane layout
  - Render CategoryList (top)
  - Render CalendarPane (bottom)
- **File**: `src/frontend/src/views/Home.vue`

### Task 5.7: Create Items View
- **Test**: Items list renders
- **Steps**:
  - Load items from composable
  - Render list
  - Add new item button
- **File**: `src/frontend/src/views/Items.vue`

### Task 5.8: Create Stats View
- **Test**: Leaderboard renders
- **Steps**:
  - Render leaderboard selector
  - Render sorted stats
  - Render points badges
- **File**: `src/frontend/src/views/Stats.vue`

### Task 5.9: Create Setup View
- **Test**: Empty state renders
- **Steps**:
  - Show welcome message
  - Add "Add Categories" button
- **File**: `src/frontend/src/views/Setup.vue`

### Task 5.10: Create useItems Composable
- **Test**: Fetch works
- **Steps**:
  - Implement `items` ref
  - Implement `loadItems` async function
  - Implement `wearAction`
  - Implement `formatTime`
- **File**: `src/frontend/src/composables/useItems.ts`

### Task 5.11: Create useCategories Composable
- **Test**: CRUD works
- **Steps**:
  - Implement `categories` ref
  - Implement `loadCategories`
  - Implement CRUD functions
  - Implement `injuredUntil`
- **File**: `src/frontend/src/composables/useCategories.ts`

### Task 5.12: Create useWear Composable
- **Test**: Start/end sessions
- **Steps**:
  - Implement `startSession`
  - Implement `endSession`
  - Handle injury reporting
- **File**: `src/frontend/src/composables/useWear.ts`

### Task 5.13: Create useCalendar Composable
- **Test**: Date navigation works
- **Steps**:
  - Implement date formatting
  - Implement day navigation
- **File**: `src/frontend/src/composables/useCalendar.ts`

### Task 5.14: Create useStats Composable
- **Test**: Stats load correctly
- **Steps**:
  - Implement `loadStats`
  - Implement `loadCategoryStats`
  - Implement `getLeaderboard`
- **File**: `src/frontend/src/composables/useStats.ts`

### Task 5.15: Create CategoryList Component
- **Test**: List renders with actions
- **Steps**:
  - Loop through items
  - Display icon, name, subtitle
  - Render wear/hold/rest indicators
  - Add action buttons (wear, stop wear)
- **File**: `src/frontend/src/components/CategoryList.vue`

### Task 5.16: Create ActionPane Component
- **Test**: Layout renders
- **Steps**:
  - Container div
  - Render CategoryList
- **File**: `src/frontend/src/components/ActionPane.vue`

### Task 5.17: Create CalendarPane Component
- **Test**: Calendar grid renders
- **Steps**:
  - Render day of week header
  - Render week days
  - Show worn indicator with duration
- **File**: `src/frontend/src/components/CalendarPane.vue`

### Task 5.18: Run Frontend E2E Tests
- **Test**: `npx playwright test`
- **Steps**:
  - Install Playwright browsers
  - Run test suite
  - Fix any failures

### Task 5.19: Verify Full Stack
- **Steps**:
  - Start `docker compose up`
  - Open localhost:3000
  - Test API endpoints
  - Test frontend navigation
  - Test PWA install

---

## Verification Checklist

### Infrastructure (SP1)
- [ ] Root package.json has workspaces
- [ ] docker-compose.yml builds successfully
- [ ] Dockerfile builds both stages
- [ ] Frontend package.json has all deps
- [ ] Backend package.json has all deps
- [ ] vitest.config.ts configured

### CI/CD (SP2)
- [ ] .gitlab-ci.yml has all stages
- [ ] Templates included correctly
- [ ] Manual deploy stages configured
- [ ] Playwright configured for E2E

### Data Layer (SP3)
- [ ] db/index.ts exports connection
- [ ] Migration 001_initial.ts creates all schemas
- [ ] migrations/index.ts applies pending migrations
- [ ] injury.ts exports functions
- [ ] calculations.ts exports functions

### Backend API (SP4)
- [ ] server.ts runs Hono app
- [ ] Logging middleware logs requests
- [ ] Error handler returns correct codes
- [ ] Categories CRUD endpoints work (200/201/404/409)
- [ ] Items CRUD endpoints work
- [ ] Sessions endpoints work
- [ ] Injuries endpoints work
- [ ] Stats endpoints work
- [ ] Leaderboard sorted correctly

### Frontend (SP5)
- [ ] vite.config.ts builds PWA
- [ ] index.html has meta tags
- [ ] main.ts mounts app
- [ ] Router defines routes
- [ ] Home view renders two panes
- [ ] Items view renders list
- [ ] Stats view renders leaderboard
- [ ] Setup view shows empty state
- [ ] Composables fetch data
- [ ] Components use Konsta UI

---

## Execution Notes

1. **Task Timing**: Each task should complete in 2-5 minutes
2. **Test-First**: Write test before implementation
3. **No Placeholders**: No TODOs or TBD in code
4. **Type Safety**: All interfaces defined
5. **Error Handling**: Try-catch with proper error codes
6. **Transactions**: Session operations use transactions
7. **Cascading Deletes**: Items → sessions, injuries, stats
8. **TypeScript**: Strict mode, no implicit any

---

## Final Verification

Run these commands to verify implementation:

```bash
# 1. Check dependencies
cd package.json
npm install

# 2. Build Docker
docker compose build

# 3. Run unit tests
cd src/backend
npm test
cd src/frontend
npm test

# 4. Run E2E tests
npx playwright test

# 5. Start and verify
docker compose up --build
curl http://localhost:3000/api/categories

# 6. Test frontend
open http://localhost:3000
```

---

## Post-Implementation

After completing all tasks:

1. Create commit with all changes
2. Update project README
3. Update AGENTS.md with implementation complete
4. Request code review
5. Merge to main
