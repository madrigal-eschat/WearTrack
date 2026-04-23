# Weartrack

Track the usage of wearable items — orthotics, braces, retainers, shoes, anything worn on a schedule. Log sessions, view wear history on a calendar, and see leaderboards across items and categories.

## What it does

- **Wear sessions** — start and stop a timer for any item; sessions are stored with precise durations
- **Categories** — group items (e.g. "Footwear", "Orthodontics"); each category has configurable wear targets and rest rules
- **Calendar** — week-by-week view of total wear time per day
- **Leaderboards** — rank items by total wear, session count, longest session, or streak
- **PWA** — installable on mobile; works offline once loaded

## Architecture

```
src/
  backend/   Hono API server + SQLite via better-sqlite3
  frontend/  Vue 3 + Vite PWA + Konsta UI (iOS-style components)
```

The backend exposes a JSON REST API under `/api/`. In production, both are served from the same Docker container (backend on port 3000). In development they run separately, with Vite proxying `/api` calls to the backend.

## Development

Prerequisites: Node.js 22+

```bash
# Install dependencies
npm ci --prefix src/backend
npm ci --prefix src/frontend --legacy-peer-deps

# Run backend (port 3000) and frontend (port 5173) in separate terminals:
npm run dev --prefix src/backend
npm run dev --prefix src/frontend
```

The frontend dev server proxies `/api/*` to `http://localhost:3000`, so you can hit `http://localhost:5173` and have everything work.

## Production

Build and run with Docker Compose:

```bash
docker compose up --build
```

The app will be available at `http://localhost:3000`.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET/POST | `/api/categories` | List / create categories |
| GET/PATCH/DELETE | `/api/categories/:id` | Get / update / delete a category |
| GET | `/api/categories/:id/stats` | Wear stats for a category |
| GET/POST | `/api/items` | List / create items |
| GET/PATCH/DELETE | `/api/items/:id` | Get / update / delete an item |
| GET | `/api/items/:id/stats` | Wear stats for an item |
| GET | `/api/items/:id/history` | Session history (grouped by day/week/month) |
| GET/POST | `/api/sessions` | List active sessions / start a session |
| PATCH/DELETE | `/api/sessions/:id` | End / delete a session |
| POST | `/api/injuries` | Log an injury/overuse event |
| GET | `/api/leaderboards/total-wear` | Items ranked by total wear time |
| GET | `/api/leaderboards/session-count` | Items ranked by number of sessions |
| GET | `/api/leaderboards/longest-session` | Items ranked by longest single session |
| GET | `/api/leaderboards/streak` | Categories ranked by current streak |

## Tech stack

- **Backend:** [Hono](https://hono.dev) · [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) · Node.js
- **Frontend:** [Vue 3](https://vuejs.org) · [Vite](https://vitejs.dev) · [Konsta UI](https://konstaui.com) · [Tailwind CSS](https://tailwindcss.com) · [Heroicons](https://heroicons.com)
- **CI/CD:** GitLab CI · Buildah · Docker
