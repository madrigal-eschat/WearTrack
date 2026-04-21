# Sub-Project 2: CI/CD Pipeline — Spec

## Goal

Define the GitLab CI/CD pipeline for the Weartrack monolith (PWA frontend + Hono backend) using to-be-continuous templates.

## Stack

- **CI/CD**: GitLab CI
- **Node template**: `to-be-continuous/node@5.3.0` (legacy include)
- **Playwright template**: `to-be-continuous/playwright@1.9.0` (legacy include)
- **Docker template**: `to-be-continuous/docker@8.3.0` (legacy include)
- **Playwright**: `tags: [privileged]` (for browser automation)
- **Docker build**: `tags: [buildah]` (required for Buildah builder)
- **Docker build-args**: `--platform linux/amd64 --platform linux/arm64`
- **Trivy disabled**: `trivy-disabled: true` (skip vuln scanning)
- **SBOM disabled**: `sbom-disabled: true`

## Pipeline Stages

### Stage 1: lint

- Runs on all pushes
- Lint both frontend and backend (npm run lint in each workspace)

### Stage 2: build

- Runs on all pushes and pulls
- Build both frontend (Vite) and backend
- Test with unit tests (`npm run test`)
- Generate code coverage reports

### Stage 3: deploy

- Runs on pushes to `main` or on merge requests
- Build and push Docker image (snapshot)

### Stage 4: deploy-prod

- Runs on pushes to `main` with a semver tag
- Promote snapshot to release image
- Deploy to production environment

## GitLab CI Configuration

### `.gitlab-ci.yml`

```yaml
# Global variables
variables:
  # Node template
  NODE_IMAGE: "docker.io/library/node:24"
  NODE_MANAGER: "npm"
  NODE_LINT_ENABLED: "false"
  NODE_BUILD_ARGS: "run build --prod"
  NODE_COREPACK_POLICY: "enabled"

  # Docker template
  DOCKER_BUILD_TOOL: "buildah"
  DOCKER_BUILD_ARGS: "--platform linux/amd64 --platform linux/arm64"
  DOCKER_SBOM_DISABLED: "true"
  DOCKER_TRIVY_DISABLED: "true"

  # Production publish strategy: manual approval required
  DOCKER_PROD_PUBLISH_STRATEGY: "manual"

stages:
  - lint
  - build
  - deploy
  - deploy-prod

# Use to-be-continuous components
include:
  # Node.js template
  - project: 'to-be-continuous/node'
    ref: '5.3.0'
    file: '/templates/gitlab-ci-node.yml'

  # Playwright template
  - project: 'to-be-continuous/playwright'
    ref: '1.9.0'
    file: '/templates/gitlab-ci-playwright.yml'

  # Docker template
  - project: 'to-be-continuous/docker'
    ref: '8.3.0'
    file: '/templates/gitlab-ci-docker.yml'

# Override Node.template jobs
node-lint:
  when: manual
  script:
    - npm run lint

node-build:
  build-args: "run build --prod"
  test-args: "-- --run"

node-audit:
  audit-args: "--audit-level=high"

node-sbom:
  sbom-disabled: true

node-outdated:
  disabled: true

node-semgrep:
  disabled: true

node-publish:
  disabled: true

# Override Docker.template jobs
docker-hadolint:
  hadolint-disabled: true

docker-healthcheck:
  disabled: true

docker-trivy:
  trivy-disabled: true

docker-build:
  build-args: "--platform linux/amd64 --platform linux/arm64"
  script:
    - docker compose -f docker-compose.yml build

docker-publish:
  publish-args: "--compression-format zstd"

docker-sbom:
  sbom-disabled: true

# Deploy stage
deploy:
  when: manual
  environment: staging
  script:
    - docker compose -f docker-compose.yml up -d

deploy-prod:
  when: manual
  environment: production
  script:
    - docker compose -f docker-compose.yml up -d

# Playwright tests (E2E)
playwright:
  tags:
    - privileged
  when:
    - manual
  environment: staging
  script:
    - npm install
    - cd src/frontend
    - npx playwright install
    - npx playwright test
  artifacts:
    reports:
      - '**/playwright-report/**'
      - '**/playwright-test-results/**'
    paths:
      - reports/

# Production only
deploy-production-playwright:
  only:
    - /^v?[0-9]+\.[0-9]+\.[0-9]+$/
  tags:
    - privileged
  environment: production
  script:
    - npm install
    - cd src/frontend
    - npx playwright install
    - npx playwright test --project=chromium --workers=1
  artifacts:
    when: always
    reports:
      - '**/playwright-report/**'
      - '**/playwright-test-results/**'
    paths:
      - reports/
```

