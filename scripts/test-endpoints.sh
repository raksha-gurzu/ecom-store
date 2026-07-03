#!/usr/bin/env bash
# Live endpoint battery — auth, pagination, browse, real images, manage CRUD,
# and read-only role enforcement. Run against a running app.
#   BASE=http://localhost:4000 ./scripts/test-endpoints.sh
# Env: BASE, READ_TOKEN, ADMIN_TOKEN, DB_CONTAINER (for the role check).
set -u
BASE="${BASE:-http://localhost:4000}"
RT="${READ_TOKEN:-merchant_demo_readonly_token_abc123}"
AT="${ADMIN_TOKEN:-merchant_demo_admin_token_def456}"
DB_CONTAINER="${DB_CONTAINER:-ecomshop-db-1}"
P=0; F=0
chk(){ if [ "$2" = "$3" ]; then echo "✅ $1 ($3)"; P=$((P+1)); else echo "❌ $1 — expected $2 got $3"; F=$((F+1)); fi; }
code(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }
A=(-H "Authorization: Bearer $AT" -H "Content-Type: application/json")

echo "─── AUTH ───"
chk "catalog no token → 401"      401 "$(code $BASE/api/catalog?page=1)"
chk "catalog wrong token → 401"   401 "$(code -H "Authorization: Bearer WRONG" $BASE/api/catalog?page=1)"
chk "catalog right token → 200"   200 "$(code -H "Authorization: Bearer $RT" $BASE/api/catalog?page=1)"
chk "read token on admin → 401"   401 "$(code -H "Authorization: Bearer $RT" $BASE/manage/products)"
chk "manage no token → 401"       401 "$(code $BASE/manage/products)"
chk "manage admin token → 200"    200 "$(code "${A[@]}" $BASE/manage/products)"

echo "─── STOREFRONT / IMAGES / EDGE ───"
chk "/ (storefront) → 200"        200 "$(code $BASE/)"
chk "/category/Earrings → 200"    200 "$(code $BASE/category/Earrings)"
chk "/?q=top search → 200"        200 "$(code "$BASE/?q=top")"
chk "/products/NOPE → 404"        404 "$(code $BASE/products/NOPE-NOPE)"
chk "/browse → 301 redirect"      301 "$(code $BASE/browse)"
chk "/api-info → 200"             200 "$(code $BASE/api-info)"
chk "/store.css served → 200"     200 "$(code $BASE/store.css)"
chk "broken-image trap → 404"     404 "$(code $BASE/img/__broken__.jpg)"
chk "unknown route → 404"         404 "$(code $BASE/totally/unknown)"

echo "─── MANAGE CRUD LIFECYCLE ───"
SG="ENDPOINT-TEST-$$"
curl -s -X DELETE "${A[@]}" $BASE/manage/products/$SG >/dev/null
chk "create (+2 options) → 201"   201 "$(code -X POST "${A[@]}" -d "{\"sku_group\":\"$SG\",\"title\":\"T\",\"dept\":\"test\",\"options\":[{\"sku\":\"$SG-S\",\"amount\":500,\"stock\":3},{\"sku\":\"$SG-M\",\"amount\":500,\"stock\":0}]}" $BASE/manage/products)"
chk "duplicate create → 409"      409 "$(code -X POST "${A[@]}" -d "{\"sku_group\":\"$SG\",\"title\":\"x\",\"dept\":\"y\"}" $BASE/manage/products)"
chk "missing field → 400"         400 "$(code -X POST "${A[@]}" -d '{"title":"x"}' $BASE/manage/products)"
chk "patch title → 200"           200 "$(code -X PATCH "${A[@]}" -d '{"title":"T2"}' $BASE/manage/products/$SG)"
chk "add option → 201"            201 "$(code -X POST "${A[@]}" -d "{\"sku\":\"$SG-L\",\"amount\":600,\"stock\":7}" $BASE/manage/products/$SG/options)"
chk "patch option → 200"          200 "$(code -X PATCH "${A[@]}" -d '{"amount":650}' $BASE/manage/options/$SG-L)"
chk "delete option → 200"         200 "$(code -X DELETE "${A[@]}" $BASE/manage/options/$SG-L)"
chk "delete product → 200"        200 "$(code -X DELETE "${A[@]}" $BASE/manage/products/$SG)"
chk "delete again → 404"          404 "$(code -X DELETE "${A[@]}" $BASE/manage/products/$SG)"
chk "cascade: option gone → 404"  404 "$(code -X PATCH "${A[@]}" -d '{"amount":1}' $BASE/manage/options/$SG-S)"

echo "─── READ-ONLY ROLE ───"
if command -v docker >/dev/null && docker ps --format '{{.Names}}' | grep -q "$DB_CONTAINER"; then
  W=$(docker exec "$DB_CONTAINER" psql -U gurzu_readonly -d merchant_catalog -tAc "INSERT INTO product_groups(sku_group,title,dept) VALUES('x','x','x');" 2>&1 | grep -c "permission denied")
  chk "readonly INSERT denied"    1 "$W"
else
  echo "⚠️  skipping role check (db container '$DB_CONTAINER' not found)"
fi

echo; echo "RESULT: $P passed, $F failed"
[ "$F" = "0" ]
