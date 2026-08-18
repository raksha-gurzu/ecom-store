# CLAUDE.md — Test Merchant Site

Guidance for Claude when working in this repo.

## What this project is

The **merchant-side** test site for GurzuVTO's **Custom Pull** connector. It is the
*target* the connector pulls from — we are not building the connector here. The
authoritative contract is [`TEST-MERCHANT-SITE.md`](./TEST-MERCHANT-SITE.md); read
it before changing anything that touches the wire format.

The single most important design rule: **the catalog must NOT look like GurzuVTO's
schema.** Field names are the merchant's own (`sku_group`, `title`, `long_desc`,
`options`, `colour`, `cost`, `photo`…). If you "tidy" them toward Gurzu's columns,
you defeat the entire purpose — the connector's AI field-mapping would go untested.

## Two faces of one project

This repo serves the SAME scraped data through two completely separate surfaces.
Never let one bleed into the other:

1. **The machine contract** — `GET /api/catalog` (token-gated, merchant's own shape,
   coercion traps). This is the *reason the project exists*: the test target for the
   Custom Pull connector. Sacred. Don't "clean it up".
2. **The human storefront** — a beautiful meesa-style UI at `/` (added in v2, moved
   to React in v3). Purely additive convenience so people can SEE the products.
   Reads the DB directly, server-rendered then hydrated, no auth. It DOES require a
   build (`npm run build`). It must never weaken or reshape #1.

## Architecture (where things live)

```
db/schema.sql        product_groups + options + product_images (merchant's own shape) + gurzu_readonly role
src/db.js            two pg pools: owner (writes) + readonly (catalog + storefront reads)
src/serialize.js     DB rows → merchant wire shape; injects coercion traps via serialize_quirk
src/middleware/auth.js  constant-time Bearer checks (READ_TOKEN, ADMIN_TOKEN)
src/routes/catalog.js   GET /api/catalog (paginated, read token, readonly pool) — the CONTRACT
src/routes/manage.js    admin CRUD (admin token, owner pool) — also Phase-2 notify hooks
src/routes/store.js     the human storefront: home, category, search, product detail
src/ui/*.jsx            React components (Layout, Home, Product) — rendered on BOTH sides
src/ui/pages.js         page registry: name → component; the one binding server+client share
src/views/render.js     renderToString + the HTML shell + embedded props for hydration
src/views/product-props.js  DB rows → plain JSON props for the Product page
src/client/entry.jsx    browser entry: reads the embedded props, hydrateRoot()
scripts/build.mjs       esbuild → dist/ui.js (server) + public/bundle.js (browser)
public/                 store.css (hand-written, unchanged) + generated bundle.js, served static
src/notify.js        Phase-2 HMAC-signed change notifications (best-effort POST)
src/product-repo.js  load a product in merchant shape (notification payloads)
src/server.js        wiring: public + /img (before auth), / store, /api, /manage, /health, /api-info
scripts/lib/meesa.mjs   meesa.shop fetch + JSON-LD/gallery/variation parsing
scripts/scrape.mjs   meesa → DB + images (idempotent upsert; full gallery + real variants)
scripts/smoke.mjs    §9 contract checker     scripts/audit.mjs   deep data-integrity audit
scripts/test-endpoints.sh  live auth/storefront/CRUD/role battery
scripts/db-pull-example.mjs mock/prove the direct-DB (connection-string) path
scripts/mock-notify-receiver.mjs  stand-in Gurzu notify endpoint (:8099)
docker-compose.yml   DEV ONLY: db + app + pgAdmin, published DB port, default secrets
docker-compose.prod.yml  the DEPLOYABLE stack: no DB port, no default secrets, named volumes
.githooks/           pre-commit (fast) + pre-push (full, protected branches only)
.github/workflows/   ci.yml (PRs + dev) · main.yml (main + deployability gate)
scripts/check-repo.mjs   structure, git hygiene, documentation freshness
scripts/test-storefront.mjs  SSR + hydration + escaping + error/auth edges + trap isolation
docs/                written docs by audience — start at docs/README.md
INTEGRATION.md       one-stop: API (url+token) + direct-DB (conn string) for the engine
DEPLOY.md            hand-off notes for whoever hosts this
```