## Directory Structure

```
weartrack/
├── .gitlab-ci.yml
├── package.json
├── docker-compose.yml
├── docker/
│   └── Dockerfile
├── src/
│   ├── frontend/
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   ├── src/
│   │   │   ├── App.vue
│   │   │   ├── main.js
│   │   │   └── ...
│   │   └── tests/
│   │       ├── e2e/
│   │       │   └── playwright.config.ts
│   │       └── ...
│   ├── backend/
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── server.js
│   │   │   └── db/
│   │   └── tests/
│   └── shared/
└── docs/
    └── superpowers/
        └── specs/
```

## Environment Variables

### Project-level secrets

Store as GitLab CI/CD project variables (masked):

| Variable | Type | Description |
|----------|------|-------------|
| `DOCKER_REGISTRY_USER` | masked | GitLab Container Registry username |
| `DOCKER_REGISTRY_PASSWORD` | masked | GitLab Container Registry password |

### CI/CD Variables

| Variable | Type | Description |
|----------|------|-------------|
| `NODE_IMAGE` | unmasked | Node.js image for build jobs (set to `node:24`) |
| `DOCKER_BUILD_ARGS` | unmasked | Build args for multi-platform images |
| `DOCKER_PROD_PUBLISH_STRATEGY` | unmasked | `manual` to require approval |

## Docker Registry

By default, the pipeline pushes to GitLab Container Registry:

- **Snapshot**: `$CI_REGISTRY_IMAGE/snapshot:$CI_COMMIT_REF_SLUG`
- **Release**: `$CI_REGISTRY_IMAGE:$CI_COMMIT_REF_NAME`

### GitLab Registry Authentication

The template uses GitLab's built-in registry credentials:

- `CI_REGISTRY_USER` (provided by GitLab)
- `CI_REGISTRY_PASSWORD` (provided by GitLab)

These are automatically available for pushing to `$CI_REGISTRY_IMAGE`.

## Image Signing

Currently disabled for development. To enable:

```yaml
variables:
  DOCKER_COSIGN_STRATEGY: "never"
```

## Artifacts and Reports

### Code Coverage

GitLab automatically parses coverage reports from test output and displays them on MR pages.

### Playwright Test Reports

Generated by Playwright template:

- `playwright-report/` - HTML test report
- `playwright-test-results/` - JUnit xunit reporter output
- Artifacts retained for 1 day

### Code Quality

With `NODE_LINT_ENABLED: true`, generates:

- `reports/node-lint.gitlab.json` - ESLint report for GitLab
- `reports/node-lint.xslint.json` - ESLint report for SonarQube

## Workflow

### Development (any branch)

1. Push to branch
2. CI runs lint and build stages
3. Tests run
4. Docker image built as snapshot

### Merge Request

1. Reviewer checks PR
2. CI runs full test suite including Playwright (staging env)
3. Manual approval required for merge

### Release

1. Tag pushed (`v1.0.0`)
2. Snapshot promoted to release
3. Deploy approval required (manual strategy)
4. Production deployment

## Notes

### Platform Support

The Dockerfile build produces images for both:

- **linux/amd64** (x86_64, Linux and macOS)
- **linux/arm64** (Apple Silicon and Raspberry Pi)

Docker Compose deployment uses the appropriate image based on host platform.

### Volumes

The mounted volume `weartrack-data` persists SQLite database across container restarts:

```yaml
volumes:
  - weartrack-data:/data/db.sqlite
```

Named volume `weartrack-data` is created by Docker Compose.

### Troubleshooting

**Playwright tests failing with browser access denied**:

- Ensure job has `tags: [privileged]`
- Runner must allow browser automation

**Build fails on Apple Silicon**:

- Use `--platform linux/amd64` to build x86_64 images (Docker Desktop on Mac translates)

**Trivy scanning too slow**:

- Keep `trivy-disabled: true` for development
- Enable for production branches only with `TRIVY_ENABLED: true`
