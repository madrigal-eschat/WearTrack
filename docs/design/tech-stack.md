# Tech Stack

## Frontend
Vue 3 with Vite as the build tool and dev server. Konsta UI provides iOS-style components (tab bars, list groups, action sheets, etc.) to give the app a native feel when used as a PWA on iPhone and iPad. The PWA manifest and service worker are handled by `vite-plugin-pwa`, with `viewport-fit=cover` and safe area insets configured to handle the notch/Dynamic Island correctly.

## Backend
Hono running on Node.js, serving both the REST API and the built frontend static files from a single process on a single port. No separate web server needed.

## Data
SQLite via `better-sqlite3`, with queries kept in a dedicated data-access module rather than inline in route handlers. The database file lives in a Docker volume mount at `/data/db.sqlite` so it persists across container rebuilds. Sync between devices is implicit — both the iPhone and iPad hit the same API, which is the single source of truth.

## Infrastructure
A single Docker container built using a multi-stage Dockerfile. The first stage uses a Node image to install dependencies and build the frontend; the second stage is a leaner Node image that copies in only the built artefacts and production dependencies. The SQLite file is volume-mounted from the host at `/data/db.sqlite`. No local Node installation is required to build or run the app — `docker compose up --build` is the only command needed. Updating the app is a pull-and-restart.

## Testing & Dependency Management
Vitest for unit tests covering API route logic and data-access functions. Playwright for browser automation tests against the running container. Renovate Bot raises MRs for dependency updates, grouping minor and patch bumps; CI runs both test suites and auto-merges on green. Major version bumps are flagged for manual review.

## CI/CD
GitLab CI using [to-be-continuous](https://to-be-continuous.gitlab.io/doc/) (tbc) components sourced from the private group mirror at `$CI_SERVER_FQDN/to-be-continuous`. The pipeline is composed of three tbc components:

- **node** — runs Vitest unit tests
- **playwright** — runs browser automation tests against the built app
- **docker** — builds and pushes a multi-architecture image with `build-args: "--platform linux/amd64 --platform linux/arm64"`

Renovate Bot raises MRs for dependency updates; the pipeline runs against each MR and auto-merges on green for minor and patch bumps.
