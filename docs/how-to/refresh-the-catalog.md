---
owner: raksha
reviewed: 2026-08-18
covers:
  - scripts/scrape.mjs
  - scripts/export-seed.sh
  - scripts/restore-seed.sh
---

# How to refresh the catalog

For someone who needs newer product data, or who is starting from an empty
database.

## Refresh the data you develop against

```bash
docker compose up -d           # the scraper needs the database
npm run scrape                 # walks the upstream site, upserts, downloads images
npm run audit                  # confirm what landed is intact
```

The scrape is **idempotent**: it upserts on `sku_group` and `sku`, and replaces
each product's options and images wholesale. Re-running never duplicates
anything, so an interrupted run is safe to repeat.

It takes a while. Most of the time goes on the real variant matrix — the scraper
asks the upstream site which colour-and-size combinations genuinely exist rather
than assuming every combination does, which is one or two thousand requests.

## Give the refreshed data to a deployment

Production never scrapes. Export a snapshot and hand it over:

```bash
./scripts/export-seed.sh                    # writes ./seed/
```

You get `catalog-data.sql`, `images.tar.gz` and a `MANIFEST.txt` with the product
and image counts. It is several hundred megabytes, so it is gitignored — transfer
it out of band (shared drive, object storage, or `scp` to the server).

DevOps then loads it with `./scripts/restore-seed.sh`, documented in
[`../../DEPLOY.md`](../../DEPLOY.md).

## Start over completely

```bash
docker compose down -v         # drops the database volume
docker compose up -d           # schema.sql runs again on the empty volume
npm run scrape
```

`down -v` also destroys the images volume in the production stack. In development
the images are a bind mount to `./images`, so they survive.

## When it goes wrong

**The scrape stops partway.** Re-run it. Completed products are already committed
and will be upserted in place.

**`audit` reports missing images.** The database references files that never
downloaded. Re-run the scrape; it re-downloads what is absent.

**`audit` reports images that are "undecodable or misnamed".** The upstream site
occasionally serves one format under another format's content type. The scraper
identifies images by their magic bytes rather than trusting the header, so this
should self-correct on a re-run.

**Everything downloads but the product count barely moves.** Only a handful of
upstream categories have enough products to be worth walking, and the scraper
deduplicates globally — the same product listed in three categories is stored
once.

## What you must not do

Do not make the scrape part of a deployment. It depends on a third party's site
being reachable, unchanged, and tolerant of the request volume. See
[principle 8](../explanation/principles.md).
