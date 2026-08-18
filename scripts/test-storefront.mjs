// Storefront + security suite — the checks the other three suites don't cover.
//
//   scripts/smoke.mjs         the API contract (§9)
//   scripts/audit.mjs         data integrity in the database
//   scripts/test-endpoints.sh auth, admin CRUD, HTTP status codes
//   THIS FILE                 the rendered storefront: server-side rendering,
//                             hydration payload, escaping, and the traps that
//                             must NOT leak into the human UI
//
// Run against a running app:
//   npm run test:storefront                    (defaults to localhost:4000)
//   BASE=http://localhost:4300 npm run test:storefront
import "dotenv/config";

const BASE = (process.env.BASE || process.env.PUBLIC_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const READ_TOKEN = process.env.READ_TOKEN || "merchant_demo_readonly_token_abc123";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "merchant_demo_admin_token_def456";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  — " + extra : ""}`);
  cond ? pass++ : fail++;
};

const get = async (path, init) => {
  const res = await fetch(BASE + path, init);
  return { status: res.status, headers: res.headers, body: await res.text() };
};

// ── 1. every storefront route renders ───────────────────────────────────────
console.log("─── ROUTES ───");
const home = await get("/");
ok("home renders (200)", home.status === 200);

// Pull the WHOLE catalog, not just page 1: the product shapes this suite needs
// (simple, multi-variant, the broken-photo trap) are scattered through it, and
// selecting from one page silently skips checks when the shape isn't there.
const cat = { items: [], total_items: 0 };
for (let page = 1, pages = 1; page <= pages; page++) {
  const r = await (await fetch(`${BASE}/api/catalog?page=${page}`, {
    headers: { Authorization: `Bearer ${READ_TOKEN}` },
  })).json();
  pages = r.total_pages;
  cat.total_items = r.total_items;
  cat.items.push(...r.items);
}

const withOptions = cat.items.find((p) => Array.isArray(p.options) && p.options.length > 1);
const simple = cat.items.find((p) => !("options" in p));
const anyProduct = withOptions || cat.items[0];
const dept = anyProduct?.dept;

ok("catalog has products to test against", !!anyProduct, `${cat.total_items} products`);
// Fail loudly rather than skipping: a catalog without these shapes is itself a
// problem, and a skipped check reads like a passing one.
ok("catalog contains a simple (no-options) product", !!simple, simple?.sku_group ?? "NONE FOUND");
ok("catalog contains a multi-variant product", !!withOptions, withOptions?.sku_group ?? "NONE FOUND");

const detail = await get(`/products/${encodeURIComponent(anyProduct.sku_group)}`);
ok("product detail renders (200)", detail.status === 200, anyProduct.sku_group);

if (dept) {
  const c = await get(`/category/${encodeURIComponent(dept)}`);
  ok("category page renders (200)", c.status === 200, dept);
}

const search = await get("/?q=top");
ok("search renders (200)", search.status === 200);

const missing = await get("/products/definitely-not-a-real-product");
ok("unknown product → 404", missing.status === 404);

// ── 2. server-side rendering actually produced HTML ─────────────────────────
console.log("\n─── SERVER-SIDE RENDERING ───");
const rootContent = (html) => html.match(/<div id="root">([\s\S]*?)<script id=/)?.[1] ?? "";

ok("home ships rendered markup, not an empty shell",
   rootContent(home.body).length > 500, `${rootContent(home.body).length} chars inside #root`);
ok("home markup contains product cards", /class="card"/.test(home.body));
ok("detail markup contains the gallery", /class="gallery"/.test(detail.body));
ok("detail markup contains the title", detail.body.includes("pd-title"));

// The page must be usable before JavaScript runs — that is the whole point of
// rendering on the server. If the grid only appeared after hydration, this fails.
ok("product titles present in server HTML (works without JS)",
   rootContent(home.body).includes(cat.items[0].title.slice(0, 12)));

