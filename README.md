# Test Merchant Site

A **merchant-side** e-commerce site that exists to test GurzuVTO's **Custom Pull**
connector. It has **two faces** over the same Postgres catalog (real data scraped
from [meesa.shop](https://meesa.shop)):

1. **A machine API** — a token-protected, paginated catalog **in the merchant's own
   field shape** (deliberately *not* GurzuVTO's schema). This is the test target.
2. **A human storefront** at `/` — a polished, meesa-style store (category nav,
   search, product grid, product detail with image gallery + live variant selector).
   Purely additive; it never weakens the API contract.

> Build contract: [`TEST-MERCHANT-SITE.md`](./TEST-MERCHANT-SITE.md). This repo
> implements **Phase 1** (read endpoint + token + own-shape JSON + pagination +
> the awkward "trap" shapes) **and Phase 2** (HMAC-signed change notifications
> emitted from the management endpoints, with a mock receiver to test against).

---

## What this is (and isn't)

| | |
|---|---|
| **We build (this repo)** | The merchant site: Postgres catalog, Express API, scraper, images. |
| **The engine provides (not here)** | The Custom Pull connector — AI field-mapping, operator confirm, sync worker, embeddings. It pulls *from* this site. |

The point is to be a *realistic, slightly messy* merchant: our field names are our
own (`sku_group`, `title`, `long_desc`, `options`, `colour`, `cost`, `photo`…) and
the catalog deliberately includes the value-coercion traps from the spec so the
connector's mapping + coercion get a real workout.

## Architecture

```
meesa.shop ──scrape──▶ Postgres ──┬─ serialize ─▶ GET /api/catalog   (Bearer token, own shape)  ← MACHINE
  product_groups + options +      │              GET /img/<file>     (public images)
  product_images (gallery)        │              /manage/*           (Bearer admin token)
  downloaded images ──▶ images/   └─ views ─────▶ /  storefront       (home, category, search, detail) ← HUMAN
```

- **`db/schema.sql`** — `product_groups` + `options` + `product_images` (gallery) in
  the merchant's own vocabulary, plus a **SELECT-only `gurzu_readonly` role** the
  catalog + storefront read through; writes go through the owner role.
- **`scripts/scrape.mjs`** — walks ~12 categories; per product parses JSON-LD, then
  **immediately downloads the full image gallery** (meesa's signed R2 URLs expire in
  ~300s — never batch them for later), fetches the **real variant matrix + stock**
  from `/variation_stock`, assigns each colour a lead image, seeds the coercion
  traps, and upserts idempotently.
- **`src/serialize.js`** — renders DB rows into the merchant's wire shape (where
  `serialize_quirk` injects each trap). **`src/routes/store.js` + `src/views/*`** —
  the human storefront. The two never mix: the storefront never reshapes the API.

## Quick start

Run the whole stack in Docker — **db + app + pgAdmin**, all with `restart: unless-stopped`
so they survive crashes/reboots (recommended):

```bash
cp .env.example .env                          # throwaway dev secrets are fine
docker compose up -d                          # db (:5433) + app (:4000) + pgAdmin (:5050)
docker compose run --rm app npm run scrape    # first run only: meesa.shop → DB + images/
```

Then open:

| | URL | Note |
|---|---|---|
| Storefront | http://localhost:4000 | the human store |
| API | http://localhost:4000/api/catalog | needs the read token |
| Connection info | http://localhost:4000/api-info | API url + key + DB conn string |
| Database viewer (pgAdmin) | http://localhost:5050 | "Meesa Catalog" pre-registered; password `merchant_pw` |

Day to day it's just `docker compose up -d` (data persists in a volume).
`docker compose down` stops it; `down -v` also wipes the DB.

### Prefer host Node?

```bash
docker compose up -d db        # just Postgres on :5433
npm install
npm run scrape                 # populate DB + images/
npm start                      # app on host :4000
```

### Verify

```bash
npm run smoke                  # §9 contract (17 checks)
npm run audit                  # deep data-integrity audit (0 problems)
npm run test:endpoints         # live auth/storefront/CRUD/role battery (21 checks)
npm run db:pull-example        # prove the direct-DB connection-string path
```

The full battery — audit + Phase 1 (`smoke`) + Phase 2 (`phase2`) + `test:endpoints` —
is **59+ checks** against the real scraped data. `test:endpoints` targets `BASE`
(default `localhost:4000`).

## The storefront (human view)

Open **http://localhost:4000/** in a browser:

- **Home** — search bar, category pills, product-card grid (image, price, out-of-stock
  badge), pagination.
- **`/category/:dept`** and **`/?q=…`** — category filter and search.
- **`/products/:skuGroup`** — image **gallery** (main + thumbnail strip), and a live
  **variant selector**: picking a colour swaps the main image to that colour's lead
  photo and updates the **real** price/stock; sizes unavailable for a colour disable.
- `/browse` 301-redirects here; the machine-facing API reference moved to **`/api-info`**.

It's server-rendered (no build step), reads through the read-only role, and is purely
additive — it never changes the API contract below.

## Endpoints

### `GET /api/catalog?page=N`  — the Phase-1 read endpoint
Bearer `READ_TOKEN` required. Returns `{ page, total_pages, total_items, items }`
where each item is a product in the merchant's own shape (50/page).

```bash
curl -H "Authorization: Bearer merchant_demo_readonly_token_abc123" \
  "http://localhost:4000/api/catalog?page=1"
```

### `GET /img/<file>` — public images
No auth — the connector downloads these anonymously into MinIO.

### `/manage/*` — management (admin) endpoints
Bearer `ADMIN_TOKEN`. Run the store (and, later, drive Phase-2 notifications):

| Method | Path | Purpose |
|---|---|---|
| GET | `/manage/products?page=N` | list products (raw DB shape) |
| GET | `/manage/products/:skuGroup` | one product + its options |
| POST | `/manage/products` | create a product (+ inline options) |
| PATCH | `/manage/products/:skuGroup` | update product fields |
| DELETE | `/manage/products/:skuGroup` | delete a product |
| POST | `/manage/products/:skuGroup/options` | add an option |
| PATCH | `/manage/options/:sku` | update an option (price/stock/…) |
| DELETE | `/manage/options/:sku` | delete an option |

### `GET /health` — liveness + DB check (no auth)

## The deliberate "trap" shapes

Each product carries a `serialize_quirk` that shapes how the API serializes it, so
the connector's mapping + coercion are exercised (spec §5, §6.4):

| Quirk | What the JSON looks like | Coercion the engine must do |
|---|---|---|
| `normal` | `cost: { amount: "1999.00", currency: "NPR" }`, integer `stock` | string → number |
| `cents` | `price_cents: 199900` (no `cost`) | cents → amount |
| `currency_string` | `cost.amount: "Rs.1999"` | strip currency, parse |
| `stock_text` | `stock: "out of stock"` | non-numeric → 0 |
| `array_options` | `attrs: [{name:"Size",option:"L"}]` instead of flat `size`/`colour` | array-form options |

Plus: **simple products** (no `options` — product-level price/stock/photo →
synthesized variant), **missing optional** `brand`, **HTML** in `long_desc`, and
exactly **one broken image URL** (degrade-and-continue). `npm run smoke` asserts
each of these is present.

## Phase 2 — HMAC-signed change notifications

After the initial pull, freshness runs on **merchant notifications only** (spec §8):
every catalog mutation through `/manage/*` POSTs the affected product — **in the
merchant's own shape** — to `GURZU_NOTIFY_URL`, signed `X-Signature: hmac-sha256(secret, body)`.
The engine runs the *same locked mapping* on it and applies it.

`src/notify.js` emits; it's **best-effort** — if the engine is down the store
mutation still succeeds (the manual re-sync is the self-heal).

| Mutation | Event | Embedding effect |
|---|---|---|
| create product | `product.created` | embed (new) |
| edit product content / add or remove option | `product.updated` | re-embed |
| edit option **price/qty** | `variant.updated` | **no** re-embed (filters, not vector input) |
| delete product | `product.deleted` | deactivate |

Test it end-to-end against the bundled mock receiver (stands in for the engine —
constant-time signature verify, classifies the embedding effect, records events):

```bash
npm run notify:receiver     # listens on :8099 (NOTIFY_PORT)
npm start                   # app, with GURZU_NOTIFY_URL → the receiver
npm run phase2              # drives create/update/delete, asserts signed events + rejects a forgery
```

## Re-scraping / resetting

```bash
npm run scrape                  # idempotent upsert — safe to re-run
docker compose down -v          # wipe DB + volume, then `up -d db` to re-init schema
npm run db:init                 # (re)apply schema.sql by hand
```

## Integrating (the engine pulling from us)

The GurzuVTO engine's Custom Pull connector supports **both** of our read-only ways
(it has a "Custom Store · via API" and a "Custom Store · via Database" mode). Both are
documented in **[`INTEGRATION.md`](./INTEGRATION.md)** and shown at `/api-info`:

- **API** — `GET /api/catalog` + Bearer token (the messy, trap-carrying view):
  - endpoint_url → `http://localhost:4000/api/catalog`
  - read_token → `merchant_demo_readonly_token_abc123`
- **Direct DB** — a read-only connection string; the engine reads `catalog_json` (clean JSON)
  or `v_products` / `v_variants`. SELECT-only:
  - `postgres://gurzu_readonly:readonly_pw@localhost:5433/merchant_catalog`

> **Two gotchas, both real:**
> - The engine must run in **development** mode to reach `localhost` (its SSRF guard blocks
>   private IPs in production).
> - **Use host `localhost:5433`, never `db:5432`.** `db` only resolves inside *our* compose
>   network; an outside consumer using it gets `Temporary failure in name resolution`. An
>   engine in its own container uses `172.17.0.1:5433` / `host.docker.internal:5433`.
> - Phase-2 change-notifications aren't built engine-side yet (only Phase-1 pull/sync).

The same DB string also works with any tool: `npm run db:pull-example`, pgAdmin (:5050), `psql`.

## Configuration

See `.env.example`. Key vars: `READ_TOKEN`, `ADMIN_TOKEN`, `PUBLIC_BASE_URL`,
`DATABASE_URL` / `READONLY_DATABASE_URL`, and the Phase-2 `HMAC_SECRET` /
`GURZU_NOTIFY_URL`.
