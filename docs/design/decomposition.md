This is a substantial project with multiple independent subsystems (PWA
frontend, backend API, database schema, Docker infrastructure, CI/CD, domain
logic, multiple views/pages).

Before we dive into details of any one piece, we should decompose this into
independent sub-projects.

Here's how I see the breakdown:
  1. PWA infrastructure — Docker Compose, PWA manifest/service worker,
     testing
  2. CI/CD pipeline
  3. Core data layer — database schema, data-access module, domain models
     (items, categories, wear sessions, injuries, streaks/break logic)
  4. backend API — REST endpoints for the data layer (CRUD for items,
     session management, stats queries)
  5. PWA frontend — Vue 3 app with at-a-glance view, calendar, items config,
     goals & stats pages

We're brainstoming building the CI/CD pipeline for this application, given all the decisions made in the previous docs/superpowers/specs file.

We will be using GitLab CI with to-be-continuous components (node, playwright, docker)

These components' READMEs are available at the following URLs:

https://$CI_GITLAB_HOST/to-be-continuous/node/-/raw/main/README.md
https://$CI_GITLAB_HOST/to-be-continuous/playwright/-/raw/main/README.md
https://$CI_GITLAB_HOST/to-be-continuous/docker/-/raw/main/README.md

For playwright, we will need to add `tags: [privileged]`
For docker-buildah-build, we will need to add `tags: [buildah]`
The docker component will also need input variables:

```
build-args: "--platform linux/amd64 --platform linux/arm64"
sbom-disabled: true
trivy-disabled: true
```
