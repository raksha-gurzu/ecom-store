#!/usr/bin/env bash
# Export the catalog you already have into a snapshot DevOps can restore.
#
# WHY a snapshot instead of scraping on the server: a deploy that scrapes
# meesa.shop depends on that site being up, unchanged, and tolerant of ~1-2k
# requests, with our parser still matching their HTML. A snapshot is
# reproducible and takes seconds. Re-scrape when you WANT fresh data, then
# re-export — don't make it a deploy step.
#
#   ./scripts/export-seed.sh              # writes ./seed/
#   ./scripts/export-seed.sh /tmp/out     # or somewhere else
#
# Env: DB_CONTAINER (default ecomshop-db-1), DB_USER (default merchant),
#      IMAGES_DIR (default ./images).
set -euo pipefail

OUT="${1:-seed}"
DB_CONTAINER="${DB_CONTAINER:-ecomshop-db-1}"
DB_USER="${DB_USER:-merchant}"
IMAGES_DIR="${IMAGES_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/images}"

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "✗ database container '$DB_CONTAINER' is not running." >&2
  echo "  Start the dev stack first:  docker compose up -d" >&2
  exit 1
fi

mkdir -p "$OUT"

echo "→ dumping catalog data from $DB_CONTAINER…"
# Data only: the destination gets its tables, views and roles from schema.sql at
# first boot, so shipping DDL here would collide. --disable-triggers defers the
# foreign keys, because a data-only dump does not emit tables in dependency order.
docker exec "$DB_CONTAINER" pg_dump \
  --username "$DB_USER" \
  --dbname merchant_catalog \
  --data-only \
  --disable-triggers \
  --no-owner \
  --no-privileges \
  > "$OUT/catalog-data.sql"

echo "→ archiving images…"
tar -czf "$OUT/images.tar.gz" -C "$IMAGES_DIR" .

PRODUCTS=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d merchant_catalog -tAc \
  "SELECT COUNT(*) FROM product_groups")
VARIANTS=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d merchant_catalog -tAc \
  "SELECT COUNT(*) FROM options")
IMAGE_COUNT=$(find "$IMAGES_DIR" -type f ! -name '.gitkeep' | wc -l | tr -d ' ')

cat > "$OUT/MANIFEST.txt" <<EOF
Catalog snapshot for the test merchant site (ecom-store).

  exported     $(date -u '+%Y-%m-%d %H:%M UTC')
  products     $PRODUCTS
  variants     $VARIANTS
  image files  $IMAGE_COUNT

Restore into a running production stack with:
  ./scripts/restore-seed.sh <this-directory>

Contents:
  catalog-data.sql  data-only pg_dump, restores on top of db/schema.sql
  images.tar.gz     product images, extracted into the app's images volume
EOF

echo
echo "✓ snapshot written to $OUT/"
ls -lh "$OUT"
echo
echo "Hand $OUT/ to DevOps — it is too large for git, so transfer it out of band"
echo "(shared drive, object storage, or scp straight to the server)."
