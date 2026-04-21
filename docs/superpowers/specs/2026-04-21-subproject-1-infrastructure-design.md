# Sub-Project 1: Infrastructure — Design

## Goal

Scaffold the project with a working monolith (Docker Compose, multi-stage Dockerfile, PWA config) that can be built and run with a single command: `docker compose up --build`.

## Stack

| | |
|---|---|
| Runtime | Node 24 |
| Package manager | npm |
| OS (build) | bookworm (Debian, full) |
| Volume | Named volume `weartrack-data`, mounted at `/data/db.sqlite` |
| Port | 3000 (single service) |
| CI/CD | Deferred to a later sub-project |

## File layout

```
weartrack/
├── package.json            (npm workspaces)
├── package-lock.json
├── docker-compose.yml
├── docker/
│   └── Dockerfile
├── src/
│   ├── frontend/           (Vue 3, Vite, Konsta UI, vite-plugin-pwa)
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   ├── src/
│   │   └── tests/
│   ├── backend/            (Hono, better-sqlite3)
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── server.js   (Hono app, serves API + static)
│   │   │   └── db/         (SQLite init, data-access layer)
│   │   └── tests/
│   └── shared/
└── docs/
    └── superpowers/
        └── specs/
            └── <design docs>
```

## Package management

Root-level `package.json` declares npm workspaces for `["src/frontend", "src/backend"]`. No direct dependencies at the root. A single `package-lock.json` tracks the full dependency tree.

## Docker Compose

`docker-compose.yml` defines a single service (`weartrack`):

- Uses `docker/Dockerfile`
- Exposes port 3000 (host 3000 → container 3000)
- Mounts named volume `weartrack-data` at `/data/db.sqlite`

## Dockerfile (`docker/Dockerfile`)

Two stages:

**Stage 1 (`build`):** `node:24-bookworm`. Copies `package.json` + lock, `npm install` all deps, copies source, builds Vue frontend with Vite.

**Stage 2 (`production`):** `node:24-bookworm-slim`. Copies only production deps from stage 1, copies built frontend assets, copies backend source, exposes port 3000, runs `node src/backend/server.js`.

## PWA (`src/frontend/`)

- `vite-plugin-pwa` with Workbox, cache-first strategy: app loads from cache, checks server for updates in background
- iOS meta tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `viewport-fit=cover`, safe area insets for notch/Dynamic Island
- Konsta UI with `Platform="ios"` for native-feeling UI components
- Service worker with `registerSW` — app feels like a native iOS app when added to home screen
- Built output served as static files by the Hono backend
