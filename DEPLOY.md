# Deploying this site — hand-off notes for DevOps

Everything needed to host the test merchant site. It is a small, self-contained
stack: one Node service, one Postgres, one volume of product images.

> **What this site is:** a merchant-side catalog used to test GurzuVTO's Custom
> Pull connector. It exposes a token-protected product API, a public image
> directory, and a plain storefront. It handles no customers, payments, or
> personal data.

---

## 1. What you get

| Piece | What it is | Notes |
|---|---|---|
| `app` | Node 20 / Express, built from the `Dockerfile` here | listens on 4000 inside the container |
| `db` | Postgres 16 | schema and roles bootstrap themselves on first boot |
| `pgdata` volume | the catalog database | must persist |
| `images` volume | ~700MB of product photos | must persist — see §4 |

Two roles exist in the database: an owner role for writes and `gurzu_readonly`,
a SELECT-only role the public catalog endpoint reads through. Keep that split;
it is the reason a bug in the read path cannot corrupt data.

## 2. Endpoints

| Path | Auth | Purpose |
|---|---|---|
| `GET /` | none | storefront (human-facing) |
| `GET /health` | none | liveness — returns `{"status":"ok","products":N}` |
| `GET /api/catalog?page=N` | `Authorization: Bearer <READ_TOKEN>` | the catalog consumers pull |
| `GET /img/<file>` | **none, by design** | product images |
| `/manage/*` | `Authorization: Bearer <ADMIN_TOKEN>` | admin writes — internal only |
| `GET /api-info` | none | integration reference page |

**The app runs as an unprivileged user** (`node`, uid 1000) inside the container,
not as root, and cannot write to its own application code. The only writable path
is the images volume. If you add a volume or bind mount the app must write to,
make sure uid 1000 can write to it.

**Images must stay public.** They are deliberately served before the auth guard.
If they are put behind a token or a proxy rule, every image download fails for
the consumer and the integration degrades silently. Do not "secure" `/img`.

## 3. Deploy

```bash
git clone <this repo> && cd ecom-store
cp .env.prod.example .env       # fill in every CHANGE-ME value
docker compose -f docker-compose.prod.yml up -d --build
curl -fsS http://127.0.0.1:4000/health
```

The stack refuses to start if a required secret is missing, so a half-filled
`.env` fails immediately instead of booting insecurely.

Generate the two API tokens and the database passwords with `openssl rand -hex 32`.

**`PUBLIC_BASE_URL` is the setting that most often goes wrong.** Product image
URLs in the API response are built from it. Set it to the exact public origin
including scheme and no trailing slash (`https://shop.example.com`). If it is
wrong, the catalog looks perfectly fine and every image 404s.

### TLS and the reverse proxy

The app binds to `127.0.0.1:4000` by default and speaks plain HTTP. Terminate
TLS in front of it with whatever you normally use. Requirements:

- forward to `127.0.0.1:4000`
- do **not** rewrite or strip the `Authorization` header
- do **not** add auth in front of `/` or `/img`
- allow response bodies of a few MB (a catalog page carries 50 products)

Set `APP_BIND=0.0.0.0` only if you intend to expose the container directly.

### Postgres is deliberately not published

`docker-compose.prod.yml` publishes no database port. If a consumer needs direct
read-only SQL access, publish `5432` explicitly, restrict it by source address,
and set `PUBLIC_DB_URL` so the `/api-info` page shows the right string. The
`gurzu_readonly` role is SELECT-only, but it is still database access — treat it
as a deliberate decision, not a default.

The database name is fixed to `merchant_catalog`. `db/schema.sql` grants
privileges to that database by name, so renaming it breaks the read-only role.

## 4. Loading the catalog data

A fresh stack boots with an **empty** catalog — the schema exists, the products
do not. The data arrives as a snapshot, not by scraping.

> **Why not scrape on the server:** the scraper pulls from a third-party site
> (`meesa.shop`) with 1–2k requests and a parser tied to that site's HTML. As a
> deploy step it would make every deploy depend on someone else's website being
> up and unchanged. It stays in the repo as a refresh tool, run deliberately by
> the app team, never at deploy time.

The app team hands you a snapshot directory containing `catalog-data.sql`,
`images.tar.gz` and a `MANIFEST.txt` stating the product and image counts. It is
several hundred MB, so it arrives out of band (shared drive, object storage,
`scp`) rather than through git.

