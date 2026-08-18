# Test Merchant Site — Build Guide for the "Custom Pull" Connector

**Status:** Design-stage. The **Custom Pull** connector in the engine is **not yet built**.
This document describes the *merchant-side* e-commerce site you will build (in a separate
project folder) so that, once the connector exists, we have a realistic target to test it
against. Build the site to this contract and the two halves will connect.

**Companion specs** — these live in the **GurzuVTO engine repository**, not here.
Paths below are relative to that repo: docs/superpowers/specs/2026-06-15-custom-catalog-push-design.md
(the *push* sibling), the Shopify/WooCommerce specs (the *platform-pull* siblings),
docs/plan-visual/custom-pull-integration.html (the visual walkthrough), and its
`CLAUDE.md` → integrations sections.

> **Process note:** this connector reopens two non-goals the 2026-06-15 push spec locked
> (pulling from merchant endpoints; AI field-mapping). Before implementation, write
> docs/decisions/0009-custom-pull-ingress.md **in the engine repository** to consciously
> supersede them, listing the
> safeguards that make them acceptable now (AI proposes-only, deterministic locked replay,
> operator confirm, SSRF hardening).

---

## 1. Where Custom Pull fits

We already have three ingress models. Custom Pull is the fourth, for merchants who are
**not** on a platform but **can** expose a read endpoint and don't want to reshape their data:

| Model | Direction | Who shapes the data | Example |
|---|---|---|---|
| Shopify / WooCommerce | **Pull** | Platform's fixed API | `adapters/ingress/shopify`, `…/woocommerce` |
| Custom Push | **Push** | Merchant → our canonical format | `2026-06-15-custom-catalog-push-design.md` |
| **Custom Pull (this doc)** | **Pull** | **Merchant keeps their own shape; we adapt once via AI** | the site you'll build |

The distinct value of Custom Pull: **near-zero reshaping effort for the merchant** — they
point us at their existing catalog endpoint, and we adapt to *their* field names one time.

---

## 2. Decisions at a glance (all locked)

