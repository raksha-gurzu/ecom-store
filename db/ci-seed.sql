-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ CI fixture — a seven-product catalog exercising every contract rule.       ║
-- ║                                                                           ║
-- ║ CI cannot use the real catalog: it is 296 products and ~700MB of images    ║
-- ║ that live outside git. So this fixture reproduces the SHAPES the contract  ║
-- ║ tests look for, in miniature, letting npm run smoke / audit / test:endpoints║
-- ║ run on every push against a throwaway database.                            ║
-- ║                                                                           ║
-- ║ NEVER load this into a real deployment — it is test data, not the catalog. ║
-- ║ Coverage (see scripts/smoke.mjs + scripts/audit.mjs):                      ║
-- ║   multi-variant · single-variant · simple (no options) · missing brand     ║
-- ║   HTML descriptions · every serialize_quirk trap · the broken-photo quirk  ║
-- ║   multi-image gallery · real variation_id · in-stock and out-of-stock      ║
-- ║ Image files: scripts/ci-fixture-images.mjs writes real PNGs for these refs.║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

BEGIN;

TRUNCATE product_groups CASCADE;

-- ── 1. multi-variant, quirk 'normal', has brand, multi-image gallery ─────────
INSERT INTO product_groups
  (sku_group, title, long_desc, page_url, brand_name, dept, serialize_quirk)
VALUES
  ('ci-earrings-hoop', 'Gold Hoop Earring',
   '<p>Classic <b>gold-plated</b> hoops for everyday wear.</p>',
   'https://example.test/products/ci-earrings-hoop', 'Hoops & Loops',
   'Earrings', 'normal');

INSERT INTO options
  (sku, sku_group, size, colour, amount, currency, stock, photo, position, variation_id, in_stock)
VALUES
  ('CI-EARRINGS-HOOP__NA__GOLD',  'ci-earrings-hoop', NULL, 'Gold',
   1499.00, 'NPR', 7, '/img/ci-a.png', 0, 'var-ci-1001', TRUE),
  ('CI-EARRINGS-HOOP__NA__SILVER','ci-earrings-hoop', NULL, 'Silver',
   1499.00, 'NPR', 3, '/img/ci-b.png', 1, 'var-ci-1002', TRUE);

INSERT INTO product_images (sku_group, position, photo, alt) VALUES
  ('ci-earrings-hoop', 0, '/img/ci-a.png', 'gold hoop, front'),
  ('ci-earrings-hoop', 1, '/img/ci-b.png', 'gold hoop, side');

-- ── 2. single-variant, quirk 'cents', NO brand (missing-optional trap) ───────
INSERT INTO product_groups
  (sku_group, title, long_desc, page_url, brand_name, dept, serialize_quirk)
VALUES
  ('ci-top-floral', 'Floral Print Top',
   '<p>Lightweight cotton top with a small floral print.</p>',
   'https://example.test/products/ci-top-floral', NULL,
   'Tops', 'cents');

INSERT INTO options
  (sku, sku_group, size, colour, amount, currency, stock, photo, position, variation_id, in_stock)
VALUES
  ('CI-TOP-FLORAL__M__BLUE', 'ci-top-floral', 'M', 'Blue',
   2250.00, 'NPR', 4, '/img/ci-c.png', 0, 'var-ci-2001', TRUE);

INSERT INTO product_images (sku_group, position, photo, alt) VALUES
  ('ci-top-floral', 0, '/img/ci-c.png', 'floral top');

-- ── 3. quirk 'currency_string' ──────────────────────────────────────────────
INSERT INTO product_groups
  (sku_group, title, long_desc, page_url, brand_name, dept, serialize_quirk)
VALUES
  ('ci-bag-tote', 'Canvas Tote Bag',
   '<p>Roomy canvas tote with an inner pocket.</p>',
   'https://example.test/products/ci-bag-tote', 'Carry Co',
   'Bags', 'currency_string');

INSERT INTO options
  (sku, sku_group, size, colour, amount, currency, stock, photo, position, variation_id, in_stock)
VALUES
  ('CI-BAG-TOTE__NA__BEIGE', 'ci-bag-tote', NULL, 'Beige',
   1850.00, 'NPR', 5, '/img/ci-d.png', 0, 'var-ci-3001', TRUE),
  ('CI-BAG-TOTE__NA__BLACK', 'ci-bag-tote', NULL, 'Black',
   1850.00, 'NPR', 2, '/img/ci-d.png', 1, 'var-ci-3002', TRUE);

INSERT INTO product_images (sku_group, position, photo, alt) VALUES
  ('ci-bag-tote', 0, '/img/ci-d.png', 'canvas tote');

