---
owner: raksha
reviewed: 2026-08-18
covers:
  - src/serialize.js
  - src/routes/catalog.js
  - src/db.js
  - db/schema.sql
---

# Principles this project is built on

Explanation, not reference. If you are about to change something and are unsure
whether you are allowed to, this page is the answer. Each principle states the
rule, the reason, and what breaking it looks like — because a rule whose reason
is unrecorded gets deleted by the next person who finds it inconvenient.

## 1. The catalog must not look like the consumer's schema

Field names are the merchant's own: `sku_group`, `title`, `long_desc`, `options`,
`colour`, `cost`, `photo`. They are deliberately *not* GurzuVTO's names.

**Why:** this site exists to test a connector whose hardest job is AI field
mapping. A catalog that already used the consumer's vocabulary would make every
test pass while proving nothing.

**Breaking it looks like:** a well-meaning cleanup that renames `cost` to `price`
because it reads better. The test target quietly stops testing anything.

## 2. Messiness lives in serialization, never in the database

The database stores clean, typed values. The wire format is where prices become
cents, or currency strings, or stock becomes the text `"out of stock"`, and where
one image URL points at nothing. `serialize_quirk` on each product drives which
distortion it gets.

**Why:** two consumers read the same rows — the connector (which must cope with
mess) and the storefront (which must not show it). Storing the mess would force
the human UI to defend against data we deliberately corrupted.

**Breaking it looks like:** the storefront rendering a dead image, or an audit
failure saying `broken-image URL stored in the DB`. `scripts/test-storefront.mjs`
asserts this invariant in both directions: the trap must appear in the API and
must never appear in the storefront.

## 3. The read path cannot write

Catalog reads go through `gurzu_readonly`, a role with `SELECT` and nothing else.
Writes use the owner role. Two connection pools, enforced by the database rather
than by discipline.

**Why:** a defect in the most-exposed path should be incapable of corrupting
data, not merely unlikely to.

**Breaking it looks like:** `scripts/test-endpoints.sh` failing its final check,
where an `INSERT` as the read-only role is expected to be denied.

## 4. Images are public; the catalog is not

`/img` is mounted before the auth guard, on purpose. The catalog requires a
bearer token; the images it references require nothing.

**Why:** the consumer downloads images anonymously. Gating them means every
download fails and the integration silently degrades to text-only — the failure
looks like a bad model, not a bad config.

**Breaking it looks like:** someone "securing" the static mount, or a reverse
proxy adding auth in front of `/`.

## 5. Identifiers are stable across syncs

`sku_group` is the upstream slug; `options.sku` is derived deterministically as
`SLUG__SIZE__COLOUR`. Re-running the scraper upserts in place.

**Why:** the consumer stores these ids. If they churn, every sync looks like a
catalog of brand-new products and the consumer re-embeds everything.

**Breaking it looks like:** duplicated products after a scrape, or a diff where
every id changed.

## 6. The storefront is additive and must never reshape the contract

The human UI reads the same database and renders HTML. It may not change the API
shape, the schema's merchant vocabulary, or the trap data to suit itself.

**Why:** the API is the product. The storefront is a convenience that came later.
When the storefront wants cleaner data, the answer is to store a clean value
*for the UI*, never to sanitise the contract.

### The sanitiser is the clearest example

Product descriptions are merchant HTML, injected into the storefront so formatting
survives. Scraped from a third party, that is an injection vector nobody reviews —
a description containing `<script>` would execute in every visitor's browser.

The fix respects the split rather than breaking it: `src/views/sanitize.js` cleans
the HTML **on the storefront's render path only**. `GET /api/catalog` still ships
the original markup, because that is the merchant's real data and the consumer is
specified to sanitise it. Sanitising the contract would have removed exactly the
messiness the connector is supposed to be tested against.

Enforced by `npm run test:sanitize` (34 adversarial cases) and by a stored-XSS
regression test in `npm run test:storefront` that asserts both halves: the
storefront must not execute it, the API must still contain it.

## 7. Server and browser render from one component tree

`src/ui/*.jsx` is compiled twice — once for the server, once for the browser —
and both are given identical props. Initial state is computed by pure functions
that run on both sides.

**Why:** that is what makes hydration attach to the server's HTML rather than
discarding it, and it is why the storefront works before JavaScript loads.

**Breaking it looks like:** a hydration mismatch warning in the console and a
visible flicker; usually caused by a `Date`, a random value, or props that
differ between render and embed.

## 8. Data is a snapshot, never a deploy-time scrape

Deployments load a database dump plus an image archive. The scraper is a tool run
deliberately, not a step in the deploy.

**Why:** scraping at deploy time makes every release depend on a third party's
website being up and unchanged. The failure lands on whoever is deploying, at the
worst moment, with no idea why.

## 9. Every rule here has a check

A principle nobody verifies is a preference. Each of the above is enforced by
something that fails: the four test suites, `npm run check:repo`, or the CI
pipeline. If you add a principle, add the check with it.
