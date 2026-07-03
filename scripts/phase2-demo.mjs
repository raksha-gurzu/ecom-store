// Phase-2 end-to-end demo + check.
//
// Prereqs (the script tells you if they're missing):
//   • app running on :4000 with GURZU_NOTIFY_URL pointing at the mock receiver
//   • mock receiver running:  npm run notify:receiver
//
// It drives create → update(content) → update(price) → delete through the manage
// endpoints, then asserts the receiver got 4 signed events with the right
// embedding-effect classification, plus that a FORGED signature is rejected.
import "dotenv/config";

const APP = (process.env.PUBLIC_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const RECEIVER = (process.env.GURZU_NOTIFY_URL || "http://localhost:8000/v1/integrations/custom-pull/notify")
  .replace(/\/v1\/.*$/, "");
const ADMIN = process.env.ADMIN_TOKEN || "merchant_demo_admin_token_def456";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  — " + extra : ""}`);
  cond ? pass++ : fail++;
};
const admin = { Authorization: `Bearer ${ADMIN}`, "content-type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jt(method, path, body, base = APP, headers = admin) {
  const res = await fetch(`${base}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

// Preflight.
try {
  const ev = await fetch(`${RECEIVER}/_events`);
  if (!ev.ok) throw new Error();
} catch {
  console.error(`✗ mock receiver not reachable at ${RECEIVER}. Start it:  npm run notify:receiver`);
  process.exit(2);
}
await fetch(`${RECEIVER}/_reset`, { method: "POST" });

const SG = "PHASE2-DEMO-PRODUCT";

// 1. create (with one option)
const created = await jt("POST", "/manage/products", {
  sku_group: SG, title: "Phase 2 Demo Top", dept: "demo", long_desc: "<p>demo</p>",
  options: [{ sku: `${SG}-1`, amount: 1000, stock: 5, size: "M", colour: "Blue" }],
});
ok("create product (201)", created.status === 201);

// 2. content update (title) → product.updated
const upd = await jt("PATCH", `/manage/products/${SG}`, { title: "Phase 2 Demo Top (v2)" });
ok("update product content (200)", upd.status === 200);

// 3. price-only update → variant.updated (no re-embed)
const price = await jt("PATCH", `/manage/options/${SG}-1`, { amount: 1200, stock: 9 });
ok("update option price/qty (200)", price.status === 200);

// 4. delete → product.deleted
const del = await jt("DELETE", `/manage/products/${SG}`);
ok("delete product (200)", del.status === 200);

// Give the fire-and-forget notifications a moment to land.
await sleep(400);

// Assert what the receiver saw.
const { json } = await jt("GET", "/_events", null, RECEIVER, {});
const got = (json?.events || []).filter((e) => e.id === SG || e.id === "?");
const byType = Object.fromEntries(got.map((e) => [e.type, e]));

ok("receiver got product.created", !!byType["product.created"],
   byType["product.created"]?.effect);
ok("receiver got product.updated (content)", !!byType["product.updated"],
   byType["product.updated"]?.effect);
ok("variant.updated classified as NO re-embed",
   byType["variant.updated"]?.effect?.includes("no re-embed"),
   byType["variant.updated"]?.effect);
ok("receiver got product.deleted", !!byType["product.deleted"],
   byType["product.deleted"]?.effect);

// Forged signature must be rejected (constant-time HMAC verify).
const forged = await fetch(RECEIVER + "/v1/integrations/custom-pull/notify", {
  method: "POST",
  headers: { "content-type": "application/json", "x-signature": "deadbeef" },
  body: JSON.stringify({ type: "product.deleted", external_product_id: "EVIL" }),
});
ok("forged signature rejected (401)", forged.status === 401);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
