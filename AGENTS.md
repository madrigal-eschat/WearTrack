# Weartrack — Agent Guide

## Architecture

Design specs live in `docs/design/`:

- `docs/design/main.md` — app goals, features, UX flows
- `docs/design/tech-stack.md` — planned tech stack (Vue 3, Hono, SQLite)
- `docs/design/duration-formula.md` — domain logic for wear/rest periods

When the app is scaffolded, expect:

- Frontend: `vue` / `vite` / `konsta-ui` / `vite-plugin-pwa` (PWA)
- Backend: `hono` API server + static file serving, single port
- Data: `better-sqlite3` with dedicated data-access layer
- Infrastructure: Docker Compose, volume-mounted SQLite at `/data/db.sqlite`
- Tests: Vitest (unit) + Playwright (browser), CI via GitLab CI (to-be-continuous components)

## Commands

Nothing to run yet — the app has not been scaffolded.

## Constraints

- No existing code to follow. Treat design docs as the source of truth for domain logic.
- When code appears, verify all commands and conventions from config/scripts rather than guessing.
