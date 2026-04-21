# Weartrack — Agent Guide

## Architecture

Monorepo with 3 workspaces: `src/backend`, `src/frontend`, `src/shared`.

- **Frontend**: Vue 3 + Vite + Konsta UI + vite-plugin-pwa (PWA)
- **Backend**: Hono + better-sqlite3 + CORS
- **Data**: SQLite at `/data/db.sqlite` (Docker volume mount)
- **Infra**: Multi-stage Docker, GitLab CI with to-be-continuous

Domain logic in `docs/design/`:
- `docs/design/main.md` — app goals, two-pane UX, injury flow
- `docs/design/tech-stack.md` — stack decisions
- `docs/design/duration-formula.md` — wear/rest calculations

Full implementation plan in `docs/superpowers/plans/2026-04-21-full-implementation-plan.md`.

## Commands

```bash
# Build Docker image
docker compose build

# Start app with migrations
docker compose up --build

# Run unit tests (root + workspaces)
npm test

# Run frontend tests
cd src/frontend && npm test

# Run E2E tests (requires running container)
npx playwright test
```

## Implementation Order

Execute sub-projects in order when scaffolding:

1. **Infrastructure** (SP1): Dockerfile, docker-compose, workspace package.json files, vitest.config.ts
2. **CI/CD** (SP2): .gitlab-ci.yml
3. **Data Layer** (SP3): db/index.ts, migrations, injury/calculations modules
4. **Backend API** (SP4): server.ts, middleware, controllers, routers
5. **Frontend** (SP5): vite.config.ts, views, components, composables

## Constraints & Gotchas

- **SQLite path**: `/data/db.sqlite` via named volume, not hardcoded in app
- **Single port**: Backend serves API + static frontend on one port (3000)
- **TDD**: Write test → verify fails → implement → commit (no placeholders)
- **Transaction**: Session operations use DB transactions for atomicity
- **Cascading deletes**: Items → sessions, injuries, stats (onDelete: cascade)
- **Injury penalty**: When injured, reduce all wear times by 50%, increase rest by 150%
- **No local Node**: Build/run via Docker only; no local Node deps
- **Branch strategy**: Each task on new branch; push → create MR against prev branch