-- ── 4. quirk 'stock_text' — one variant sold out, serialized "out of stock" ──
INSERT INTO product_groups
  (sku_group, title, long_desc, page_url, brand_name, dept, serialize_quirk)
VALUES
  ('ci-shoes-flat', 'Everyday Flat Shoe',
   '<p>Soft-sole flats, cushioned insole.</p>',
   'https://example.test/products/ci-shoes-flat', 'Sole Mates',
   'Shoes', 'stock_text');

INSERT INTO options
  (sku, sku_group, size, colour, amount, currency, stock, photo, position, variation_id, in_stock)
VALUES
  ('CI-SHOES-FLAT__38__TAN', 'ci-shoes-flat', '38', 'Tan',
   3200.00, 'NPR', 6, '/img/ci-e.png', 0, 'var-ci-4001', TRUE),
  ('CI-SHOES-FLAT__39__TAN', 'ci-shoes-flat', '39', 'Tan',
   3200.00, 'NPR', 0, '/img/ci-e.png', 1, 'var-ci-4002', FALSE);

INSERT INTO product_images (sku_group, position, photo, alt) VALUES
  ('ci-shoes-flat', 0, '/img/ci-e.png', 'flat shoe');

-- ── 5. quirk 'array_options' — attrs:[{name,option}] instead of flat keys ────
INSERT INTO product_groups
  (sku_group, title, long_desc, page_url, brand_name, dept, serialize_quirk)
VALUES
  ('ci-scarf-silk', 'Printed Silk Scarf',
   '<p>Hand-rolled edges, <i>100% silk</i>.</p>',
   'https://example.test/products/ci-scarf-silk', 'Knot & Fold',
   'Accessories', 'array_options');

INSERT INTO options
  (sku, sku_group, size, colour, amount, currency, stock, photo, position, variation_id, in_stock)
VALUES
  ('CI-SCARF-SILK__S__RED',  'ci-scarf-silk', 'Small', 'Red',
   2750.00, 'NPR', 9, '/img/ci-f.png', 0, 'var-ci-5001', TRUE),
  ('CI-SCARF-SILK__L__RED',  'ci-scarf-silk', 'Large', 'Red',
   3100.00, 'NPR', 1, '/img/ci-f.png', 1, 'var-ci-5002', TRUE);

INSERT INTO product_images (sku_group, position, photo, alt) VALUES
  ('ci-scarf-silk', 0, '/img/ci-f.png', 'silk scarf');

-- ── 6. simple product — price/stock/photo at product level, NO options array ─
INSERT INTO product_groups
  (sku_group, title, long_desc, page_url, brand_name, dept, serialize_quirk,
   is_simple, base_amount, base_stock, base_photo)
VALUES
  ('ci-ring-simple', 'Thin Band Ring',
   '<p>Minimal stacking ring, one size.</p>',
   'https://example.test/products/ci-ring-simple', 'Hoops & Loops',
   'Rings', 'normal',
   TRUE, 1200.00, 3, '/img/ci-g.png');

INSERT INTO product_images (sku_group, position, photo, alt) VALUES
  ('ci-ring-simple', 0, '/img/ci-g.png', 'band ring');

-- ── 7. quirk 'broken_photo' — the §5 dead-image trap ────────────────────────
-- The stored photo is a REAL file; serialize.js swaps the first option's photo
-- for an unresolvable URL on the way out. That is the invariant this fixture
-- has to respect: the trap lives in serialization, never in the database, so
-- the storefront reads clean rows while the API still ships one dead link.
INSERT INTO product_groups
  (sku_group, title, long_desc, page_url, brand_name, dept, serialize_quirk)
VALUES
  ('ci-belt-woven', 'Woven Leather Belt',
   '<p>Braided leather belt with a brushed buckle.</p>',
   'https://example.test/products/ci-belt-woven', 'Carry Co',
   'Accessories', 'broken_photo');

INSERT INTO options
  (sku, sku_group, size, colour, amount, currency, stock, photo, position, variation_id, in_stock)
VALUES
  ('CI-BELT-WOVEN__M__BROWN', 'ci-belt-woven', 'M', 'Brown',
   1750.00, 'NPR', 4, '/img/ci-a.png', 0, 'var-ci-6001', TRUE),
  ('CI-BELT-WOVEN__L__BROWN', 'ci-belt-woven', 'L', 'Brown',
   1750.00, 'NPR', 2, '/img/ci-b.png', 1, 'var-ci-6002', TRUE);

INSERT INTO product_images (sku_group, position, photo, alt) VALUES
  ('ci-belt-woven', 0, '/img/ci-a.png', 'woven belt');

COMMIT;
