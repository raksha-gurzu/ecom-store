---
name: building-test-merchant-sites
description: How to build a test merchant e-commerce site that a "pull" catalog connector can be tested against — own-shape catalog, token-protected pagination, public images, and deliberate value-coercion traps. Use when building or extending a merchant-side test target for a Custom Pull / catalog-ingest integration, or when designing fixtures that exercise AI field-mapping and coercion.
---

# Building test merchant sites for a Custom Pull connector

A test merchant site exists to give a catalog-ingest connector a **realistic,
deliberately-messy target**. Its value is proportional to how much it *doesn't*
look like the engine's own schema. This skill captures the durable know-how.

## The core principle: be a stranger, not a mirror

The connector's job is to map *the merchant's* fields to *our* columns via AI, then
lock that mapping and replay it deterministically. If your fixture already uses the
engine's field names and clean types, the mapping + coercion steps are never
exercised. So:

- **Use your own vocabulary.** e.g. `sku_group` not `external_product_id`,
  `options` not `variants`, `colour`/`cost`/`photo`/`long_desc`. Pick names a real
  merchant might plausibly use — not the engine's.
- **Keep the DB clean, make the *wire format* messy.** Store typed values; inject
  the messiness at serialization time, keyed by a per-product `serialize_quirk`.
  This keeps the fixture honest and the traps deterministic.

## The contract a Phase-1 site must satisfy

1. **Read endpoint** `GET /api/catalog?page=N` → `{ page, total_pages, items }`.
2. **Bearer-token auth** — 401 without the right `Authorization: Bearer <token>`.
3. **Pagination** with a `total_pages` (or equivalent) stop signal.
4. **Stable ids** — product + variant ids identical across syncs (they're the
   connector's upsert keys). Derive them deterministically; never randomize.
5. **Public image URLs** that resolve **without** auth (the connector downloads
   anonymously). Mount static images *before* the token guard.

Back the read endpoint with a **SELECT-only DB role** to mirror a real merchant
exposing reads through a restricted role.

## The trap catalogue (what breaks naive mappings)

Seed at least one of each — these are the shapes that catch wrong mappings:

| Trap | Wire form | Coercion forced |
|---|---|---|
| string price | `cost.amount: "1999.00"` | string → number |
| cents integer | `price_cents: 199900` | cents → amount |
| currency string | `cost.amount: "Rs.1999"` / `"$120"` | strip + parse |
| non-numeric stock | `stock: "out of stock"` | → 0 |
| array-form options | `attrs:[{name,option}]` vs flat `size`/`colour` | array mapping |
| simple product | no `options` — price/stock/photo at product level | synthesize 1 variant |
| missing optional | no `brand` | omit, don't fail |
| HTML description | `<p>…</p>` in `long_desc` | sanitize on display |
| broken image | one bad image URL | degrade + continue, don't fail the sync |

Guarantee coverage programmatically (assign any missing trap to a spare product),
and assert every trap in a smoke test — don't rely on the data happening to contain
them.

## Sourcing real data

Real scraped data beats lorem-ipsum (realistic names/descriptions/images exercise
embeddings). When scraping:

- **Prefer structured data on the page** (JSON-LD `Product`/`BreadcrumbList`) over
  brittle CSS scraping. Fall back to parsing form controls for option axes.
- **Re-host images.** Many stores serve images via **signed, expiring** CDN URLs
  (e.g. Cloudflare R2 with a ~5-min expiry). Storing those URLs guarantees dead
  links by sync time — download at scrape time and serve them yourself.
- **Synthesize variants** from the option axes (colour × size) when per-variant
  price/stock isn't exposed — fidelity of per-variant pricing rarely matters for a
  *mapping* test; field shape does.
- **Dedupe globally** by stable id (a product often appears in several categories).
- **Be polite**: bounded concurrency, small inter-request sleeps, back off on 429.

## Phasing

- **Phase 1:** the read endpoint + token + own-shape JSON + pagination + traps.
- **Phase 2:** emit **HMAC-signed change notifications** (create/update/delete) so
  the connector can test freshness without polling. Sign the body with a shared
  secret; the engine verifies in constant time. Management/admin CRUD endpoints are
  the natural place to fire these.

## Smell tests
- If a reviewer can't tell your fixture from the engine's own schema → too clean.
- If re-running the scrape duplicates rows → ids aren't stable/idempotent.
- If images 404 during a sync → you stored expiring URLs instead of re-hosting.
- If every product is `normal` → you forgot to seed (or guarantee) the traps.
