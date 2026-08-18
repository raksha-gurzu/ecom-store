// The two integration paths must agree, and the store must never show a bad image.
//
// Everything here guards an invariant that had no test before, and each one has
// already caught a real bug:
//   • catalog_json (SQL) vs GET /api/catalog (serialize.js) — the view broke BOTH
//     options of a product when two shared the lowest `position`, while the API
//     broke one. CLAUDE.md promises these return the SAME JSON.
//   • the broken-image trap must reach the API but never the DB or the storefront.
//   • every referenced image must actually be served, as an image.
//
// Needs the app running (BASE) and DB access. Run: npm run test:parity
import "dotenv/config";
import { readPool } from "../src/db.js";

const BASE = (process.env.BASE || "http://localhost:4000").replace(/\/$/, "");
const TOKEN = process.env.READ_TOKEN || "merchant_demo_readonly_token_abc123";

let pass = 0, fail = 0;
const ok = (m, x = "") => { console.log(`✅ ${m}${x ? "  — " + x : ""}`); pass++; };
const no = (m, x = "") => { console.log(`❌ ${m}${x ? "  — " + x : ""}`); fail++; };
const t = (cond, m, x) => (cond ? ok(m, x) : no(m, x));

// Key order differs between jsonb and JS objects; compare by sorted structure.
const stable = (v) => Array.isArray(v) ? v.map(stable)
  : (v && typeof v === "object")
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]))
    : v;
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

console.log("\n─── API ↔ catalog_json PARITY ───");
const api = new Map();
let page = 1, pages = 1;
do {
  const res = await fetch(`${BASE}/api/catalog?page=${page}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) { no(`catalog page ${page} responded ${res.status}`); break; }
  const body = await res.json();
  pages = body.total_pages;
  for (const item of body.items) api.set(item.sku_group, item);
  page++;
} while (page <= pages);

const { rows: viewRows } = await readPool.query("SELECT sku_group, product FROM catalog_json");
t(api.size === viewRows.length, "both paths expose the same product count", `api=${api.size} view=${viewRows.length}`);

const differing = [];
for (const row of viewRows) {
  const fromApi = api.get(row.sku_group);
  if (!fromApi || !same(fromApi, row.product)) differing.push(row.sku_group);
}
t(differing.length === 0, `all ${viewRows.length} products are byte-identical across both paths`,
  differing.slice(0, 3).join(", "));

// The image base is duplicated in mc_photo() — drift means the two paths hand out
// different URLs for the same photo.
const { rows: [{ p: sqlPhoto }] } = await readPool.query("SELECT mc_photo('/img/probe.jpg') AS p");
const expected = `${(process.env.PUBLIC_BASE_URL || BASE).replace(/\/$/, "")}/img/probe.jpg`;
t(sqlPhoto === expected, "mc_photo() base matches PUBLIC_BASE_URL", `${sqlPhoto} vs ${expected}`);

console.log("\n─── THE BROKEN-IMAGE TRAP ───");
const { rows: stored } = await readPool.query(`
  SELECT sku_group FROM options        WHERE photo      LIKE '%__broken__%'
  UNION SELECT sku_group FROM product_groups WHERE base_photo LIKE '%__broken__%'
  UNION SELECT sku_group FROM product_images WHERE photo      LIKE '%__broken__%'`);
t(stored.length === 0, "no broken URL is stored in the database (it is serialized)",
  stored.map((r) => r.sku_group).join(", "));

const { rows: trapRows } = await readPool.query(
  "SELECT sku_group FROM product_groups WHERE serialize_quirk = 'broken_photo'");
t(trapRows.length === 1, "exactly one product carries the broken_photo quirk", String(trapRows.length));

const apiBroken = JSON.stringify([...api.values()]).match(/__broken__/g) || [];
const viewBroken = JSON.stringify(viewRows.map((r) => r.product)).match(/__broken__/g) || [];
t(apiBroken.length === 1, "the API ships exactly one broken image URL", String(apiBroken.length));
t(viewBroken.length === 1, "the DB view ships exactly one broken image URL", String(viewBroken.length));
t((await fetch(`${BASE}/img/__broken__.jpg`)).status === 404, "the trap URL genuinely 404s");

if (trapRows.length === 1) {
  const html = await (await fetch(`${BASE}/products/${encodeURIComponent(trapRows[0].sku_group)}`)).text();
  t(!html.includes("__broken__"), "the trap product's storefront page shows its real photo", trapRows[0].sku_group);
}

console.log("\n─── IMAGES ───");
const { rows: noImages } = await readPool.query(`
  SELECT sku_group FROM product_groups pg
   WHERE NOT EXISTS (SELECT 1 FROM product_images i WHERE i.sku_group = pg.sku_group)`);
t(noImages.length === 0, "no product is in the store without images",
  noImages.map((r) => r.sku_group).slice(0, 5).join(", "));

const { rows: refRows } = await readPool.query(`
  SELECT photo FROM product_images
  UNION SELECT photo FROM options WHERE photo IS NOT NULL
  UNION SELECT base_photo FROM product_groups WHERE base_photo IS NOT NULL`);
const refs = [...new Set(refRows.map((r) => r.photo))].filter((p) => !p.includes("__broken__"));
const notServed = [], notImage = [];
for (let i = 0; i < refs.length; i += 40) {
  await Promise.all(refs.slice(i, i + 40).map(async (p) => {
    const res = await fetch(p.startsWith("http") ? p : BASE + p, { method: "HEAD" });
    const type = res.headers.get("content-type") || "";
    if (res.status !== 200) notServed.push(`${p} → ${res.status}`);
    else if (!type.startsWith("image/")) notImage.push(`${p} → ${type}`);
  }));
}
t(notServed.length === 0, `all ${refs.length} referenced images are served over HTTP`, notServed.slice(0, 3).join(", "));
t(notImage.length === 0, "every served image carries an image/* content-type", notImage.slice(0, 3).join(", "));

console.log("\n─── CATALOG CONTENT ───");
const { rows: lingerie } = await readPool.query(`
  SELECT dept, title FROM product_groups
   WHERE dept IN ('Bras','Panties','Lingerie Sets','Silicon Pad')
      OR title ~* '(^|[^a-z])(bra|bras|panty|panties|thong|lingerie|bralette)([^a-z]|$)'`);
t(lingerie.length === 0, "no bras or panties in the catalog",
  lingerie.map((r) => `${r.dept}: ${r.title}`).slice(0, 3).join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
await readPool.end();
process.exit(fail ? 1 : 0);
