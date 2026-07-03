-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ Test merchant catalog — schema in the MERCHANT'S OWN shape.                ║
-- ║                                                                           ║
-- ║ Field names here are deliberately the merchant's own (sku_group, title,   ║
-- ║ long_desc, options, colour, cost, photo…) and NOT GurzuVTO's. The whole   ║
-- ║ point of the Custom Pull connector is to exercise AI field-mapping, so a  ║
-- ║ schema that already looked like Gurzu's would leave the mapping untested. ║
-- ║                                                                           ║
-- ║ The catalog read endpoint reads through the SELECT-only `gurzu_readonly`  ║
-- ║ role created at the bottom (spec §4.1 recommendation). Writes (scraper +  ║
-- ║ manage endpoints) go through the owner role `merchant`.                   ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- ── A "product" in the merchant's vocabulary is a `product_group` ────────────
CREATE TABLE IF NOT EXISTS product_groups (
    -- Stable external product id (our upsert key). Sourced from the meesa slug,
    -- which is unique and stable across syncs.
    sku_group     TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    long_desc     TEXT,                       -- may contain HTML (engine sanitizes)
    page_url      TEXT,
    brand_name    TEXT,                        -- nullable → missing-optional trap
    dept          TEXT NOT NULL,               -- the merchant's word for "category"
    source_url    TEXT,                        -- where we scraped it from (provenance)

    -- Simple products (no options) carry their price/stock/photo at the product
    -- level; the engine synthesizes a single variant from these (spec §6.3).
    is_simple     BOOLEAN NOT NULL DEFAULT FALSE,
    base_amount   NUMERIC(12,2),               -- product-level price
    base_stock    INTEGER,
    base_photo    TEXT,

    -- Drives how the API serializes this product's price/stock/options so we can
    -- seed the §5 coercion traps deterministically without dirtying the DB:
    --   'normal'          → cost {amount:"1999.00", currency}, integer stock, flat options
    --   'cents'           → price_cents integer (e.g. 199900), no cost object
    --   'currency_string' → cost.amount as "Rs.1999" (strip-and-parse trap)
    --   'stock_text'      → stock as the string "out of stock"
    --   'array_options'   → options expose attrs:[{name,option}] array form
    serialize_quirk TEXT NOT NULL DEFAULT 'normal',

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── A "variant" in the merchant's vocabulary is an `option` ──────────────────
CREATE TABLE IF NOT EXISTS options (
    sku         TEXT PRIMARY KEY,              -- stable external variant id (derived)
    sku_group   TEXT NOT NULL REFERENCES product_groups(sku_group) ON DELETE CASCADE,
    size        TEXT,                          -- nullable (single-axis products)
    colour      TEXT,                          -- British spelling, merchant's own
    amount      NUMERIC(12,2) NOT NULL,        -- clean typed price; API may re-shape
    currency    TEXT NOT NULL DEFAULT 'NPR',
    stock       INTEGER NOT NULL DEFAULT 0,    -- REAL "Available Stock" from meesa
    photo       TEXT,                          -- per-colour lead image (/img path)
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v2 additions (idempotent for existing databases)
ALTER TABLE options ADD COLUMN IF NOT EXISTS variation_id TEXT;   -- meesa's REAL variant id
ALTER TABLE options ADD COLUMN IF NOT EXISTS in_stock BOOLEAN NOT NULL DEFAULT TRUE;

-- Full product image gallery (storefront thumbnails). The API contract still
-- exposes only options[].photo; this table feeds the human UI only.
CREATE TABLE IF NOT EXISTS product_images (
    sku_group   TEXT NOT NULL REFERENCES product_groups(sku_group) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    photo       TEXT NOT NULL,                 -- local /img path
    alt         TEXT,
    PRIMARY KEY (sku_group, position)
);

CREATE INDEX IF NOT EXISTS idx_options_sku_group ON options(sku_group);
CREATE INDEX IF NOT EXISTS idx_product_images_sku_group ON product_images(sku_group);
CREATE INDEX IF NOT EXISTS idx_product_groups_dept ON product_groups(dept);

-- keep updated_at honest on mutation (used by the manage endpoints / Phase 2)
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pg_touch ON product_groups;
CREATE TRIGGER trg_pg_touch BEFORE UPDATE ON product_groups
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_opt_touch ON options;
CREATE TRIGGER trg_opt_touch BEFORE UPDATE ON options
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── Read-only role for the catalog endpoint (spec §4.1) ──────────────────────
-- Mirrors a real merchant exposing reads through a restricted DB role: Gurzu
-- (and the public catalog endpoint) only ever SELECTs; it can never write.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gurzu_readonly') THEN
        CREATE ROLE gurzu_readonly LOGIN PASSWORD 'readonly_pw';
    END IF;
END
$$;

GRANT CONNECT ON DATABASE merchant_catalog TO gurzu_readonly;
GRANT USAGE ON SCHEMA public TO gurzu_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gurzu_readonly;
-- future tables + views too
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO gurzu_readonly;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ catalog_json — DIRECT database integration, IDENTICAL to GET /api/catalog. ║
-- ║                                                                           ║
-- ║     SELECT product FROM catalog_json;            -- one product JSON        ║
-- ║     SELECT jsonb_agg(product) FROM catalog_json; -- whole catalog at once   ║
-- ║                                                                           ║
-- ║ This view MIRRORS src/serialize.js: same fields, the same per-product      ║
-- ║ serialize_quirk traps (cents / currency-string / out-of-stock / array      ║
-- ║ options), and absolute image URLs — so the API and DB paths return the     ║
-- ║ SAME product JSON. KEEP IN SYNC with src/serialize.js. The image base URL   ║
-- ║ is hardcoded in mc_photo() to match PUBLIC_BASE_URL (default below).        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- helper functions mirroring src/serialize.js (mc_ = "merchant catalog")
CREATE OR REPLACE FUNCTION mc_money(n numeric) RETURNS text
    LANGUAGE sql IMMUTABLE AS $fn$ SELECT to_char(n, 'FM9999999990.00') $fn$;

-- absolute public image URL — base must match the app's PUBLIC_BASE_URL
CREATE OR REPLACE FUNCTION mc_photo(photo text) RETURNS text
    LANGUAGE sql IMMUTABLE AS $fn$
        SELECT CASE
            WHEN photo IS NULL THEN NULL
            WHEN photo ~ '^https?://' THEN photo
            ELSE 'http://localhost:4000' || photo
        END
    $fn$;

-- price per quirk: cents trap / currency-string trap / normal cost object
CREATE OR REPLACE FUNCTION mc_price(amount numeric, currency text, quirk text) RETURNS jsonb
    LANGUAGE sql IMMUTABLE AS $fn$
        SELECT CASE quirk
            WHEN 'cents' THEN jsonb_build_object('price_cents', round(amount * 100)::int)
            WHEN 'currency_string' THEN jsonb_build_object('cost',
                jsonb_build_object('amount', 'Rs.' || mc_money(amount), 'currency', currency))
            ELSE jsonb_build_object('cost',
                jsonb_build_object('amount', mc_money(amount), 'currency', currency))
        END
    $fn$;

-- stock per quirk: "out of stock"/"N in stock" text trap, or numeric
CREATE OR REPLACE FUNCTION mc_stock(stock integer, quirk text) RETURNS jsonb
    LANGUAGE sql IMMUTABLE AS $fn$
        SELECT CASE WHEN quirk = 'stock_text'
            THEN jsonb_build_object('stock',
                CASE WHEN COALESCE(stock,0) > 0 THEN stock::text || ' in stock' ELSE 'out of stock' END)
            ELSE jsonb_build_object('stock', COALESCE(stock,0))
        END
    $fn$;

-- variant axes: flat size/colour, or the array_options trap (attrs:[{name,option}])
CREATE OR REPLACE FUNCTION mc_axes(size text, colour text, quirk text) RETURNS jsonb
    LANGUAGE sql IMMUTABLE AS $fn$
        SELECT CASE WHEN quirk = 'array_options' THEN
            jsonb_build_object('attrs',
                (CASE WHEN size   IS NOT NULL THEN jsonb_build_array(jsonb_build_object('name','Size','option',size))   ELSE '[]'::jsonb END)
             || (CASE WHEN colour IS NOT NULL THEN jsonb_build_array(jsonb_build_object('name','Color','option',colour)) ELSE '[]'::jsonb END))
        ELSE
            (CASE WHEN size   IS NOT NULL THEN jsonb_build_object('size', size)     ELSE '{}'::jsonb END)
         || (CASE WHEN colour IS NOT NULL THEN jsonb_build_object('colour', colour) ELSE '{}'::jsonb END)
        END
    $fn$;

CREATE OR REPLACE VIEW catalog_json AS
SELECT
    pg.sku_group,
    pg.dept,
    (
        jsonb_build_object(
            'sku_group', pg.sku_group,
            'title',     pg.title,
            'long_desc', COALESCE(pg.long_desc, ''),
            'page_url',  pg.page_url,
            'dept',      pg.dept
        )
        || CASE WHEN pg.brand_name IS NOT NULL
                THEN jsonb_build_object('brand', jsonb_build_object('name', pg.brand_name))
                ELSE '{}'::jsonb END
        || CASE WHEN pg.is_simple THEN
                -- simple product: price/stock/photo at product level, no options
                mc_price(pg.base_amount, 'NPR', pg.serialize_quirk)
             || mc_stock(pg.base_stock, pg.serialize_quirk)
             || jsonb_build_object('photo', mc_photo(pg.base_photo))
           ELSE
                jsonb_build_object('options', COALESCE((
                    SELECT jsonb_agg(
                        jsonb_build_object('sku', o.sku)
                     || mc_price(o.amount, o.currency, pg.serialize_quirk)
                     || mc_stock(o.stock, pg.serialize_quirk)
                     || jsonb_build_object('photo', mc_photo(o.photo))
                     || mc_axes(o.size, o.colour, pg.serialize_quirk)
                        ORDER BY o.position)
                    FROM options o WHERE o.sku_group = pg.sku_group), '[]'::jsonb))
           END
    ) AS product
FROM product_groups pg;

-- Flat, relational-friendly views (for consumers that prefer columns to JSON).
CREATE OR REPLACE VIEW v_products AS
    SELECT sku_group, title, long_desc, page_url, brand_name, dept,
           is_simple, base_amount, base_stock, base_photo
      FROM product_groups;

CREATE OR REPLACE VIEW v_variants AS
    SELECT sku, sku_group, size, colour, amount, currency, stock, in_stock,
           variation_id, photo, position
      FROM options;

GRANT SELECT ON catalog_json, v_products, v_variants TO gurzu_readonly;