// ── 3. hydration contract ───────────────────────────────────────────────────
console.log("\n─── HYDRATION ───");
const payloadOf = (html) => {
  const m = html.match(/<script id="__STOREFRONT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return "INVALID"; }
};

const homeData = payloadOf(home.body);
const detailData = payloadOf(detail.body);
ok("home embeds a valid hydration payload", homeData && homeData !== "INVALID", `page="${homeData?.page}"`);
ok("detail embeds a valid hydration payload", detailData && detailData !== "INVALID", `page="${detailData?.page}"`);
ok("payload names the right page", homeData?.page === "home" && detailData?.page === "product");
ok("detail payload carries variants", Array.isArray(detailData?.props?.variants));
ok("payload has no undefined leaking through JSON", !/:\s*undefined/.test(JSON.stringify(detailData ?? {})));

const bundle = await get("/bundle.js");
ok("client bundle is served (200)", bundle.status === 200, `${bundle.body.length} bytes`);
ok("client bundle is JavaScript",
   /javascript/i.test(bundle.headers.get("content-type") || ""), bundle.headers.get("content-type"));
const css = await get("/store.css");
ok("stylesheet is served (200)", css.status === 200);

// ── 4. escaping and injection ───────────────────────────────────────────────
console.log("\n─── ESCAPING / INJECTION ───");
const xss = await get("/?q=" + encodeURIComponent('<script>alert(1)</script>'));
ok("search input is escaped, not executed", !xss.body.includes("<script>alert(1)</script>"));
ok("search page still renders (200)", xss.status === 200);

const sqli = await get("/?q=" + encodeURIComponent("' OR 1=1--"));
ok("SQL metacharacters in search are harmless", sqli.status === 200);

const sqliDept = await get("/category/" + encodeURIComponent("'; DROP TABLE product_groups;--"));
ok("SQL injection in category is parameterised away", [200, 404].includes(sqliDept.status));

const stillThere = await get("/health");
ok("database survived the injection attempts",
   JSON.parse(stillThere.body).status === "ok", stillThere.body);

for (const attack of ["/img/../package.json", "/img/..%2f..%2fpackage.json", "/img/%2e%2e/%2e%2e/package.json"]) {
  const r = await get(attack);
  ok(`path traversal blocked: ${attack}`, r.status === 404, `got ${r.status}`);
}

ok("x-powered-by header is not advertised", !home.headers.get("x-powered-by"));

// ── 5. pagination is bounded ────────────────────────────────────────────────
console.log("\n─── PAGINATION ───");
for (const q of ["?page=99999", "?page=-5", "?page=abc", "?page=1.5"]) {
  const r = await get("/" + q);
  ok(`storefront survives ${q}`, r.status === 200, `${r.status}`);
}

// ── 6. the traps must not leak into the human UI ────────────────────────────
// The catalog deliberately ships one dead image URL to exercise the connector's
// error handling. The storefront reads the same rows and must never render it —
// this is the invariant that keeps the trap in serialization, not in the data.
console.log("\n─── TRAPS STAY OUT OF THE STOREFRONT ───");
let apiHasBrokenTrap = false;
for (let page = 1, pages = 1; page <= pages; page++) {
  const r = await (await fetch(`${BASE}/api/catalog?page=${page}`, {
    headers: { Authorization: `Bearer ${READ_TOKEN}` },
  })).json();
  pages = r.total_pages;
  if (JSON.stringify(r.items).includes("__broken__")) apiHasBrokenTrap = true;
}
ok("API ships the broken-image trap", apiHasBrokenTrap);

let storefrontLeaks = false;
for (const p of cat.items.slice(0, 12)) {
  const r = await get(`/products/${encodeURIComponent(p.sku_group)}`);
  if (r.body.includes("__broken__")) { storefrontLeaks = true; break; }
}
ok("storefront never renders the broken-image URL", !storefrontLeaks);

if (simple) {
  const s = await get(`/products/${encodeURIComponent(simple.sku_group)}`);
  ok("simple product renders without a variant picker",
     s.status === 200 && s.body.includes("buynote") && !s.body.includes("opt-group"), simple.sku_group);
}

if (withOptions) {
  const v = await get(`/products/${encodeURIComponent(withOptions.sku_group)}`);
  ok("multi-variant product renders swatches", v.body.includes("swatch"), withOptions.sku_group);
}

// ── 7. errors say what actually went wrong ──────────────────────────────────
// A client mistake must not be reported as a server fault: a 500 tells the caller
// to retry something that can never succeed, and hides real faults in the noise.
console.log("\n─── ERROR HANDLING ───");
const adminJson = {
  "Authorization": `Bearer ${ADMIN_TOKEN}`,
  "Content-Type": "application/json",
};

const malformed = await get("/manage/products", { method: "POST", headers: adminJson, body: "{bad json" });
ok("malformed JSON body → 400, not 500", malformed.status === 400, `got ${malformed.status}`);

const huge = await get("/manage/products", {
  method: "POST", headers: adminJson, body: "a".repeat(3 * 1024 * 1024),
});
ok("oversized body → 413, not 500", huge.status === 413, `got ${huge.status}`);

// The form of an error follows what the caller asked for; the status never does.
const htmlHeaders = { Accept: "text/html" };
const html404 = await get("/definitely-not-a-route", { headers: htmlHeaders });
ok("browser gets an HTML 404 page",
   html404.status === 404 && /text\/html/.test(html404.headers.get("content-type") || ""),
   html404.headers.get("content-type"));
ok("that page is readable, not a JSON blob", /Page not found/.test(html404.body));

const json404 = await get("/definitely-not-a-route", { headers: { Accept: "application/json" } });
ok("API client gets a JSON 404",
   json404.status === 404 && /application\/json/.test(json404.headers.get("content-type") || ""));

// The machine contract must stay JSON no matter what the caller claims to accept.
const apiHtml404 = await get("/api/definitely-not-a-route", {
  headers: { ...htmlHeaders, Authorization: `Bearer ${READ_TOKEN}` },
});
ok("/api/* stays JSON even when HTML is requested",
   /application\/json/.test(apiHtml404.headers.get("content-type") || ""),
   apiHtml404.headers.get("content-type"));

const manageHtml404 = await get("/manage/definitely-not-a-route", {
  headers: { ...htmlHeaders, Authorization: `Bearer ${ADMIN_TOKEN}` },
});
ok("/manage/* stays JSON even when HTML is requested",
   /application\/json/.test(manageHtml404.headers.get("content-type") || ""));

// ── 8. auth edges ───────────────────────────────────────────────────────────
console.log("\n─── AUTH EDGES ───");
const authCases = [
  ["no token", {}, 401],
  ["wrong token", { Authorization: "Bearer wrong" }, 401],
  ["truncated token", { Authorization: `Bearer ${READ_TOKEN.slice(0, -1)}` }, 401],
  ["token with an extra character", { Authorization: `Bearer ${READ_TOKEN}x` }, 401],
  ["admin token on the read endpoint", { Authorization: `Bearer ${ADMIN_TOKEN}` }, 401],
  ["basic auth instead of bearer", { Authorization: "Basic dXNlcjpwYXNz" }, 401],
  ["correct token", { Authorization: `Bearer ${READ_TOKEN}` }, 200],
];
for (const [name, headers, expected] of authCases) {
  const r = await get("/api/catalog?page=1", { headers });
  ok(`catalog: ${name} → ${expected}`, r.status === expected, `got ${r.status}`);
}

// ── 9. stored XSS through merchant HTML ─────────────────────────────────────
// Product descriptions are real HTML and are injected into the page on purpose.
// That makes a scraped description an injection vector: nobody reviews what the
// upstream site publishes. The API must keep shipping the raw markup (the
// consumer is specified to sanitise it); the STOREFRONT must not execute it.
console.log("\n─── STORED XSS ───");
const probe = "XSS-REGRESSION-PROBE";
await get(`/manage/products/${probe}`, { method: "DELETE", headers: adminJson });
const created = await get("/manage/products", {
  method: "POST",
  headers: adminJson,
  body: JSON.stringify({
    sku_group: probe,
    title: "XSS regression probe",
    dept: "test",
    long_desc: '<p>safe copy</p><script>window.PWNED=1</script><img src=x onerror="window.PWNED=1">',
    options: [{ sku: `${probe}-1`, amount: 100, stock: 1 }],
  }),
});

if (created.status !== 201) {
  ok("could create the XSS probe product", false, `status ${created.status}`);
} else {
  const page = await get(`/products/${probe}`);
  ok("storefront does not render a <script> from a description",
     !/<script>window\.PWNED/i.test(page.body));
  ok("storefront does not render an inline event handler",
     !/onerror\s*=/i.test(page.body));
  ok("the legitimate part of the description survives", page.body.includes("safe copy"));

  // The contract is the other half of this: sanitising the UI must not sanitise
  // the API, or the connector stops being tested against realistic input.
  let apiRaw = null;
  for (let page2 = 1, pages = 1; page2 <= pages; page2++) {
    const r = await (await fetch(`${BASE}/api/catalog?page=${page2}`, {
      headers: { Authorization: `Bearer ${READ_TOKEN}` },
    })).json();
    pages = r.total_pages;
    const hit = r.items.find((i) => i.sku_group === probe);
    if (hit) apiRaw = hit.long_desc;
  }
  ok("API still ships the RAW merchant HTML (contract unchanged)",
     !!apiRaw && apiRaw.includes("<script>"), apiRaw ? "raw markup present" : "product missing from API");

  await get(`/manage/products/${probe}`, { method: "DELETE", headers: adminJson });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
