// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ Scrape meesa.shop → merchant catalog DB (v2).                              ║
// ║                                                                           ║
// ║ Per product: download the FULL image gallery, discover the REAL variant   ║
// ║ matrix + stock via /variation_stock, assign each colour a lead image,     ║
// ║ seed the §5 coercion traps, and upsert in the merchant's OWN shape.        ║
// ║ Idempotent (stable ids; options + images replaced wholesale per run).      ║
// ╚═══════════════════════════════════════════════════════════════════════════╝
import "dotenv/config";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";
import {
  collectCategorySlugs, parseProduct, fetchVariants, fetchBuffer, cleanText,
} from "./lib/meesa.mjs";
import { sniffImage, isUsable, IMAGE_EXTS } from "./lib/imagetype.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.resolve(__dirname, "..", "images");

// Deliberately NO innerwear/bras: this catalog is browsed by humans in demos,
// so lingerie is out. Their slots are filled by other meesa departments.
const CATEGORIES = [
  "clothing", "jewellery", "skincare", "bags", "footwear", "earrings",
  "crochet", "dresses", "kurta", "makeup", "sun-screen", "tops",
  "hair-care", "bodycare", "accessories", "others",
];
const CAP_PER_CATEGORY = 50;
const MAX_GALLERY = 8;          // images downloaded per product
const PRODUCT_CONCURRENCY = 6;

// ── utils ────────────────────────────────────────────────────────────────────
const hashInt = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const slugSafe = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

// URL-safe stem for IMAGE FILENAMES. meesa slugs are usually clean
// lowercase-hyphen, but some arrive percent-encoded / mixed-case (e.g.
// "kaftan%20Set"). Left raw, the file lands on disk with a literal "%20"/capital
// and the stored /img path decodes to a different, non-existent name → 404 for
// that consumer. Decode any %-encoding, lowercase, collapse non-alnum to hyphens.
// NOTE: the file stem only; sku_group stays the raw meesa slug (the stable id).
function fileSlug(slug) {
  let s = String(slug);
  try { s = decodeURIComponent(s); } catch { /* malformed %-escape: keep raw */ }
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "img";
}

function quirkFor(i, isSimple) {
  if (i % 17 === 5) return "cents";
  if (i % 17 === 11) return "currency_string";
  if (i % 13 === 7) return "stock_text";
  if (!isSimple && i % 19 === 3) return "array_options";
  return "normal";
}

async function mapPool(items, concurrency, fn) {
  const results = []; let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const my = idx++;
      try { results[my] = await fn(items[my], my); }
      catch (err) { results[my] = { error: String(err.message || err) }; }
    }
  });
  await Promise.all(workers);
  return results;
}

// Download the gallery; returns ordered local "/img/.." paths (cached on disk).
// Paths are stored RELATIVE so the host isn't frozen at scrape time — serialize.js
// and mc_photo() absolutize against PUBLIC_BASE_URL on the way out.
//
// The file extension comes from the BYTES, not from the Content-Type header:
// meesa serves some AVIF images as `image/jpeg`, and a mislabelled file decodes
// nowhere but the browser. Anything whose bytes aren't a recognisable, usable
// image is skipped — a product left with none is dropped by the caller.
async function downloadGallery(slug, urls) {
  const stem = fileSlug(slug); // URL-safe filename base, independent of the id
  const paths = [];
  for (let i = 0; i < Math.min(urls.length, MAX_GALLERY); i++) {
    try {
      const existing = IMAGE_EXTS.find((e) =>
        fssync.existsSync(path.join(IMAGES_DIR, `${stem}-${i}.${e}`)));
      if (existing) {
        // Cached — but an earlier run may have written it under a lying extension,
        // so re-verify the bytes rather than trusting the name.
        const cached = path.join(IMAGES_DIR, `${stem}-${i}.${existing}`);
        const real = sniffImage(await fs.readFile(cached));
        if (real === existing && isUsable(real)) { paths.push(`/img/${stem}-${i}.${existing}`); continue; }
        await fs.rm(cached, { force: true }); // wrong/undecodable → re-fetch below
      }
      const { buf } = await fetchBuffer(urls[i]);
      const kind = sniffImage(buf);
      if (!isUsable(kind) || buf.length < 512) continue; // not an image we can serve
      const file = `${stem}-${i}.${kind}`;
      await fs.writeFile(path.join(IMAGES_DIR, file), buf);
      paths.push(`/img/${file}`);
    } catch { /* degrade: skip this image */ }
  }
  return paths;
}