| Area | Decision |
|---|---|
| Read access | HTTP endpoint → JSON (the DB role stays on the **merchant's** side) |
| Structure | **One** connector, pluggable auth |
| Auth (read) | Static **Bearer read-token**, Fernet-encrypted at rest |
| Mapping | AI **proposes** → human **confirms** → **locked**; deterministic replay forever after |
| Confirm actor (v1) | **Operator, in the playground** (merchant self-serve = later phase) |
| Extracted fields | The **8 required** (see §6.1) |
| Value handling | Confirm **previews real extracted values** + typed coercion |
| Variants | **Inline + simple-product synthesis** (a variant-less product → one synthesized variant) |
| Freshness | **Notifications only** after the initial pull; **manual re-sync** is the recovery tool |
| Deletions / updates | Via **change notifications** (created / price-qty updated / content updated / deleted), through the **same mapping** |
| Notification auth | **HMAC signature** with a shared secret, constant-time verified |

**Phasing:**

- **Phase 1 (build first):** connect → map (operator-confirm) → full pull → embed, with a
  manual **"Sync again"** button. *No notifications yet* — freshness = re-pull on demand.
- **Phase 2:** the **HMAC-signed notification endpoint**. Once on, freshness runs on
  notifications **only** (no scheduled auto-pull), and the **manual re-sync becomes the
  self-heal** when a notification is missed. This matches the house rule *"nothing auto-runs;
  jobs fire only from their own buttons; no Beat schedule."*

---

## 3. The lifecycle (so you know what the site must support)

```
PHASE 1
[1 CONNECT]  merchant gives us: endpoint URL + a static read token       -> integrations row (token encrypted)
[2 MAP]      engine pulls a few samples -> AI proposes a field mapping
             -> operator previews the REAL extracted values + confirms   -> mapping LOCKED, stored per merchant
[3 SYNC]     worker pulls ALL products (paginated) -> replays the locked
             mapping deterministically -> images to MinIO -> rows, embedding = NULL
[4 EMBED]    existing embed worker fills the NULLs                        -> searchable
[5 RE-SYNC]  manual "Sync again" re-pulls + re-maps on demand            -> freshness in Phase 1

PHASE 2 (later)
[6 NOTIFY]   merchant POSTs HMAC-signed change events (created/updated/deleted)
             -> SAME locked mapping -> apply incrementally                -> real-time freshness
```

Your test site has to serve, in **Phase 1**: step 1's auth and step 3's data (a paginated,
token-protected JSON catalog endpoint). In **Phase 2** it additionally **emits change
notifications** (step 6). Steps 2/4 are engine-side.

---

## 4. What the test merchant site MUST expose

### 4.1 Phase 1 — the read endpoint

A valid Phase-1 test site provides:

1. **A read-only catalog endpoint** — `GET /api/catalog?page=N` returning product + variant JSON.
2. **Bearer-token auth** — the endpoint rejects anything without the correct `Authorization: Bearer <token>`.
3. **Pagination** — a page parameter plus a `total_pages` (or equivalent) signal, so the
   worker knows when to stop. (Don't return the whole catalog in one unbounded response.)
4. **Stable ids** — `external_product_id` and variant id must be **the same across syncs**.
   They are our upsert keys; if they change each response, every sync orphans the old catalog.
5. **Reachable, public image URLs** — each variant carries an image URL the engine can
   download **without auth**. If images sit behind the catalog token/CDN auth, every download
   fails and the whole catalog falls back to text-only embeddings.

**Deliberately use your OWN field names** — *not* GurzuVTO's. The whole point is to exercise
the AI mapping. If your JSON already looks like our schema, the mapping step is untested.

Good practice to mirror a real merchant (optional but recommended): back the endpoint with a
**read-only database role** on the site's side. The endpoint reads through that role; Gurzu
never sees it. This is the correct home for "a separate role for Gurzu" — on *your* side,
protecting *your* DB.

### 4.2 Phase 2 — emit change notifications

When you're ready to test freshness, the site additionally **POSTs a signed event** to our
notification endpoint whenever the catalog changes (see §8). Not needed for Phase 1.

---

## 5. Build the test website (Node.js + Express)

### 5.1 Project layout & setup

```
test-merchant-site/
├── package.json
├── .env             # READ_TOKEN (Phase 1) + HMAC_SECRET, GURZU_NOTIFY_URL (Phase 2)
├── server.js        # the catalog API + static images
├── catalog.json     # your products, in your OWN shape
└── images/          # real .jpg files the connector downloads
    ├── dress100-ivory.jpg
    ├── tee200-black.jpg
    └── belt300.jpg
```

```bash
mkdir test-merchant-site && cd test-merchant-site
npm init -y
npm install express dotenv
# add server.js, catalog.json, and a few real images/ files
npm start                       # -> http://localhost:4000
```

`package.json` (the parts that matter):

```json
{
  "name": "test-merchant-site",
  "private": true,
  "scripts": { "start": "node server.js" },
  "dependencies": { "express": "4.19.2", "dotenv": "16.4.5" }
}
```

`.env`:

```
READ_TOKEN=merchant_demo_readonly_token_abc123
# Phase 2 only:
HMAC_SECRET=demo_shared_hmac_secret_xyz789
GURZU_NOTIFY_URL=http://localhost:8000/v1/integrations/custom-pull/notify
```

### 5.2 `catalog.json` — your catalog in *your own* shape

Note the field names: `sku_group`, `title`, `long_desc`, `cost.amount`, `colour`, `photo`.
None match our schema — that's intentional. Note also `BELT-300` is a **simple product**
(no `options`) and prices come in **two different conventions** to test value coercion.

```json
[
  {
    "sku_group": "DRESS-100",
    "title": "Lace Bridal Gown",
    "long_desc": "<p>Hand-stitched lace with a sweetheart neckline.</p>",
    "page_url": "https://demo-store.test/p/dress-100",
    "brand": { "name": "Aanya" },
    "options": [
      { "sku": "DRESS-100-M-IVORY", "size": "M", "colour": "Ivory",
        "cost": { "amount": "12000.00", "currency": "NPR" }, "stock": 3,
        "photo": "https://demo-store.test/img/dress100-ivory.jpg" },
      { "sku": "DRESS-100-L-IVORY", "size": "L", "colour": "Ivory",
        "cost": { "amount": "12000.00", "currency": "NPR" }, "stock": 2,
        "photo": "https://demo-store.test/img/dress100-ivory.jpg" }
    ]
  },
  {
    "sku_group": "TEE-200",
    "title": "Cotton Crew Tee",
    "long_desc": "<p>Soft combed cotton.</p>",
    "page_url": "https://demo-store.test/p/tee-200",
    "options": [
      { "sku": "TEE-200-S-BLACK", "size": "S", "colour": "Black",
        "cost": { "amount": "1500.00", "currency": "NPR" }, "stock": 40,
        "photo": "https://demo-store.test/img/tee200-black.jpg" }
    ]
  },
  {
    "sku_group": "BELT-300",
    "title": "Leather Belt",
    "long_desc": "<p>Full-grain leather.</p>",
    "page_url": "https://demo-store.test/p/belt-300",
    "price_cents": 250000,
    "stock": "out of stock",
    "photo": "https://demo-store.test/img/belt300.jpg"
  }
]
```

Make sure the test set includes:
- a product with **multiple variants** (`DRESS-100`),
- a product with a **single variant** (`TEE-200`),
- a **simple product with no variants** (`BELT-300` → the engine synthesizes one variant),
- a **missing optional field** (`TEE-200` / `BELT-300` have no `brand`),
- **value-coercion traps** (`price_cents` is an integer in cents; `stock` is the string
  `"out of stock"`), and
- **HTML** in a description.

These are the shapes that break naive mappings — you want them in the test set.

### 5.3 `server.js` — the endpoint

```js
require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());

const READ_TOKEN = process.env.READ_TOKEN;   // shared with Gurzu at connect
const PRODUCTS = require("./catalog.json");

// Images are PUBLIC (no token) so the connector can download them.
// e.g. http://localhost:4000/img/dress100-ivory.jpg
app.use("/img", express.static("images"));

// Bearer-token auth — protects the catalog endpoint only.
function requireToken(req, res, next) {
  if (req.header("authorization") !== `Bearer ${READ_TOKEN}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// Paginated read-only catalog.
app.get("/api/catalog", requireToken, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const perPage = 50;
  const start = (page - 1) * perPage;
  res.json({
    page,
    total_pages: Math.max(1, Math.ceil(PRODUCTS.length / perPage)),
    items: PRODUCTS.slice(start, start + perPage),
  });
});

app.listen(4000, () => console.log("test merchant site on http://localhost:4000"));
```

Smoke test (mirrors what the connector will do):
```bash
curl -H "Authorization: Bearer merchant_demo_readonly_token_abc123" \
  "http://localhost:4000/api/catalog?page=1"
```

### 5.4 Serving the variant images

Each variant's `photo` URL must resolve **without** the Bearer token — the connector
downloads images anonymously and stores them in MinIO. So:

- Drop real `.jpg` files into `images/`.
- For local dev, set each `photo` in `catalog.json` to the local route, e.g.
  `http://localhost:4000/img/dress100-ivory.jpg` (replace the `https://demo-store.test/...`
  placeholders above).
