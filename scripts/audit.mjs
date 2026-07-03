// Deep data-integrity audit of the REAL scraped catalog.
//
// Goes past the contract smoke test: validates the actual DB rows and that the
// images they reference exist on disk and are non-trivial. Reports every issue;
// exits non-zero if any hard failure is found.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

const IMAGES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "images");

let problems = 0, warnings = 0;
const fail = (m) => { console.log(`❌ ${m}`); problems++; };
const warn = (m) => { console.log(`⚠️  ${m}`); warnings++; };
const ok = (m) => console.log(`✅ ${m}`);

const { rows: products } = await pool.query("SELECT * FROM product_groups");
const { rows: options } = await pool.query("SELECT * FROM options");
const optsByGroup = new Map();
for (const o of options) {
  if (!optsByGroup.has(o.sku_group)) optsByGroup.set(o.sku_group, []);
  optsByGroup.get(o.sku_group).push(o);
}

console.log(`\n── Auditing ${products.length} products / ${options.length} options ──\n`);

// 1. required product fields
let emptyTitle = 0, emptyDept = 0, emptyDesc = 0;
for (const p of products) {
  if (!p.title?.trim()) emptyTitle++;
  if (!p.dept?.trim()) emptyDept++;
  if (!p.long_desc?.replace(/<[^>]+>/g, "").trim()) emptyDesc++;
}
emptyTitle ? fail(`${emptyTitle} products with empty title`) : ok("all products have a title");
emptyDept ? fail(`${emptyDept} products with empty dept`) : ok("all products have a dept (category)");
emptyDesc ? warn(`${emptyDesc} products have an effectively empty description`) : ok("all products have description text");

// 2. structural: non-simple has options; simple has base price
let noOpts = 0, simpleNoPrice = 0;
for (const p of products) {
  const opts = optsByGroup.get(p.sku_group) || [];
  if (!p.is_simple && opts.length === 0) noOpts++;
  if (p.is_simple && (p.base_amount == null)) simpleNoPrice++;
}
noOpts ? fail(`${noOpts} non-simple products have ZERO options`) : ok("every variable product has ≥1 option");
simpleNoPrice ? fail(`${simpleNoPrice} simple products missing base_amount`) : ok("every simple product has a base price");

// 3. value sanity: prices > 0, stock >= 0
const zeroPriceOpts = options.filter((o) => !(Number(o.amount) > 0));
const zeroPriceSimple = products.filter((p) => p.is_simple && !(Number(p.base_amount) > 0));
const badStock = options.filter((o) => Number(o.stock) < 0);
(zeroPriceOpts.length + zeroPriceSimple.length)
  ? warn(`${zeroPriceOpts.length + zeroPriceSimple.length} items have price 0 (meesa had no price)`)
  : ok("all prices are > 0");
badStock.length ? fail(`${badStock.length} options have negative stock`) : ok("no negative stock");

// 4. id stability/uniqueness
const dupSku = options.length - new Set(options.map((o) => o.sku)).size;
dupSku ? fail(`${dupSku} duplicate option skus`) : ok("all option skus unique");

// 5. images on disk — every referenced photo (except the deliberate broken one) must exist & be real
const referenced = new Set();
for (const o of options) if (o.photo) referenced.add(o.photo);
for (const p of products) if (p.base_photo) referenced.add(p.base_photo);
let missing = 0, tiny = 0, brokenTrap = 0, nullPhoto = 0;
for (const ref of referenced) {
  if (ref.includes("__broken__")) { brokenTrap++; continue; }
  // photos are stored absolute (http://host/img/x) or relative (/img/x) — map to disk
  const fname = ref.replace(/^https?:\/\/[^/]+/, "").replace(/^\/img\//, "");
  const file = path.join(IMAGES_DIR, fname);
  if (!fs.existsSync(file)) { missing++; continue; }
  if (fs.statSync(file).size < 512) tiny++;
}
const optNullPhoto = options.filter((o) => !o.photo).length;
nullPhoto = optNullPhoto;
missing ? fail(`${missing} referenced images MISSING from disk`) : ok(`all ${referenced.size} referenced images exist on disk`);
tiny ? fail(`${tiny} images are suspiciously small (<512B)`) : ok("no truncated images");
brokenTrap === 1 ? ok("exactly one broken-image trap present (expected)") : warn(`broken-image traps: ${brokenTrap} (expected 1)`);
nullPhoto ? warn(`${nullPhoto} options have no photo (degraded download — allowed)`) : ok("every option has a photo");

// 6. trap coverage in DB
const quirks = {};
for (const p of products) quirks[p.serialize_quirk] = (quirks[p.serialize_quirk] || 0) + 1;
for (const q of ["cents", "currency_string", "stock_text", "array_options"]) {
  quirks[q] ? ok(`trap '${q}': ${quirks[q]} products`) : fail(`trap '${q}' MISSING from data`);
}
products.some((p) => p.is_simple) ? ok(`simple products: ${products.filter((p) => p.is_simple).length}`) : fail("no simple products");
products.some((p) => !p.brand_name) ? ok(`missing-brand products: ${products.filter((p) => !p.brand_name).length}`) : fail("no missing-brand products");

// 6b. v2: gallery + real variants
const { rows: imgRows } = await pool.query("SELECT sku_group, COUNT(*)::int n FROM product_images GROUP BY sku_group");
const galleryByGroup = new Map(imgRows.map((r) => [r.sku_group, r.n]));
const withGallery = products.filter((p) => (galleryByGroup.get(p.sku_group) || 0) >= 1).length;
const multiImage = products.filter((p) => (galleryByGroup.get(p.sku_group) || 0) >= 2).length;
withGallery === products.length ? ok(`every product has a gallery (${imgRows.reduce((a, r) => a + r.n, 0)} images total)`)
  : warn(`${products.length - withGallery} products have no gallery images`);
multiImage > 0 ? ok(`${multiImage} products have a multi-image gallery (≥2)`) : warn("no multi-image galleries");

const realVar = options.filter((o) => o.variation_id).length;
realVar > 0 ? ok(`${realVar}/${options.length} options carry a REAL meesa variation_id`)
  : fail("no options have a real variation_id (variant fetch failed?)");
const inStock = options.filter((o) => o.in_stock).length;
ok(`stock realism: ${inStock}/${options.length} options in stock, ${options.length - inStock} out`);

// 7. category spread
const depts = {};
for (const p of products) depts[p.dept] = (depts[p.dept] || 0) + 1;
console.log(`\n  categories (${Object.keys(depts).length}): ` +
  Object.entries(depts).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d}:${n}`).join(", "));

console.log(`\n${problems} problems, ${warnings} warnings\n`);
await pool.end();
process.exit(problems ? 1 : 0);