```bash
# with the stack already running, from the repo root
./scripts/restore-seed.sh /path/to/snapshot
```

It loads the data, unpacks the images into the `images` volume, then verifies
and prints the product count and a sample image URL. It refuses to run on top of
a non-empty catalog unless you pass `FORCE=1`, so a repeated run cannot duplicate
data.

Afterwards, open the printed image URL in a browser. If it loads without a
token, `PUBLIC_BASE_URL` and the proxy are both correct.

## 5. Verifying a deployment

```bash
curl -fsS https://your-domain/health
curl -fsS -H "Authorization: Bearer $READ_TOKEN" \
  "https://your-domain/api/catalog?page=1" | head -c 300
curl -fsS -o /dev/null -w '%{http_code}\n' https://your-domain/img/<any-file>   # expect 200
curl -s -o /dev/null -w '%{http_code}\n' https://your-domain/api/catalog         # expect 401
```

Health returning `"status":"degraded"` means the app is up but cannot reach
Postgres — check `db` health and the credentials in `.env`.

## 6. Operations

**Backups.** Two things matter: the `pgdata` volume and the `images` volume.
Images are static after a load, so one copy after each data refresh is enough.

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" -d merchant_catalog --data-only --disable-triggers \
  > backup-$(date +%F).sql
```

**Updating the app.** `git pull && docker compose -f docker-compose.prod.yml up -d --build`.
Data lives in volumes, so a rebuild does not touch it.

**Deploying a prebuilt image instead of building on the server.** CI can publish
to GHCR (see §7). Set `APP_IMAGE=ghcr.io/OWNER/ecom-store:latest` in `.env` and
`docker compose -f docker-compose.prod.yml pull app && … up -d`.

**Rotating the read token.** Change `READ_TOKEN` in `.env`, restart `app`, and
give the new value to the consumer. Rotating it revokes the old one immediately.

**Logs.** `docker compose -f docker-compose.prod.yml logs -f app`. Both services
are `restart: unless-stopped`, so they come back after a crash or a reboot.

## 7. CI

`.github/workflows/ci.yml` runs on every pull request and every push to `dev`. It
builds **this exact compose stack**, seeds a seven-product fixture
(`db/ci-seed.sql`) covering every awkward shape the contract requires, and runs
four suites against it:

| Suite | Checks |
|---|---|
| `scripts/smoke.mjs` | the API contract — auth, pagination, field shapes, traps |
| `scripts/audit.mjs` | data integrity — images resolve and decode, ids unique, no bad values |
| `scripts/test-endpoints.sh` | live auth, storefront, admin CRUD, read-only role |
| `scripts/test-storefront.mjs` | rendering, escaping, error statuses, auth edges, trap isolation |

It also asserts that **no Postgres port is published**, so a future edit that
exposes the database fails the build, and sweeps the tree for committed
credentials.

`.github/workflows/main.yml` runs on `main` and adds a **deployability gate** that
matters to you specifically: the stack must start from `.env.prod.example` alone,
must refuse to start when a secret is missing, and the snapshot export/restore
path must work end to end. If that workflow is green, the instructions in §3 and
§4 of this document have been executed by a machine, not just written down.

CI does not use the real catalog — that is several hundred products and ~700MB of
images that live outside git.

**Image publishing is opt-in.** The `publish` job pushes to GHCR only when the
repository variable `PUBLISH_IMAGE` is set to `true`
(Settings → Secrets and variables → Actions → Variables). Turn it on if you want
to deploy prebuilt images.

## 8. Files worth knowing

| File | What it is |
|---|---|
| `docker-compose.prod.yml` | **the deployable stack** |
| `.env.prod.example` | every setting, with notes — copy to `.env` |
| `scripts/restore-seed.sh` | load a catalog snapshot (you run this) |
| `scripts/export-seed.sh` | produce a snapshot (the app team runs this) |
| `db/schema.sql` | tables, views, roles — runs itself on first boot |
| `docker-compose.yml` | **local development only** — do not deploy it |
| `INTEGRATION.md` | how a consumer connects (URL + token, or direct SQL) |

`docker-compose.yml` publishes the database to the host, ships pgAdmin, and has
working default passwords. It is for laptops. `docker-compose.prod.yml` is the
one to host.
