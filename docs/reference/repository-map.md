---
owner: raksha
reviewed: 2026-08-18
covers:
  - src/
  - scripts/
  - db/
  - public/
---

# Repository map

Reference. Where everything lives and what it is responsible for. No narrative —
for the reasoning, see [`../explanation/architecture.md`](../explanation/architecture.md).

## Application code

| Path | Responsibility |
|---|---|
| `src/server.js` | Express wiring and mount order: static → storefront → `/api` → `/manage` |
| `src/db.js` | Two connection pools: owner (writes) and read-only (catalog + storefront) |
| `src/serialize.js` | Database rows → the merchant's wire shape; injects the coercion traps |
| `src/product-repo.js` | Loads one product in merchant shape, for notification payloads |
| `src/notify.js` | Signs and POSTs change notifications (best effort, never fails a write) |
| `src/middleware/auth.js` | Constant-time bearer token checks |
| `src/routes/catalog.js` | `GET /api/catalog` — the machine contract |
| `src/routes/manage.js` | Admin CRUD, and the notification hooks |
| `src/routes/store.js` | Storefront routes: home, category, search, product detail |

## Storefront rendering

| Path | Responsibility |
|---|---|
| `src/ui/Layout.jsx` | Page shell: header, search, category pills, footer |
| `src/ui/Home.jsx` | Product grid, cards, pagination |
| `src/ui/Product.jsx` | Gallery and the colour/size variant selector |
| `src/ui/pages.js` | Page registry — the single name→component binding both sides use |
| `src/ui/format.js` | Formatting shared by server and browser |
| `src/views/render.js` | `renderToString` plus the HTML document shell |
| `src/views/product-props.js` | Database rows → plain JSON props (sanitises description HTML) |
| `src/views/sanitize.js` | Allowlist HTML sanitiser — storefront render path only, never the API |
| `src/client/entry.jsx` | Browser entry: reads embedded props, hydrates |
| `public/store.css` | Hand-written stylesheet; class names are contractual |
| `public/bundle.js` | **Generated.** Built by `scripts/build.mjs` |
| `dist/ui.js` | **Generated.** Server-side component bundle |

## Data

| Path | Responsibility |
|---|---|
| `db/schema.sql` | Tables, views, and the `gurzu_readonly` role. Runs on first boot |
| `db/ci-seed.sql` | Seven-product fixture covering every contract shape, for CI |
| `db/prod-init/20-set-passwords.sh` | Replaces the shipped dev password in production |
| `images/` | **Not in git.** Scraped product images (~700MB) |

## Scripts

| Command | Script | Purpose |
|---|---|---|
| `npm run build` | `scripts/build.mjs` | Compile the UI for server and browser |
| `npm run lint` | — | ESLint across the repo |
| `npm run check:repo` | `scripts/check-repo.mjs` | Structure, git hygiene, doc freshness |
| `npm run smoke` | `scripts/smoke.mjs` | API contract (§9) |
| `npm run audit` | `scripts/audit.mjs` | Database and image integrity |
| `npm run test:endpoints` | `scripts/test-endpoints.sh` | Auth, CRUD, status codes, role enforcement |
| `npm run test:storefront` | `scripts/test-storefront.mjs` | Rendering, hydration, escaping, error statuses, auth edges, stored XSS, trap isolation |
| `npm run test:sanitize` | `scripts/test-sanitize.mjs` | HTML sanitiser unit tests (no services needed) |
| `npm run scrape` | `scripts/scrape.mjs` | Repopulate the catalog from the upstream site |
| `npm run phase2` | `scripts/phase2-demo.mjs` | Change-notification end-to-end |
| `npm run notify:receiver` | `scripts/mock-notify-receiver.mjs` | Stand-in consumer endpoint (port 8099) |
| `npm run db:pull-example` | `scripts/db-pull-example.mjs` | Proves the direct-database integration path |
| — | `scripts/export-seed.sh` | Produce a catalog snapshot for deployment |
| — | `scripts/restore-seed.sh` | Load a snapshot into a running production stack |
| — | `scripts/ci-fixture-images.mjs` | Generate real PNGs for the CI fixture |

## Deployment and CI

| Path | Responsibility |
|---|---|
| `docker-compose.yml` | **Local development only.** Publishes the database, ships pgAdmin |
| `docker-compose.prod.yml` | **The deployable stack.** No database port, no default secrets |
| `Dockerfile` | Two stages: build the UI, then a runtime image without build tooling |
| `.env.example` / `.env.prod.example` | Every setting, with notes |
| `.github/workflows/ci.yml` | Pull requests and `dev`: lint, build, contract suites |
| `.github/workflows/main.yml` | `main`: everything above plus the deployment gate |
| `.githooks/pre-commit` | Fast local checks before a commit is written |

## Ports

| Port | Service |
|---|---|
| 4000 | The app |
| 5433 | Postgres, published for local tools only (never in production) |
| 5050 | pgAdmin (development only) |
| 8099 | Mock notification receiver |