- The `/img` mount sits **before** `requireToken`, so images stay public while the catalog
  stays protected. (If you accidentally gate images behind the token, every download fails
  and the catalog falls back to text-only embeddings.)

### 5.5 (Phase 2) Emitting change notifications

When you change the catalog in your "admin" (or just a script), POST an **HMAC-signed**
event to Gurzu. The payload is the product **in your own shape** — Gurzu runs the *same*
locked mapping on it.

```js
const crypto = require("crypto");
const HMAC_SECRET = process.env.HMAC_SECRET;
const GURZU_NOTIFY_URL = process.env.GURZU_NOTIFY_URL;

async function notify(event) {
  const body = JSON.stringify(event);
  const sig = crypto.createHmac("sha256", HMAC_SECRET).update(body).digest("hex");
  await fetch(GURZU_NOTIFY_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": sig },
    body,
  });
}

// created / updated — send the FULL product in your shape (same as a catalog item):
await notify({ type: "product.updated",
               product: { sku_group: "DRESS-100", title: "Lace Bridal Gown", options: [ /* … */ ] } });

// deleted — the id is enough:
await notify({ type: "product.deleted", external_product_id: "BELT-300" });
```

Gurzu verifies the signature, maps the product, and applies it — and its content-diff
decides whether to re-embed (a pure price/quantity change skips embedding; a name /
description / image change re-NULLs it). See §8.