**Before changing anything, read `docs/explanation/principles.md`** — the nine rules
this project is built on, each with the check that enforces it. If you are about to
"tidy" the catalog's field names or move a trap into the database, that page explains
why not.

Data flow: `meesa.shop ──scrape──▶ Postgres ──┬─serialize─▶ GET /api/catalog (machine)`
`                                              └─views─────▶ / storefront (human)`.
Images are downloaded at scrape time (meesa's signed R2 URLs expire ~300s) and
served publicly from `/img` so the connector — and the storefront — can fetch them.

## Data model

- **`product_groups`** — one row per product (merchant's own shape; `serialize_quirk`
  drives trap injection; `is_simple` for no-variant products).
- **`options`** — one row per real variant. `variation_id` = meesa's REAL variant id;
  `stock` = meesa's REAL "Available Stock" count; `photo` = the variant's per-colour
  **lead image** (all sizes of a colour share it). `sku` stays the stable derived key.
- **`product_images`** — the FULL product gallery (`position`-ordered). Used by the
  storefront's thumbnail strip; the API contract still exposes only `options[].photo`.

## Conventions / invariants (don't break these)

- **Storefront is additive, never invasive.** The pretty UI reads the DB and renders
  HTML. It must NOT change the API contract, the trap data, the schema's merchant
  shape, or the tests. If a storefront need pulls toward "cleaner" catalog data,
  store the clean value for the UI separately — never sanitize the contract.
- **The storefront loads nothing from a third party.** This site is the merchant the
  connector pulls FROM — it is not a GurzuVTO customer. No try-on widget, no visual
  search panel, no tenant key or engine script in the page shell
  (`src/views/render.js`). The only integration direction is INBOUND: the engine
  reads `/api/catalog` or the DB. (Phase-2 notify is the one outbound call, and it
  is a server-side POST, not browser code.)
- **Stable ids.** `product_groups.sku_group` = the meesa slug; `options.sku` is
  derived deterministically (`SLUG__SIZE__COLOUR`). `variation_id` holds meesa's real
  id additionally. Ids must stay stable across scrapes — they are upsert keys.
- **Real variants only.** A variant exists iff meesa's `/variation_stock` returns a
  `variation_id` for that colour×size combo. Don't fabricate the cartesian product;
  query the real matrix. Simple products (no axes) still synthesize one variant.
- **Idempotent scrape.** Re-running `npm run scrape` upserts in place (no dupes);
  it replaces a product's options + images wholesale each run.
- **Images public, catalog private.** The `/img` static mount sits *before* the
  read-token guard. Never gate images behind a token (spec §5.4).
- **Read path is read-only.** The catalog endpoint uses `readPool` (the
  `gurzu_readonly` role). Writes go through `pool` (owner). Keep that split.
- **Traps live in serialization, not the DB.** The DB stores clean typed values;
  `serialize_quirk` decides the messy wire form. Add a trap by adding a quirk
  branch in `src/serialize.js`, not by storing dirty data. That includes the §5
  **broken-image trap**: the `broken_photo` quirk swaps the first option's photo
  for `/img/__broken__.jpg` at serialize time (mirrored in `catalog_json`), so the
  API ships a dead URL while the storefront still renders the real photo. Never
  store `__broken__` in `options.photo` — the audit fails on it.
- **Merchant HTML is sanitised for the UI, never for the API.** `long_desc` is real
  third-party HTML rendered with `dangerouslySetInnerHTML`, so it is an XSS vector.
  `src/views/sanitize.js` cleans it in `product-props.js` (server side, so the
  rendered and hydrated markup match). `GET /api/catalog` must keep shipping the
  RAW markup — sanitising the contract would remove the mess the connector exists
  to be tested against.
- **No product without a working image.** Image format is decided by MAGIC BYTES
  (`scripts/lib/imagetype.mjs`), never by Content-Type — meesa serves some AVIF as
  `image/jpeg`, and a mislabelled file dies in any strict decoder. Bytes that
  aren't a `USABLE_EXTS` format are skipped; a product left with zero images is
  never inserted, and `npm run scrape` also sweeps any pre-existing imageless row.
  The audit treats an imageless product, and any file whose bytes disagree with
  its extension, as a hard failure. AVIF is currently excluded (stock Pillow can't
  decode it) — widen `USABLE_EXTS` only if the consuming pipeline supports it.

## Commands

```bash
# START EVERYTHING — durable stack, all containers restart:unless-stopped
docker compose up -d        # db (:5433) + app (:4000) + pgAdmin (:5050)
docker compose ps           # status     docker compose logs -f app   # app logs
docker compose down         # stop (keep data)     docker compose down -v   # stop + WIPE db volume

# one-time / occasional
npm install
npm run build               # REQUIRED before `npm start` on the host: compiles the React
                            # storefront → dist/ui.js + public/bundle.js
npm run build:watch         # rebuild on change while working on src/ui or src/client
npm run scrape              # (re)populate DB + images/ (full gallery + real variants; idempotent)
npm run db:init             # (re)apply schema.sql by hand (idempotent; adds role + clean-JSON views)

# checks — `npm run verify` runs all of these in order; it is exactly what CI runs
npm run verify              # lint + build + check:repo + smoke + audit + endpoints + storefront
npm run lint                # ESLint (must be 0 problems)   npm run lint:fix
npm run check:repo          # structure, git hygiene, doc freshness (0 problems)
npm run smoke               # §9 contract (17)        npm run audit            # data integrity (0 problems)
npm run test:endpoints      # live auth/CRUD/role (26) npm run db:pull-example # prove the DB-string path
npm run test:parity         # API vs catalog_json byte-parity + image/trap invariants (13)
npm run test:storefront     # SSR + hydration + escaping + errors + auth + XSS + traps (56)
npm run test:sanitize       # HTML sanitiser unit tests (34) — no services needed
npm run notify:receiver     # mock Gurzu notify endpoint :8099 (Phase 2)
npm run phase2              # Phase-2 e2e (9) — needs the receiver AND the app pointed at it:
                            #   GURZU_NOTIFY_URL=http://172.17.0.1:8099/v1/integrations/custom-pull/notify \
                            #     docker compose up -d --force-recreate app

# git hooks (once per clone)
npm run hooks:install       # pre-commit: secrets/build/lint/structure
                            # pre-push:   full suite, but only for main and dev

# run the app WITHOUT Docker (alternative): host node, dockerized db only
docker compose up -d db && npm start   # app on host :4000
```

**Services / ports:** app `:4000`, Postgres host `:5433` (`db:5432` inside the compose
net; 5432 is usually taken locally), pgAdmin `:5050` (the "Meesa Catalog" server is
pre-registered via `db/pgadmin/servers.json`; password `merchant_pw`, entered once).

## Phase status

- **Phase 1 (done):** read endpoint + Bearer token + own-shape JSON + pagination +
  the awkward shapes (multi/single/simple variants, missing-optional, HTML, the
  cents/currency-string/out-of-stock/array-option traps, one broken image).
- **Phase 2 (done):** HMAC-signed change notifications. `src/notify.js` signs the
  body (`X-Signature: hmac-sha256(secret, body)`) and POSTs to `GURZU_NOTIFY_URL`;
  the `/manage` routes call it on create/update/delete with the product in the
  merchant's own shape. Best-effort (a notify failure never fails the mutation).
  `scripts/mock-notify-receiver.mjs` stands in for the engine (constant-time
  verify + embedding-effect classification); `npm run phase2` is the e2e check.
  Event→embedding mapping lives in the manage routes (price/qty → `variant.updated`
  = no re-embed; content/image → `product.updated` = re-embed). See spec §8.

## Storefront routes (v2, human UI)

- `GET /` — home: header + search, category pills, paginated product grid.
- `GET /?q=…` / `GET /category/:dept` — search / category filter.
- `GET /products/:skuGroup` — detail: image gallery (main + thumbnails), colour+size
  selectors that update real price/stock live from an embedded variant JSON; colour
  click swaps the main image to that colour's lead photo.
- `GET /browse` → 301 redirect to `/`. `GET /api-info` → the old API-info landing.
- All storefront routes are unauthenticated and read-only; keep them mounted AFTER
  `public`/`/img` static and BEFORE the `/api` token guard.

## Storefront rendering (v3 — React, server-rendered + hydrated)

The storefront is React, rendered to HTML on the server and hydrated in the
browser. It is NOT a single-page app: routes stay server-routed, each page arrives
as complete HTML, and the bundle only makes the interactive parts live. A page
still renders correctly with JavaScript off — only the variant selector goes quiet.

**One component tree, two builds.** `scripts/build.mjs` compiles `src/ui/*.jsx`
twice: `dist/ui.js` (ESM, React external) for the server, `public/bundle.js` (IIFE,
React bundled) for the browser. Never write a component for only one side.

- **The build is now required.** `node src/server.js` fails without `dist/ui.js`.
  Run `npm run build` after any change under `src/ui` or `src/client`; use
  `npm run build:watch` while developing. `npm run dev` builds first.
- **Props must be plain JSON.** Whatever a route passes to `renderPage()` is both
  rendered and embedded in the page for hydration. No Date objects, no raw `pg`
  rows with NUMERIC strings where a number is expected — coerce in
  `src/views/product-props.js`, not in the component.
- **Keep initial state pure and deterministic.** `initialSelection()` in
  `Product.jsx` runs on the server AND again in the browser; anything random or
  time-based there desyncs hydration.
- **`dist/` and `public/bundle.js` are generated** — gitignored, built in the
  Dockerfile's build stage. Don't edit or commit them.
- Class names match `public/store.css` exactly; that CSS is still hand-written and
  was not touched by the React port. Renaming a class in a component silently
  unstyles the page.

## Integration paths (how the engine connects)

Two read-only ways to get the catalog, both documented in `INTEGRATION.md` and shown
in the browser at `/api-info`:
1. **API** — `GET /api/catalog` with the Bearer read token (carries the coercion traps).
2. **Direct DB** — the engine connects with the `gurzu_readonly` connection string and
   runs `SELECT product FROM catalog_json`. **`catalog_json` returns the SAME JSON as the
   API** — it mirrors `src/serialize.js` (same fields + the serialize_quirk traps + absolute
   image URLs) via the `mc_*` SQL helper functions in `db/schema.sql`. **Keep the view in
   sync with `serialize.js`** when you change either. Flat `v_products` / `v_variants` views
   still expose raw columns. This deviates from spec §2 (DB private) by choice; role is SELECT-only.

## Gotchas

- meesa.shop is a **Rails** marketplace, not Shopify — there is no `products.json`.
  Category page 1 is HTML; later pages are Turbo-Stream fragments (`Accept:
  text/vnd.turbo-stream.html`).
- **No per-colour images on meesa.** Images are a flat product gallery; the colour
  selector only hits `/variation_stock` (stock, not images). Our "per-colour lead
  image" is a best-effort assignment of gallery photos to colours — meesa has none.
- **Real variants + stock** come from `GET /products/:slug/variation_stock?color=&size=`
  → real `variation_id`, `Available Stock: N`, `max="N"`. Out-of-stock/non-existent
  combos return an empty `variation_id`. This is ~1–2k requests per full scrape —
  bounded concurrency + backoff; per-combo failures degrade to a synthesized value.
- Only ~7 meesa categories have ≥50 products; the scraper deduplicates globally.
- meesa image URLs are **signed and expire** — never store them; always re-host.
- **DB host for OUTSIDE consumers is `localhost:5433`, never `db:5432`.** `db` only
  resolves inside the compose network (symptom: `Temporary failure in name resolution`).
  `/api-info` shows the external string via `PUBLIC_DB_URL` (don't echo the app's own
  `READONLY_DATABASE_URL` — in the container that's the internal `db:5432`). Defaults are
  `localhost` everywhere (`PUBLIC_BASE_URL`, `PUBLIC_DB_URL`, `mc_photo()`). Only a consumer
  in its **own** container needs `172.17.0.1:5433` / `host.docker.internal:5433` — and then
  all three must be switched together, or image URLs and the DB string disagree.
- **The Dockerfile must `COPY public ./public`** or the storefront's `/store.css`
  404s in the container (the page renders unstyled). It must ALSO copy the build
  stage's `dist/` and `public/bundle.js`, or the server crashes on the missing
  `dist/ui.js` import. Rebuild with `docker compose up -d --build` after changing
  any copied source.
- **Editing a component without rebuilding shows stale UI.** The server renders
  from `dist/ui.js`, not from `src/ui/*.jsx` — so an un-built change appears to do
  nothing. Same class of confusion as forgetting `--build` on the container.
- The engine (`try-on/`) supports **both** integration modes now — API (endpoint+token)
  and direct DB (read-only connection string). Phase-2 notify isn't built engine-side.