// Lead image for a colour: each distinct colour gets its own gallery photo.
function leadPhotoFn(colourOrder, photos) {
  return (colourClean) => {
    if (!photos.length) return null;
    if (!colourClean) return photos[0];
    const idx = colourOrder.indexOf(colourClean);
    return photos[(idx < 0 ? 0 : idx) % photos.length];
  };
}

// Build option rows from the REAL variant matrix (preferred).
function optionsFromReal(real, photos, price, currency) {
  const colourOrder = [...new Set(real.map((v) => cleanText(v.colour || "")).filter(Boolean))];
  const lead = leadPhotoFn(colourOrder, photos);
  const seen = new Set();
  const rows = [];
  real.forEach((v, pos) => {
    const colour = cleanText(v.colour || "") || null;
    const size = cleanText(v.size || "") || null;
    let sku = [slugSafe(v._slug), size ? slugSafe(size) : "NA", colour ? slugSafe(colour) : "NA"].join("__");
    while (seen.has(sku)) sku = `${sku}-${pos}`;
    seen.add(sku);
    rows.push({
      sku, size, colour, amount: price, currency,
      stock: v.stock, in_stock: v.in_stock, variation_id: v.variation_id,
      photo: lead(colour), position: pos,
    });
  });
  return rows;
}

// Fallback: cartesian product with synthesized stock (when meesa exposes no real
// variations for a product that still has option axes).
function optionsFromAxes(slug, coloursRaw, sizesRaw, photos, price, currency) {
  const colours = [...new Set(coloursRaw.map(cleanText).filter(Boolean))];
  const sizes = [...new Set(sizesRaw.map(cleanText).filter(Boolean))];
  const cs = colours.length ? colours : [null];
  const ss = sizes.length ? sizes : [null];
  const lead = leadPhotoFn(colours, photos);
  const seen = new Set();
  const rows = [];
  let pos = 0;
  for (const colour of cs) for (const size of ss) {
    let sku = [slugSafe(slug), size ? slugSafe(size) : "NA", colour ? slugSafe(colour) : "NA"].join("__");
    while (seen.has(sku)) sku = `${sku}-${pos}`;
    seen.add(sku);
    const stock = hashInt(sku) % 31;
    rows.push({ sku, size, colour, amount: price, currency, stock, in_stock: stock > 0, variation_id: null, photo: lead(colour), position: pos++ });
  }
  return rows;
}

