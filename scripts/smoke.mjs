// Contract checker — verifies the running site against spec §9 (Phase 1).
// Run after `npm start` (or docker compose up) and a scrape.
//   BASE defaults to PUBLIC_BASE_URL/localhost:4000; READ_TOKEN from env.
import "dotenv/config";

const BASE = (process.env.PUBLIC_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const TOKEN = process.env.READ_TOKEN || "merchant_demo_readonly_token_abc123";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  — " + extra : ""}`);
  cond ? pass++ : fail++;
};

const auth = { Authorization: `Bearer ${TOKEN}` };

async function getJson(pathname, headers = {}) {
  const res = await fetch(`${BASE}${pathname}`, { headers });
  let body = null;
  try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body };
}

// 1. health
const health = await getJson("/health");
ok("health responds ok", health.status === 200 && health.body?.status === "ok",
   `products=${health.body?.products}`);

// 2. 401 without token
const noTok = await getJson("/api/catalog?page=1");
ok("catalog rejects missing token (401)", noTok.status === 401);

// 3. paginated catalog with token
const p1 = await getJson("/api/catalog?page=1", auth);
ok("catalog returns 200 with token", p1.status === 200);
ok("response has items[] + total_pages", Array.isArray(p1.body?.items) && p1.body?.total_pages >= 1,
   `total_pages=${p1.body?.total_pages}, total_items=${p1.body?.total_items}`);

// Pull the entire catalog across pages for the structural checks.
const all = [];
const totalPages = p1.body?.total_pages || 1;
for (let pg = 1; pg <= totalPages; pg++) {
  const r = await getJson(`/api/catalog?page=${pg}`, auth);
  all.push(...(r.body?.items || []));
}
ok("walked all pages", all.length > 0, `${all.length} products`);

// 4. merchant's OWN field names (not Gurzu's)
const sample = all[0] || {};
ok("items use merchant shape (sku_group/title/long_desc)",
   "sku_group" in sample && "title" in sample && "long_desc" in sample);

// 5. stable ids present
ok("every product has a stable sku_group", all.every((p) => !!p.sku_group));

// 6. required shapes present somewhere
const hasMultiVariant = all.some((p) => Array.isArray(p.options) && p.options.length > 1);
const hasSingleVariant = all.some((p) => Array.isArray(p.options) && p.options.length === 1);
const hasSimple = all.some((p) => !("options" in p));
ok("includes a multi-variant product", hasMultiVariant);
ok("includes a single-variant product", hasSingleVariant);
ok("includes a simple (no-options) product", hasSimple);

// 7. coercion traps present
const flat = JSON.stringify(all);
ok("trap: price_cents (cents integer) present", /"price_cents":\s*\d+/.test(flat));
ok('trap: currency string ("Rs.…") present', /"amount":\s*"Rs\./.test(flat));
ok('trap: stock as "out of stock" present', /"out of stock"/.test(flat));
ok("trap: array-form options (attrs[]) present", /"attrs":\s*\[/.test(flat));
ok("missing-optional: some products lack brand", all.some((p) => !("brand" in p)));
ok("HTML in descriptions", all.some((p) => /<p>/.test(p.long_desc || "")));

// 8. a public image resolves WITHOUT auth
const firstPhoto = (() => {
  for (const p of all) {
    if (p.photo && /^https?:/.test(p.photo) && !p.photo.includes("__broken__")) return p.photo;
    for (const o of p.options || []) if (o.photo && !o.photo.includes("__broken__")) return o.photo;
  }
  return null;
})();
if (firstPhoto) {
  const img = await fetch(firstPhoto);
  ok("variant image resolves without auth (200)", img.status === 200, firstPhoto);
} else {
  ok("variant image resolves without auth (200)", false, "no photo found");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
