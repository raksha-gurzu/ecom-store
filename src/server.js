// Test merchant site — Express entrypoint.
//
//   GET  /health                  liveness + DB check (no auth)
//   GET  /img/<file>              PUBLIC variant images (no auth, served first)
//   GET  /api/catalog?page=N      Phase-1 read endpoint (Bearer READ_TOKEN)
//   /manage/*                     admin CRUD (Bearer ADMIN_TOKEN)
//
// Image mount sits BEFORE the token guard so images stay public while the
// catalog stays protected (spec §5.4) — if images were gated, every download
// would fail and the catalog would fall back to text-only embeddings.
import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPool, closePools } from "./db.js";
import { requireReadToken, requireAdminToken } from "./middleware/auth.js";
import catalogRouter from "./routes/catalog.js";
import manageRouter from "./routes/manage.js";
import storeRouter from "./routes/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.resolve(__dirname, "..", "images");
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

// Static assets (no auth): storefront css/js + public product images.
app.use(express.static(PUBLIC_DIR, { maxAge: "1h" }));
app.use("/img", express.static(IMAGES_DIR, { fallthrough: true, maxAge: "1h" }));

// API-info page — the machine-facing endpoint reference (storefront now lives at /).
app.get("/api-info", async (_req, res) => {
  let products = "?";
  try {
    const { rows } = await readPool.query("SELECT COUNT(*)::int n FROM product_groups");
    products = rows[0].n;
  } catch { /* db not ready */ }
  const port = process.env.PORT || 4000;
  const token = process.env.READ_TOKEN || "merchant_demo_readonly_token_abc123";
  // EXTERNAL read-only connection string for OUTSIDE consumers (the engine).
  // NOT the app's own READONLY_DATABASE_URL — inside Docker that's `db:5432`,
  // which only resolves on the shop's compose network and is wrong to hand out.
  // Outside consumers reach the DB via the published host port (5433).
  const dbUrl = process.env.PUBLIC_DB_URL ||
    "postgres://gurzu_readonly:readonly_pw@localhost:5433/merchant_catalog";
  res
    .type("html")
    .send(`<!doctype html><meta charset="utf-8">
<title>Integration — Test Merchant Site</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;color:#222}
code{background:#f4f4f5;padding:2px 6px;border-radius:4px}h1{margin-bottom:4px}h2{margin-top:30px}
.muted{color:#666}a{color:#e11d74}table{border-collapse:collapse;margin:10px 0;width:100%}
td,th{padding:5px 12px 5px 0;vertical-align:top;text-align:left;border-bottom:1px solid #eee}
pre{background:#f7f7f8;padding:12px 14px;border-radius:8px;overflow:auto}
.card{border:1px solid #eee;border-radius:10px;padding:4px 18px 16px;margin:16px 0}</style>
<h1>Integrate with this merchant site</h1>
<p class="muted">Merchant-side test target for GurzuVTO's Custom Pull connector — <b>${products}</b> products. Two read-only ways to get the data.</p>
<p><a href="/" style="background:#e11d74;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">🛍️ Storefront</a></p>

<div class="card">
<h2>Way 1 — API (URL + key)</h2>
<table>
<tr><th>Base URL</th><td><code>http://localhost:${port}</code></td></tr>
<tr><th>Endpoint</th><td><code>GET /api/catalog?page=N</code> (paginated, 50/page)</td></tr>
<tr><th>Auth</th><td><code>Authorization: Bearer ${token}</code></td></tr>
<tr><th>Images</th><td><code>GET /img/&lt;file&gt;</code> — public, no token</td></tr>
</table>
<pre><code>curl -H "Authorization: Bearer ${token}" \\
  "http://localhost:${port}/api/catalog?page=1"</code></pre>
</div>

<div class="card">
<h2>Way 2 — direct database (read-only)</h2>
<p class="muted">Connect straight to Postgres and get the catalog from one query — <b>the same product JSON as the API above</b> (same fields + traps). Read-only — cannot write.</p>
<pre><code>${dbUrl}</code></pre>
<p>Clean JSON via the shipped views:</p>
<pre><code>SELECT product FROM catalog_json;            -- one JSON per product
SELECT jsonb_agg(product) FROM catalog_json; -- whole catalog
SELECT * FROM v_variants;                     -- flat rows (real variation_id + stock)</code></pre>
<p class="muted"><b>Host depends on where you connect from:</b></p>
<table>
<tr><th>From your laptop (engine on host)</th><td><code>localhost</code> : <code>5433</code> ← use this</td></tr>
<tr><th>From a separate Docker container</th><td><code>172.17.0.1</code> or <code>host.docker.internal</code> : <code>5433</code></td></tr>
<tr><th>Only inside THIS shop's compose net</th><td><code>db</code> : <code>5432</code> (don't hand this out)</td></tr>
</table>
<p class="muted">Image paths are relative (<code>/img/…</code>) — prefix with the base URL to download.</p>
</div>

<p class="muted">Admin CRUD: <code>/manage/*</code> (needs <code>Bearer &lt;ADMIN_TOKEN&gt;</code>). Health: <a href="/health">/health</a>. Full guide: <code>INTEGRATION.md</code> · <code>README.md</code>.</p>`);
});

// Health — confirms the read role can reach the DB.
app.get("/health", async (_req, res) => {
  try {
    const { rows } = await readPool.query("SELECT COUNT(*)::int n FROM product_groups");
    res.json({ status: "ok", products: rows[0].n });
  } catch (err) {
    res.status(503).json({ status: "degraded", error: String(err.message || err) });
  }
});

// Phase-1 catalog (read token) — the machine CONTRACT.
app.use("/api", requireReadToken, catalogRouter);

// Management (admin token).
app.use("/manage", requireAdminToken, manageRouter);

// Old storefront path → the storefront is now the homepage.
app.get("/browse", (_req, res) => res.redirect(301, "/"));

// Human-friendly storefront (no auth, read-only) — home, category, search, detail.
// Mounted last so the API/admin/static routes take precedence; storefront catches
// /, /category/:dept, /products/:skuGroup and nothing else.
app.use("/", storeRouter);

// Fallback 404 + error handler.
app.use((_req, res) => res.status(404).json({ error: "not_found" }));
app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(500).json({ error: "internal_error" });
});

const PORT = parseInt(process.env.PORT || "4000", 10);
const server = app.listen(PORT, () =>
  console.log(`test merchant site on http://localhost:${PORT}`)
);

// Graceful shutdown.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close(async () => {
      await closePools();
      process.exit(0);
    });
  });
}

export default app;
