---
owner: raksha
reviewed: 2026-08-18
covers:
  - scripts/smoke.mjs
  - scripts/audit.mjs
  - scripts/test-endpoints.sh
  - scripts/test-storefront.mjs
  - .github/workflows/
---

# How to run the checks

For someone who wants to know their change is safe before pushing.

## The short version

```bash
docker compose up -d          # the suites need a running app and database
npm run verify                # lint, build, structure, and all four suites
```

`npm run verify` is exactly what CI runs. If it passes locally it passes there.

## What each check is for

| Command | Needs a running app? | Catches |
|---|---|---|
| `npm run lint` | no | Unused variables, undefined names, misused React hooks |
| `npm run build` | no | JSX or import errors — the server cannot start without this |
| `npm run check:repo` | no | Missing folders, secrets committed, docs pointing at moved files |
| `npm run test:sanitize` | no | HTML sanitiser — stored XSS through product descriptions |
| `npm run smoke` | **yes** | The API contract: auth, pagination, field shapes, the coercion traps |
| `npm run audit` | no (needs the database) | Data integrity: images resolve and decode, ids unique, traps present |
| `npm run test:endpoints` | **yes** | Status codes, admin CRUD, and that the read-only role cannot write |
| `npm run test:storefront` | **yes** | Rendering, hydration payload, escaping, error statuses and formats, auth edges, traps staying out of the UI |

## Running one suite

```bash
npm run smoke
npm run test:storefront
BASE=http://localhost:4300 npm run test:storefront     # against another instance
```

## The change-notification test

This one needs two extra pieces, so it is not part of `verify`:

```bash
npm run notify:receiver &      # stand-in consumer on port 8099

# point the app at that receiver — its default targets the real engine, and from
# a container "localhost" is the container itself, so use the docker bridge:
GURZU_NOTIFY_URL=http://172.17.0.1:8099/v1/integrations/custom-pull/notify \
  docker compose up -d --force-recreate app

npm run phase2                 # expect 9 passed, 0 failed
```

## When a check fails

**`npm run build` fails** — a syntax or import error in `src/ui` or `src/client`.
The message names the file and line.

**`smoke` says `products=0`** — the database is empty. Load data with
`npm run scrape`, or restore a snapshot.

**`audit` reports missing images** — the database references files that are not
on disk. Usually an interrupted scrape; re-run it.

**`test:storefront` reports a hydration payload problem** — a route passed
something that is not plain JSON. Coerce it in `src/views/product-props.js`.

**A suite passes locally but fails in CI** — CI runs against
`docker-compose.prod.yml` with a small fixture, not your real catalog. Reproduce
it exactly:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U merchant -d merchant_catalog < db/ci-seed.sql
node scripts/ci-fixture-images.mjs ci-images
docker compose -f docker-compose.prod.yml cp ci-images/. app:/app/images/
```

**The app serves an old version** — you changed a component but did not rebuild.
The server renders from `dist/ui.js`. Run `npm run build`, or
`docker compose up -d --build app` for the container.

## Before you push

The pre-commit hook runs the fast checks automatically. Install it once per
clone:

```bash
npm run hooks:install
```

It runs lint, build and structure checks — not the suites, which need a running
stack. Pushing to `main` runs everything in CI.