---

## 6. The mapping the engine will infer and lock

From the samples above, the AI proposes (and the operator confirms) a **mapping spec** — a
transform from *their* paths to *our* columns. This is stored once and replayed every sync.

### 6.1 Required extracted fields (the mapping MUST yield all of these)

Every mapping is only valid if it resolves the full set below. If the AI cannot find a
source for a **required** field, the operator must supply the path during confirmation —
we never lock a mapping with a required field missing.

| # | What we extract | Our column | Source in the example |
|---|---|---|---|
| 1 | **External product id** | `products.external_product_id` | `sku_group` |
| 2 | **Product name** | `products.name` | `title` |
| 3 | **Product description** | `products.description` | `long_desc` |
| 4 | **External variant id** | `variants.external_id` | `options[].sku` |
| 5 | **Variant option names + values** | `variants.attributes` `{name: value}` | `options[].size`, `options[].colour` |
| 6 | **Price** | `variants.price` | `options[].cost.amount` |
| 7 | **Quantity** | `variants.quantity` | `options[].stock` |
| 8 | **Variant image** | `variants.image_key` (downloaded from `image_url`) | `options[].photo` |

Optional extras (mapped if present, omitted if not): product `url`, and a `designer`
attribute pulled from a brand/designer field.

### 6.2 The locked `mapping_spec`

```json
{
  "items_path": "items",

  "product": {
    "external_product_id": "sku_group",   // (1) required
    "name": "title",                       // (2) required
    "description": "long_desc",            // (3) required
    "url": "page_url"                      //     optional
  },

  "variants_path": "options",
  "variant": {
    "external_id": "sku",                  // (4) required
    "price": "cost.amount",                // (6) required
    "quantity": "stock",                   // (7) required
    "image_url": "photo"                   // (8) required — downloaded to image_key
  },

  // (5) required — variant option NAME -> source path of its VALUE.
  // The key becomes the attribute name; the path resolves the value.
  // Yields variants.attributes = {"Size": "M", "Color": "Ivory"}.
  "variant_options": { "Size": "size", "Color": "colour" },

  "designer_from": "brand.name"            // optional -> attributes.designer
}
```

Note the two ways option data shows up in the wild, both of which the spec must capture as
`{name: value}` pairs:

```text
Flat keys:    "size": "M", "colour": "Ivory"          -> variant_options { "Size":"size", "Color":"colour" }
Array form:   "attrs": [ {"name":"Size","option":"M"} ] -> variant_options { "$array": "attrs", "name":"name", "value":"option" }
```

### 6.3 Simple-product synthesis

A product with **no variants array** (like `BELT-300`) becomes **one synthesized variant**:
`external_id = product id`, and `price` / `quantity` / `image_url` / `attributes` are read
from the product level. The mapping_spec carries a fallback for this case so simple and
variable products go through one code path.

### 6.4 Value coercion (correct values, not just correct fields)

Deterministic field *names* are not enough — the *values* must be coerced to our types:

```text
price:  "12000.00"      -> 12000.00      (string -> number)
price:  250000 (cents)  -> 2500.00       (cents -> amount; flagged at confirm)
price:  "$120.00"       -> 120.00        (strip currency, parse)
stock:  "out of stock"  -> 0             (non-numeric stock -> 0)
stock:  null            -> 0
```

This is exactly why the operator confirms by **previewing the real extracted rows** (§7),
not by eyeballing field names: `cost.amount` could be a base price or a total; `stock` could
be per-warehouse; `price_cents` is in cents. The AI guesses, the operator verifies against
real values, then it's deterministic forever.

