#!/usr/bin/env bash
# Load a catalog snapshot into the running PRODUCTION stack. Run once, after
# `docker compose -f docker-compose.prod.yml up -d`, from the repo root.
#
#   ./scripts/restore-seed.sh            # reads ./seed/
#   ./scripts/restore-seed.sh /srv/seed  # or wherever the snapshot landed
#
# Safe to re-run: it refuses to load on top of an existing catalog unless you
# pass FORCE=1, so a stray second run cannot duplicate or clobber data.
set -euo pipefail

SEED="${1:-seed}"
COMPOSE=(docker compose -f docker-compose.prod.yml)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ -f "$REPO_ROOT/.env" ] || { echo "✗ no .env — copy .env.prod.example first" >&2; exit 1; }
# shellcheck disable=SC1091
set -a; . "$REPO_ROOT/.env"; set +a
DB_USER="${POSTGRES_USER:?POSTGRES_USER missing from .env}"

for f in catalog-data.sql images.tar.gz; do
  [ -f "$SEED/$f" ] || { echo "✗ $SEED/$f not found" >&2; exit 1; }
done

cd "$REPO_ROOT"

EXISTING=$("${COMPOSE[@]}" exec -T db psql -U "$DB_USER" -d merchant_catalog -tAc \
  "SELECT COUNT(*) FROM product_groups" | tr -d '[:space:]')
if [ "$EXISTING" != "0" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "✗ the catalog already holds $EXISTING products — not restoring over it." >&2
  echo "  To replace it deliberately:  FORCE=1 $0 $SEED" >&2
  exit 1
fi

if [ "$EXISTING" != "0" ]; then
  echo "→ FORCE=1: clearing $EXISTING existing products…"
  # product_images and options cascade from product_groups.
  "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d merchant_catalog \
    -c "TRUNCATE product_groups CASCADE"
fi

echo "→ restoring catalog data…"
"${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 --single-transaction \
  -U "$DB_USER" -d merchant_catalog < "$SEED/catalog-data.sql"

echo "→ restoring images into the app volume…"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$SEED/images.tar.gz" -C "$TMP"
"${COMPOSE[@]}" cp "$TMP/." app:/app/images/

echo "→ verifying…"
"${COMPOSE[@]}" exec -T app node -e "
(async () => {
  const base = 'http://127.0.0.1:4000';
  const health = await (await fetch(base + '/health')).json();
  if (health.status !== 'ok') { console.error('health:', health); process.exit(1); }
  const cat = await (await fetch(base + '/api/catalog?page=1', {
    headers: { Authorization: 'Bearer ' + process.env.READ_TOKEN },
  })).json();
  const photo = cat.items.flatMap(p => p.options ?? [p]).map(o => o.photo)
    .find(u => u && !u.includes('__broken__'));
  console.log('  products:   ' + health.products);
  console.log('  pages:      ' + cat.total_pages);
  console.log('  image URL:  ' + photo);
  if (photo && !photo.startsWith(process.env.PUBLIC_BASE_URL))
    console.warn('  ⚠ image URLs do not match PUBLIC_BASE_URL — consumers will 404');
})();
"

echo
echo "✓ restore complete."
echo "  Images are served from the public URL above — open one in a browser to confirm"
echo "  it loads without a token. If it 404s, PUBLIC_BASE_URL in .env is wrong."
