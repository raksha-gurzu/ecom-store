---
owner: raksha
reviewed: 2026-08-18
covers:
  - src/server.js
  - src/routes/
  - src/ui/
  - src/views/
---

# Architecture

Explanation. How a request actually flows, and why the pieces are arranged this
way. For a flat list of files see
[`../reference/repository-map.md`](../reference/repository-map.md).

## What this system is

A merchant's e-commerce site, built to be *pulled from*. A catalog connector
authenticates, walks paginated JSON, and downloads images. Everything else —
including the storefront people look at — exists to make that target realistic.

The stack is deliberately small: Node with Express, PostgreSQL queried with plain
SQL, and React rendered on the server. Five runtime dependencies in total —
`express`, `pg`, `dotenv`, `react`, `react-dom`. No ORM, no API framework, no
client-side router.

## Two faces, one database

```
                    ┌───────────────────────────┐
   scraper ────────▶│        PostgreSQL         │
  (run by hand)     │  clean, typed, merchant   │
                    │        vocabulary         │
                    └─────────────┬─────────────┘
                       read-only  │  role
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
          serialize.js                     src/ui/*.jsx
      (adds the coercion traps)         (renders for humans)
                    │                           │
                    ▼                           ▼
        GET /api/catalog  ──▶ connector    GET / ──▶ browser
           token required                   no auth
```

The same rows feed both, and that is the point of the design: the database stays
clean, and the *mess* the connector must handle is added on the way out. See
[`principles.md`](principles.md) §2.

## How a storefront request flows

1. **Express matches the route** (`src/routes/store.js`). Mount order matters:
   static assets and `/img` first, then the storefront, then the token-guarded
   `/api`. A storefront route can never shadow the contract.
2. **The route queries the read-only pool** and builds a plain props object.
   Coercion happens here (`src/views/product-props.js`), not in the component —
   `pg` returns `NUMERIC` as a string, and a component that formatted `"1499.00"`
   as a number would print the wrong price.
3. **React renders to a string** (`src/views/render.js`), producing complete HTML.
4. **The same props are embedded** in the page as JSON.
5. **The browser hydrates** (`src/client/entry.jsx`): it reads that JSON, renders
   the same component tree, and attaches to the existing DOM.

Step 4 is what makes step 5 possible. React can only attach to server HTML if it
re-renders to the same result, which requires identical input and pure initial
state.

### Why server-rendered rather than a single-page app

The storefront was originally HTML built from template strings, and the migration
to React kept that shape on purpose:

- **It works before JavaScript does.** The grid, the prices and the product
  descriptions are in the first response.
- **Routing stays on the server.** Each URL is a real page; there is no client
  router to keep in sync with Express.
- **The failure mode is mild.** If the bundle fails to load, the site is static
  rather than blank.

The cost is a build step. `dist/ui.js` and `public/bundle.js` are generated, and
the server imports the former — so an edit to a component does nothing until
`npm run build` runs. The Dockerfile does this in a separate stage so the build
toolchain never ships to production.

## How a catalog request flows

1. `src/middleware/auth.js` compares the bearer token in constant time.
2. `src/routes/catalog.js` pages through `product_groups` in a deterministic
   order (`created_at, sku_group`), so pagination is stable between calls.
3. `src/serialize.js` reshapes each row into the merchant's wire format and
   applies that product's `serialize_quirk`.

There is a second, equivalent path: `catalog_json`, a SQL view that produces
byte-identical JSON for consumers who prefer a read-only database connection over
HTTP. **The view mirrors `src/serialize.js` and must be changed with it** — the
two are verified to agree across every product.

## Change notifications

When a product changes through `/manage/*`, `src/notify.js` signs the payload
with HMAC-SHA256 and POSTs it to the configured consumer. Delivery is best
effort: a notification failure never fails the write, because the catalog is the
source of truth and the consumer re-syncs anyway.

The event type carries a meaning the consumer acts on: price and quantity changes
are `variant.updated` (no re-embedding needed), while content and image changes
are `product.updated` (re-embed).

## Where the data comes from

The catalog is scraped from a real marketplace, which shapes several decisions:

- **Images are re-hosted.** Upstream URLs are signed and expire within minutes,
  so storing them would produce a catalog of dead links.
- **Variants are queried, not assumed.** A variant exists only if upstream
  confirms that colour-and-size combination, so the catalog never advertises
  combinations that do not exist.
- **Scraping is never part of a deploy.** See [`principles.md`](principles.md) §8.