Target columns are the existing `products` / `variants` tables (same as Shopify/Woo), so
once mapped, everything downstream — image download to MinIO, multimodal embedding, search —
is reused unchanged.

---

## 7. The operator confirm step (v1)

In v1 the **operator** (your team), not the merchant, confirms the mapping — the playground
is internal-only and there is no merchant dashboard yet. The confirm screen:

1. Shows the AI-proposed mapping with each of the **8 required fields** pre-filled (or flagged
   red if unmapped).
2. **Runs the proposed mapping on the samples** and renders the **actual extracted rows** —
   real `name`, `price`, `quantity`, option `{name: value}`, image — so wrong-value mappings
   (cents, currency strings) are caught *before* locking, not after a full sync.
3. Lets the operator correct any path, then **locks** the `mapping_spec`.

If a later sync no longer fits the locked spec (the merchant changed their shape), the run
**stops, marks an error, and re-opens confirmation** — it never half-ingests.

---

## 8. Freshness & change notifications (Phase 2)

After the initial pull, freshness runs on **merchant notifications only** — no scheduled
auto-pull. The **manual re-sync** is the recovery lever if a notification is ever missed.

**The merchant POSTs a signed event** to our endpoint whenever the catalog changes. Each
event carries the product/variant **in the merchant's own shape**, and we run it through the
**same locked mapping**, then apply it:

| Event | What we do | Embedding effect |
|---|---|---|
| `product.created` | map → insert | embedding NULL → **needs embed** |
| `product.updated` (name / description / image) | map → update | **re-NULL embedding** → re-embed |
| `variant.updated` (price / quantity) | update those columns only | **no re-embed** (price/qty are filters, not vector inputs) |
| `product.deleted` / deactivated | deactivate our copy | none |

**Why price/quantity skip re-embedding:** the vector is built from name + description +
image. Price and quantity are search *filters*, not part of the vector — so updating them is
cheap. A content or image change must re-NULL the embedding so the embed worker regenerates it.

**Auth — HMAC signature.** At connect time we share a secret. The merchant signs each event
POST with it (e.g. `X-Signature: hmac-sha256(secret, body)`); we **verify in constant time**
before trusting the payload, and reject forged or replayed events.

**Test-site Phase-2 work:** emit these signed POSTs on create/update/delete in your store.

---

## 9. Contract checklist (a test site is "valid" when…)

**Phase 1:**
- [ ] `GET /api/catalog?page=N` returns JSON with an items array + a `total_pages` signal.
- [ ] Requests without `Authorization: Bearer <token>` get `401`.
- [ ] Field names are the merchant's own, **not** GurzuVTO's.
- [ ] `external_product_id` and variant ids are **stable across syncs**.
- [ ] Each variant has a **public** image URL that resolves without auth.
- [ ] The set includes multi-variant, single-variant, **simple (no-variant)**, missing-optional,
      and **value-coercion-trap** products.
- [ ] Descriptions may contain HTML (we sanitize on display).
- [ ] (Recommended) the endpoint reads through a read-only DB role on the site's side.

**Phase 2:**
- [ ] On create/update/delete, the site POSTs an **HMAC-signed** event to our endpoint.

---

## 10. Underlying problems & how the design handles them

These are the risks we grilled while designing the connector. The test site should make
each one observable.

