---
name: rescrape-catalog
description: Re-scrape meesa.shop into the merchant catalog DB and validate the §9 contract. Use when refreshing catalog data, after schema/serializer changes, when the catalog looks stale or empty, or when asked to "rescrape", "reseed", "refresh products", or "check the catalog contract".
---

# Re-scrape & validate the merchant catalog

Operational runbook for repopulating and verifying this test merchant site's catalog.

## When to use
- The catalog is empty/stale, or `GET /health` reports `products: 0`.
- After editing `db/schema.sql`, `scripts/scrape.mjs`, or `src/serialize.js`.
- Before handing the site to the connector for a sync test.

## Steps

1. **Ensure Postgres is up** (host port 5433):
   ```bash
   docker compose up -d db
   docker inspect --format '{{.State.Health.Status}}' ecomshop-db-1
   ```
   If you changed `db/schema.sql`, either `npm run db:init` (idempotent re-apply)
   or `docker compose down -v && docker compose up -d db` (full wipe + re-init).

2. **Scrape** (idempotent upsert — safe to re-run):
   ```bash
   npm run scrape
   ```
   Watch the summary: product count, option count, simple-product count, and the
   `serialize quirks` histogram. Every trap (`cents`, `currency_string`,
   `stock_text`, `array_options`) must be present — the scraper guarantees at
   least one of each.

3. **Start the server** (if not running) and **validate the contract**:
   ```bash
   npm start &        # or: docker compose up -d app
   npm run smoke
   ```
   `smoke.mjs` checks §9: 401 without token, paginated own-shape JSON, stable ids,
   multi/single/simple variants, every coercion trap, missing-optional brand, HTML
   descriptions, and a public image that resolves without auth. All must pass.

## Guardrails
- **Never** rename catalog fields toward GurzuVTO's schema — the merchant's own
  shape is the whole point (it exercises the connector's AI mapping).
- **Never** store meesa's signed R2 image URLs — they expire (~300s). Always
  re-host via the downloader (the scraper already does this).
- Keep ids stable: `sku_group` = meesa slug; `sku` = `SLUG__SIZE__COLOUR`.
- If a scrape fails midway, it's transactional — the DB is unchanged; just re-run.

## Tuning
Edit the constants at the top of `scripts/scrape.mjs`: `CATEGORIES`,
`CAP_PER_CATEGORY`, `IMAGES_PER_PRODUCT`, `PRODUCT_CONCURRENCY`. Be polite —
keep concurrency modest and the inter-request sleeps in place.
