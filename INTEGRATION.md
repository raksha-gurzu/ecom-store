# Integration guide — connect the engine to this merchant site

Everything the engine needs to pull our catalog, **two ways**. Both are **read-only**
and return the data in the merchant's own shape (clean JSON). Use whichever fits.

> Dev credentials below are deliberately throwaway. Change them for any real deployment
> (`.env` for the API tokens; `db/schema.sql` for the DB role password).

---

## Way 1 — the API (URL + key)

The engine calls our HTTP endpoint with a Bearer token and gets paginated JSON.

| | |
|---|---|
| **Base URL** | `http://localhost:4000` |
| **Catalog endpoint** | `GET /api/catalog?page=N` |
| **Auth header** | `Authorization: Bearer <READ_TOKEN>` |
| **Read token** | `merchant_demo_readonly_token_abc123` |
| **Page size** | 50 (response carries `page`, `total_pages`, `total_items`, `items[]`) |
| **Images** | `GET /img/<file>` — **public, no token** (download anonymously) |

Copy-paste test:

```bash
curl -H "Authorization: Bearer merchant_demo_readonly_token_abc123" \
  "http://localhost:4000/api/catalog?page=1"
```

Walk all pages until `page == total_pages`. Each `items[]` entry is one product in our
shape; image URLs under `photo` resolve without auth.

> The API path is the one that carries the deliberate **coercion traps** (prices as
> cents/strings, `"out of stock"`, array-form options) — it's the realistic, messy view
> meant to exercise field-mapping.

---

## Way 2 — direct database (read-only connection string)

The engine connects straight to our Postgres with a **SELECT-only** role and runs one
query to get clean JSON. It can read, but **can never write** (verified).

| | |
|---|---|
| **Database** | `merchant_catalog` |
| **User** | `gurzu_readonly` |
| **Password** | `readonly_pw` |

**Connection string (use this — the engine runs in its own container):**

```
postgres://gurzu_readonly:readonly_pw@172.17.0.1:5433/merchant_catalog
```

⚠️ **The host part depends on where the consumer runs** — this is the #1 gotcha:

| Consumer runs… | Host : Port | |
|---|---|---|
| inside its **own** Docker container (the engine) | `172.17.0.1:5433` | ✅ use this |
| on your laptop (pgAdmin desktop, psql) | `localhost:5433` | host-native only |
| inside **this shop's** compose network (app, pgAdmin) | `db:5432` | internal only — **don't hand this out** |

Inside a container `localhost` is that container itself, so a containerized consumer
given `localhost:5433` gets `[Errno 111] Connection refused`; `172.17.0.1` is the docker
bridge gateway back to the host. `host.docker.internal` works only if that consumer's
compose sets `extra_hosts: ["host.docker.internal:host-gateway"]`. And `db` is a private
name that resolves only inside the shop's own network — an outside consumer using it
gets `Temporary failure in name resolution`.

### Clean JSON in one query

We ship database **views** so you don't need joins or an ORM — the data comes out already
shaped as JSON in the merchant's own format:

```sql
-- one product JSON per row — IDENTICAL to a GET /api/catalog item
SELECT product FROM catalog_json;

-- the entire catalog as a single JSON array
SELECT jsonb_agg(product) FROM catalog_json;

-- filter in SQL (e.g. only products with 2+ variants)
SELECT product FROM catalog_json
WHERE jsonb_array_length(product->'options') >= 2;
```

Prefer columns over JSON? Two flat views are also provided:

```sql
SELECT * FROM v_products;   -- one row per product
SELECT * FROM v_variants;   -- one row per variant (with real variation_id + stock)
```

Example connecting with `psql`:

```bash
psql "postgres://gurzu_readonly:readonly_pw@localhost:5433/merchant_catalog" \
  -c "SELECT product FROM catalog_json LIMIT 1;"
```

Or from Node (`pg`), Python (`psycopg`), etc. — any Postgres client works with the
connection string above.

### Notes for the DB path
- **Read-only:** the role has `SELECT` only; `INSERT/UPDATE/DELETE` are rejected.
- **`catalog_json` returns the SAME product JSON as `GET /api/catalog`** — identical fields,
  the same coercion "traps" (cents / currency-string / out-of-stock / array options), and
  absolute image URLs. (The view mirrors `src/serialize.js`.) So whichever path you use, the
  engine sees the same products. The flat `v_variants` / `v_products` views still expose the
  raw clean columns if you want them.

---

## Quick reference

| Need | Use | One-liner |
|---|---|---|
| Paginated JSON over HTTP | API | `curl -H "Authorization: Bearer merchant_demo_readonly_token_abc123" localhost:4000/api/catalog?page=1` |
| All products as JSON, no app | DB view | `SELECT jsonb_agg(product) FROM catalog_json;` |
| Relational rows | DB view | `SELECT * FROM v_variants;` |
| Download an image | HTTP | `curl localhost:4000/img/<file> -o out.jpg` |
| Change notifications (Phase 2) | HMAC POST | see `README.md` → Phase 2 |

These same details are shown in the browser at **http://localhost:4000/api-info**.