| Problem | Why it bites | Solution (engine side) | What the test site should do |
|---|---|---|---|
| **AI non-determinism** | An LLM mis-mapping `price`→`quantity` in a load-bearing path violates "no silent swap" | AI only **proposes** at onboarding; a deterministic extractor replays the **locked** mapping for all bulk data | Provide tricky look-alike fields (`cost.amount`, `price_cents`, `total`) |
| **Wrong values, right fields** | `price_cents` or `"$120"` map to the right column but the wrong number | Typed **coercion** + operator **previews real values** before locking | Include the value-coercion traps from §5.1 |
| **Simple products dropped** | A product with no variants array yields zero variants | **Simple-product synthesis** → one variant from product-level fields | Include `BELT-300` (no `options`) |
| **Sample non-representativeness** | A few samples miss shapes that appear later | Sample strategically + validate the locked mapping against a larger batch before locking | Include the awkward shapes from §5.1 |
| **Schema drift** | Merchant changes their JSON → locked mapping mismatches | Per-record validation; on failure **stop, mark error, re-confirm** — never half-ingest | Offer a second `catalog.json` with a renamed field |
| **SSRF (on every fetch)** | We repeatedly fetch a merchant-supplied URL from our backend; DNS-rebinding / redirect-to-internal can hit internal IPs | Resolve + check the IP **on every fetch** (not just connect), require `https` in prod, block private ranges, limit redirects, cap response size + JSON depth | Run on `http://localhost` for dev only; prod requires HTTPS |
| **Polite pulling** | The merchant's endpoint may rate-limit *us* | Concurrency cap + backoff when **they** return `429` | (Optional) return `429` sometimes to test backoff |
| **Image download failure / private images** | A broken or auth-gated image shouldn't fail the sync | Record a `Degradation`, store `image_key = NULL`, embed text-only, continue | Keep images public; include one broken URL |
| **Secret handling** | The read token + HMAC secret are credentials | Fernet-encrypt at rest, never to the browser, never logged | Use obvious throwaway secrets in dev |
| **Idempotency** | Re-syncs must not duplicate | `upsert_product` via `ON CONFLICT` on stable ids; re-NULL embedding only on content change | Re-run a sync; confirm no duplicates |
| **Tenant isolation** | One merchant must never read another's data | RLS on the integrations row + every write scoped via `set_config('app.tenant_id', …, true)` | N/A (engine-side) |

---

## 11. How this connects to the engine (for when we build it)

Reuses the unified `integrations` table and shared machinery; minimal additions:

- **New provider:** `provider = 'custom_pull'` in the existing `integrations` table.
  `store_domain` ← endpoint base URL, `auth_secret_encrypted` ← the read token.
  **New columns:** `mapping_spec JSONB` (the locked transform from §6) + `updated_at`;
  Phase 2 adds `notification_secret_encrypted` (the HMAC secret).
- **New adapter:** `adapters/ingress/custom_pull/{client,adapter}.py` — `client.py` does
  token-auth + pagination + SSRF-checked fetch; `adapter.py` is the **pure** deterministic
  mapping-spec replayer (with coercion + simple-product synthesis).
- **Mapping inference:** a one-shot Gemini call (existing `google-genai` SDK, direct — no
  litellm) that proposes the spec from samples. Output is validated by **executing it on the
  samples**, never trusted blind.
- **Confirm UI (v1):** **operator** mapping editor in the playground integrations lane, with
  the real-value preview from §7.
- **Sync task:** `tasks/custom_pull_sync.py` (queue `sync`); reuses `catalog_write.upsert_product`,
  the blob image-download pattern, and the existing `embed_pending` worker.
- **Router:** `api/routers/custom_pull.py` — connect / propose-mapping / confirm-mapping /
  sync / embed / status under `/v1/integrations/custom-pull`, `Bearer api_key` auth.
  Phase 2 adds `POST …/notify` (HMAC-verified).
- **Status sub-states:** `connected → proposed → awaiting-confirm → mapped → syncing
  (page x/y, n products, k degradations) → synced / error`.

---

## 12. Build order

**Phase 1**
1. Build the test site to §4.1 / §5 (endpoint + token + your-own-shape JSON + pagination + the
   awkward shapes).
2. Smoke test with the `curl` in §5.2.
3. (Engine) Write **ADR-0009** superseding the push-spec non-goals.
4. (Engine) Migration: `custom_pull` provider + `mapping_spec` + `updated_at`.
5. (Engine) Connect (encrypt token, SSRF-checked test fetch) → propose-mapping → operator
   confirm with real-value preview → lock.
6. (Engine) Sync task (replay spec + coercion + simple synthesis, download images, upsert NULL)
   → embed → search. Add the manual "Sync again".
7. Validate each step against the running test site.

**Phase 2**
8. (Test site) Emit HMAC-signed change events on create/update/delete.
9. (Engine) `POST …/notify` endpoint: verify signature → same mapping → apply (with the
   embedding rules from §8) → manual re-sync as the self-heal.
