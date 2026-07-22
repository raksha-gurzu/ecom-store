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
2. **The human storefront** — a beautiful meesa-style UI at `/` (added in v2). Purely
   additive convenience so people can SEE the products. Reads the DB directly,
   server-rendered, no auth, no build step. It must never weaken or reshape #1.

## Architecture (where things live)

```
db/schema.sql        product_groups + options + product_images (merchant's own shape) + gurzu_readonly role
src/db.js            two pg pools: owner (writes) + readonly (catalog + storefront reads)
src/serialize.js     DB rows → merchant wire shape; injects coercion traps via serialize_quirk
src/middleware/auth.js  constant-time Bearer checks (READ_TOKEN, ADMIN_TOKEN)
src/routes/catalog.js   GET /api/catalog (paginated, read token, readonly pool) — the CONTRACT
src/routes/manage.js    admin CRUD (admin token, owner pool) — also Phase-2 notify hooks
src/routes/store.js     the human storefront: home, category, search, product detail
src/views/*.js          server-rendered HTML templates (layout, home, product)
public/                 store.css + store.js (vanilla; gallery + variant selector), served static
src/notify.js        Phase-2 HMAC-signed change notifications (best-effort POST)
src/product-repo.js  load a product in merchant shape (notification payloads)
src/server.js        wiring: public + /img (before auth), / store, /api, /manage, /health, /api-info
scripts/lib/meesa.mjs   meesa.shop fetch + JSON-LD/gallery/variation parsing
scripts/scrape.mjs   meesa → DB + images (idempotent upsert; full gallery + real variants)
scripts/smoke.mjs    §9 contract checker     scripts/audit.mjs   deep data-integrity audit
scripts/test-endpoints.sh  live auth/storefront/CRUD/role battery
scripts/db-pull-example.mjs mock/prove the direct-DB (connection-string) path
scripts/mock-notify-receiver.mjs  stand-in Gurzu notify endpoint (:8099)
docker-compose.yml   db + app + pgAdmin, all restart:unless-stopped
INTEGRATION.md       one-stop: API (url+token) + direct-DB (conn string) for the engine
```

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
  branch in `src/serialize.js`, not by storing dirty data.

## Commands

```bash
# START EVERYTHING — durable stack, all containers restart:unless-stopped
docker compose up -d        # db (:5433) + app (:4000) + pgAdmin (:5050)
docker compose ps           # status     docker compose logs -f app   # app logs
docker compose down         # stop (keep data)     docker compose down -v   # stop + WIPE db volume

# one-time / occasional
npm install
npm run scrape              # (re)populate DB + images/ (full gallery + real variants; idempotent)
npm run db:init             # (re)apply schema.sql by hand (idempotent; adds role + clean-JSON views)

# checks
npm run smoke               # §9 contract (17)        npm run audit            # data integrity (0 problems)
npm run test:endpoints      # live auth/CRUD/role (21) npm run db:pull-example # prove the DB-string path
npm run notify:receiver     # mock Gurzu notify endpoint :8099 (Phase 2)
npm run phase2              # Phase-2 e2e (needs app + receiver running)

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

## Search & Try-On panel (v3, storefront UI)

A slide-over panel that calls the **GurzuVTO REST API** (`GURZU_API_BASE`, default
`http://localhost:8000`) straight from the browser. This is the one place the store
*consumes* Gurzu rather than being consumed by it — it is pure UI and touches neither
the catalog contract nor the DB.

- `public/tryon.css` — all rules prefixed `.gvto-` under `#gvto-root`/`#gvto-launch`, so
  they can't leak into the store's styles; design tokens are inherited from `store.css`.
- `public/tryon.js` — search → tray (cap 6) → photo → per-tile render. Vanilla IIFE, same
  no-build idiom as `store.js`. Builds DOM nodes rather than `innerHTML`.
- `src/views/layout.js` — `tryOnBlock()` emits the `#gvto-config` JSON island (same
  handoff pattern as `#pd-data`), the launcher button, and the asset tags. Mounting it
  in the shared layout is what puts the panel on every storefront page.

Invariants:
- **Key config, never hardcoded.** `GURZU_PUBLISHABLE_KEY` lives in `.env` (gitignored);
  `.env.example` and `docker-compose.yml` carry only a placeholder / empty default. If
  either env var is unset the panel isn't rendered at all — a fresh clone degrades to the
  plain store instead of throwing 401s.
- The key is publishable and **origin-locked to `http://localhost:4000`**, so it is safe in
  page source — but it spends real renders. Revoke it if the store becomes public.
- **The shopper photo is never persisted** — no localStorage/sessionStorage, object URLs
  revoked, state dropped on panel close. It goes to the API and nowhere else.
- **Photo preprocessing is required** before upload: EXIF-rotate via
  `createImageBitmap(file,{imageOrientation:"from-image"})` (skip it and phone portraits
  arrive sideways), downscale to ≤1536px longest edge, re-encode JPEG ~0.9, strip the
  `data:` prefix. The request body cap is 12 MB and base64 inflates ~4/3.
- **Only `done` and `failed` are terminal.** Anything else means keep polling — more
  states may be added. Poll every 2.5s, all jobs concurrently, bounded at ~6 min so a
  stuck job reads as a failure rather than a hang.
- **Never swallow an error into a blank tile.** Each status maps to its own wording
  (401 config · 402 split on `render_cap_exhausted` · 403 split on `origin_not_allowed`
  vs `missing_scope` · 409 the not-synced message · 422 validation · 429 back off).
  **429 is the only status that retries.** `detail` arrives in three shapes — `{reason,
  message}`, a plain string, or FastAPI's validation array (422) — all three are handled.

Gotcha: a 409 on the first search is not a bug in this panel — it means the store hasn't
finished **Sync + Generate embeddings** in the Gurzu dashboard (`localhost:5173`, which is
the dashboard, *not* the API — never send requests there).

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
  `READONLY_DATABASE_URL` — in the container that's the internal `db:5432`). A consumer
  in its own container uses `172.17.0.1:5433` / `host.docker.internal:5433`.
- **The Dockerfile must `COPY public ./public`** or the storefront's `/store.css` +
  `/store.js` 404 in the container (the page renders unstyled). Rebuild with
  `docker compose up -d --build` after changing any copied source.
- The engine (`try-on/`) supports **both** integration modes now — API (endpoint+token)
  and direct DB (read-only connection string). Phase-2 notify isn't built engine-side.