async function upsertProduct(client, prod, options, images) {
  await client.query(
    `INSERT INTO product_groups
       (sku_group, title, long_desc, page_url, brand_name, dept, source_url,
        is_simple, base_amount, base_stock, base_photo, serialize_quirk, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     ON CONFLICT (sku_group) DO UPDATE SET
       title=EXCLUDED.title, long_desc=EXCLUDED.long_desc, page_url=EXCLUDED.page_url,
       brand_name=EXCLUDED.brand_name, dept=EXCLUDED.dept, source_url=EXCLUDED.source_url,
       is_simple=EXCLUDED.is_simple, base_amount=EXCLUDED.base_amount,
       base_stock=EXCLUDED.base_stock, base_photo=EXCLUDED.base_photo,
       serialize_quirk=EXCLUDED.serialize_quirk, updated_at=now()`,
    [prod.sku_group, prod.title, prod.long_desc, prod.page_url, prod.brand_name,
     prod.dept, prod.source_url, prod.is_simple, prod.base_amount, prod.base_stock,
     prod.base_photo, prod.serialize_quirk]
  );
  await client.query("DELETE FROM options WHERE sku_group = $1", [prod.sku_group]);
  for (const o of options) {
    await client.query(
      `INSERT INTO options (sku, sku_group, size, colour, amount, currency, stock, in_stock, variation_id, photo, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [o.sku, prod.sku_group, o.size, o.colour, o.amount, o.currency, o.stock,
       o.in_stock ?? (o.stock > 0), o.variation_id ?? null, o.photo, o.position]
    );
  }
  await client.query("DELETE FROM product_images WHERE sku_group = $1", [prod.sku_group]);
  for (let i = 0; i < images.length; i++) {
    await client.query(
      `INSERT INTO product_images (sku_group, position, photo, alt) VALUES ($1,$2,$3,$4)`,
      [prod.sku_group, i, images[i], prod.title]
    );
  }
}

async function main() {
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  console.log(`[scrape] categories: ${CATEGORIES.join(", ")}`);

  // 1. collect unique slugs
  const seen = new Set();
  const slugs = [];
  for (const cat of CATEGORIES) {
    const found = await collectCategorySlugs(cat, CAP_PER_CATEGORY);
    let added = 0;
    for (const s of found) if (!seen.has(s)) { seen.add(s); slugs.push(s); added++; }
    console.log(`[scrape] ${cat}: ${found.length} found, +${added} new (total ${slugs.length})`);
  }

  // 2. ONE pipeline per product: parse → download gallery IMMEDIATELY (meesa's
  //    signed image URLs expire in ~300s, so we must not batch downloads for
  //    later) → fetch the real variant matrix. Order matters: fresh URLs.
  console.log(`[scrape] processing ${slugs.length} products (parse + gallery + real variants)…`);
  let done = 0;
  const processed = await mapPool(slugs, PRODUCT_CONCURRENCY, async (slug) => {
    const p = await parseProduct(slug);
    if (!p || !p.name) return null;
    const photos = await downloadGallery(p.slug, p.gallery); // fresh signed URLs
    const hasAxes = p.colours.length > 0 || p.sizes.length > 0;
    let options = [], realVar = false;
    if (hasAxes) {
      const real = (await fetchVariants(p.slug, p.colours, p.sizes)).map((v) => ({ ...v, _slug: p.slug }));
      if (real.length) { options = optionsFromReal(real, photos, p.price, p.currency); realVar = true; }
      else options = optionsFromAxes(p.slug, p.colours, p.sizes, photos, p.price, p.currency);
    }
    if (++done % 25 === 0) console.log(`[scrape]   ${done}/${slugs.length} processed`);
    return { p, photos, options, realVar };
  });

  // 2b. A product whose images didn't scrape is NOT put in the store: a card with
  //     a dead thumbnail is worse than one product fewer, and the connector would
  //     ingest it text-only. Dropped here AND deleted from the DB below, so a
  //     re-scrape retires a product whose images have gone bad upstream.
  const usable = [], dropped = [];
  for (const r of processed) {
    if (!r || r.error) continue;
    (r.photos.length ? usable : dropped).push(r);
  }
  if (dropped.length) {
    console.log(`[scrape] dropping ${dropped.length} product(s) with no usable image:`);
    for (const r of dropped) console.log(`[scrape]   - ${r.p.slug}`);
  }

  // 3. assemble rows deterministically (quirks/traps by stable index, no races)
  const trapStats = {};
  let simpleCount = 0, realVariantProducts = 0;
  const rows = [];
  usable.forEach((r, i) => {
    const { p, photos } = r;
    const options = r.options;
    if (r.realVar) realVariantProducts++;
    const isSimple = options.length === 0;
    if (isSimple) simpleCount++;
    const quirk = quirkFor(i, isSimple);
    trapStats[quirk] = (trapStats[quirk] || 0) + 1;

    const product = {
      sku_group: p.slug,
      title: p.name,
      long_desc: p.description || `<p>${p.name}</p>`,
      page_url: p.page_url,
      brand_name: p.brand,
      dept: p.dept,
      source_url: p.source_url,
      is_simple: isSimple,
      base_amount: isSimple ? p.price : null,
      base_stock: isSimple ? (p.outOfStock ? 0 : hashInt(p.slug) % 31) : null,
      base_photo: isSimple ? (photos[0] || null) : null,
      serialize_quirk: quirk,
    };

    rows.push({ product, options, images: photos });
  });

  // 4. guarantee trap coverage
  for (const q of ["cents", "currency_string", "stock_text", "array_options"]) {
    if (trapStats[q]) continue;
    const victim = rows.find((r) => r.product.serialize_quirk === "normal" && (q !== "array_options" || r.options.length));
    if (victim) { victim.product.serialize_quirk = q; trapStats[q] = 1; }
  }
  // 4a. the stock_text trap only renders "out of stock" when a value is 0 — with
  // real stock that may never happen, so force one zero-stock stock_text item.
  const st = rows.find((r) => r.product.serialize_quirk === "stock_text" && (r.options.length || r.product.is_simple));
  if (st) {
    if (st.product.is_simple) st.product.base_stock = 0;
    else st.options[0] = { ...st.options[0], stock: 0, in_stock: false };
  }
  // 4b. guarantee simple products
  const SIMPLE_TARGET = 6;
  if (simpleCount < SIMPLE_TARGET) {
    const victims = rows.filter((r) => !r.product.is_simple && r.options.length).slice(0, SIMPLE_TARGET - simpleCount);
    victims.forEach((r, k) => {
      const first = r.options[0];
      r.product.is_simple = true;
      r.product.base_amount = first.amount;
      r.product.base_stock = first.stock;
      r.product.base_photo = first.photo;
      if (k === 0) r.product.serialize_quirk = "cents";
      r.options = [];
      simpleCount++;
    });
  }
  // 4c. guarantee a missing-optional field (drop brand on a deterministic slice)
  let brandDropped = 0;
  for (const r of rows) if (hashInt(r.product.sku_group) % 7 === 0) { r.product.brand_name = null; brandDropped++; }
  if (!brandDropped && rows.length) { rows[0].product.brand_name = null; }

  // 4d. the §5 broken-image trap. It lives in SERIALIZATION (a quirk), not in the
  //     DB: the spec wants the connector to meet one dead image URL, but the
  //     storefront reads the same rows and must not render a broken thumbnail.
  //     Applied to a product that carries no other trap, so coverage is unaffected.
  const brokenVictim = rows.find((r) => r.product.serialize_quirk === "normal" && r.options.length);
  if (brokenVictim) {
    brokenVictim.product.serialize_quirk = "broken_photo";
    trapStats.normal--;
    trapStats.broken_photo = 1;
  }

  // 5. persist
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const { product, options, images } of rows) await upsertProduct(client, product, options, images);
    // retire products dropped above (images no longer scrape) — cascades to
    // options + product_images, so nothing dangles.
    for (const r of dropped) {
      await client.query("DELETE FROM product_groups WHERE sku_group = $1", [r.p.slug]);
    }
    // Sweep any OTHER imageless product too: rows left by an earlier scrape whose
    // slug isn't in today's category set never pass through the check above, so
    // without this they'd sit in the store forever showing a dead thumbnail.
    //
    // SCRAPED ROWS ONLY (`source_url IS NOT NULL`). Products created through
    // /manage carry no source_url and no product_images row, so an unscoped sweep
    // would silently delete the admin's own catalog entries on the next scrape.
    const { rows: swept } = await client.query(
      `DELETE FROM product_groups pg
        WHERE pg.source_url IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.sku_group = pg.sku_group)
        RETURNING sku_group`
    );
    if (swept.length) {
      console.log(`[scrape] swept ${swept.length} stale imageless product(s): ${swept.map((r) => r.sku_group).join(", ")}`);
    }
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }

  const totalOptions = rows.reduce((n, r) => n + r.options.length, 0);
  const totalImages = rows.reduce((n, r) => n + r.images.length, 0);
  console.log(`\n[scrape] DONE`);
  console.log(`  products:                 ${rows.length}`);
  console.log(`  options (real variants):  ${totalOptions}  (${realVariantProducts} products had real variations)`);
  console.log(`  gallery images:           ${totalImages}`);
  console.log(`  simple (no-variant):      ${simpleCount}`);
  console.log(`  serialize quirks:         ${JSON.stringify(trapStats)}`);
  console.log(`  dropped (no usable image): ${dropped.length}`);
  console.log(`  broken-image trap:        ${brokenVictim ? `serialized on ${brokenVictim.product.sku_group}` : "none"}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("[scrape] FAILED:", err);
  await pool.end().catch(() => {});
  process.exit(1);
});
