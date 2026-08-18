// Parsing + fetch helpers for scraping meesa.shop.
//
// meesa.shop is a Rails marketplace (not Shopify) — no products.json. We read:
//   • category listings  /products?category=<slug>  (page 1 = HTML;
//     page N>1 = a Turbo-Stream fragment requested with an Accept header)
//   • product detail      /products/<slug>           (JSON-LD + image gallery + option chips)
//   • variant stock       /products/<slug>/variation_stock?color=&size=
//       → REAL variation_id + "Available Stock: N". Combos with no variation_id
//         are not real variants. Colour only drives stock here — NOT images.
// Product images are signed Cloudflare R2 URLs that EXPIRE in ~300s, so they must
// be downloaded at scrape time and re-hosted — we can't store the signed URL.

const BASE = "https://meesa.shop";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── text cleaning ────────────────────────────────────────────────────────────
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
export function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])
    .replace(/\u00a0/g, " ");   // NBSP → plain space (invisible if written literally)
}
// collapse whitespace, trim; good for titles/brands/option values
export const cleanText = (s) => decodeEntities(s).replace(/\s+/g, " ").trim();
// tidy a raw description into safe-ish HTML paragraphs (preserve line breaks)
export function cleanDescription(raw) {
  const t = decodeEntities(raw).replace(/\r/g, "").trim();
  if (!t) return "";
  const paras = t.split(/\n{1,}/).map((p) => p.trim()).filter(Boolean);
  return paras.map((p) => `<p>${p}</p>`).join("");
}

// ── fetch ────────────────────────────────────────────────────────────────────
export async function fetchText(url, { headers = {}, retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: ctrl.signal });
      clearTimeout(t);
      if (res.status === 429) throw new Error("rate-limited (429)");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function fetchBuffer(url, { retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return { buf, type: res.headers.get("content-type") || "" };
    } catch (err) {
      lastErr = err;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

// ── category listing ─────────────────────────────────────────────────────────
export async function categoryPageSlugs(category, page) {
  const url = `${BASE}/products?category=${encodeURIComponent(category)}&page=${page}`;
  const headers = page > 1 ? { Accept: "text/vnd.turbo-stream.html" } : {};
  const html = await fetchText(url, { headers });
  const slugs = new Set();
  for (const m of html.matchAll(/href="\/products\/([^"/?#]+)"/g)) slugs.add(m[1]);
  return [...slugs];
}

export async function collectCategorySlugs(category, cap = 50, maxPages = 12) {
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= maxPages && out.length < cap; page++) {
    let slugs;
    try { slugs = await categoryPageSlugs(category, page); } catch { break; }
    if (!slugs.length) break;
    for (const s of slugs) {
      if (!seen.has(s)) { seen.add(s); out.push(s); }
      if (out.length >= cap) break;
    }
    await sleep(150);
  }
  return out;
}

// ── product detail parsing ───────────────────────────────────────────────────
function ldJsonBlocks(html) {
  const blocks = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { blocks.push(JSON.parse(m[1])); } catch { /* skip malformed */ }
  }
  return blocks;
}

// Raw option values for an axis (name="color"/"size"), preserving meesa's exact
// strings (incl. trailing spaces) — we need them verbatim to query variation_stock.
function rawOptionValues(html, name) {
  const vals = [];
  const re = new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]*)"`, "g");
  for (const m of html.matchAll(re)) {
    if (m[1] !== "" && !vals.includes(m[1])) vals.push(m[1]);
  }
  return vals;
}

// Ordered product gallery: every thumbnail's media-url, images only (skip video),
// deduped by URL path (signing query stripped for comparison).
function parseGallery(html, ldImage) {
  const out = [];
  const seenPath = new Set();
  const push = (url) => {
    const p = url.split("?")[0];
    if (!seenPath.has(p)) { seenPath.add(p); out.push(url); }
  };
  if (ldImage) push(ldImage);
  for (const m of html.matchAll(/data-media-type="(image|video)"[^>]*?data-media-url="([^"]+)"/g)) {
    // data-media-url is HTML-attribute-encoded: its query string has `&amp;`.
    // Decode it or the signed-URL signature breaks → HTTP 400 on download.
    if (m[1] === "image") push(decodeEntities(m[2]));
  }
  return out;
}

export async function parseProduct(slug) {
  const url = `${BASE}/products/${slug}`;
  const html = await fetchText(url);
  const blocks = ldJsonBlocks(html);

  const product = blocks.find((b) => b["@type"] === "Product");
  if (!product) return null;

  const crumbs = blocks.find((b) => b["@type"] === "BreadcrumbList");
  let dept = "Uncategorized";
  if (crumbs?.itemListElement?.length) {
    const items = crumbs.itemListElement;
    const cat = items[items.length - 2];
    if (cat?.name) dept = cleanText(cat.name);
  }

  const offers = product.offers || {};
  const price = Number(offers.price) || 0;
  const currency = offers.priceCurrency || "NPR";
  const outOfStock = /OutOfStock/i.test(offers.availability || "");

  return {
    slug,
    name: cleanText(product.name) || slug,
    description: cleanDescription(product.description),
    page_url: offers.url || url,
    source_url: url,
    brand: product.brand?.name ? cleanText(product.brand.name) : null,
    sku: product.sku ? String(product.sku) : null,
    dept,
    price,
    currency,
    outOfStock,
    colours: rawOptionValues(html, "color"), // raw, for variation_stock queries
    sizes: rawOptionValues(html, "size"),
    gallery: parseGallery(html, product.image),
  };
}

// ── real variant matrix via /variation_stock ─────────────────────────────────
function parseVariation(html) {
  const id = (html.match(/id="variation_id"[^>]*value="([^"]*)"/) || [])[1] || "";
  const avail = (html.match(/Available Stock:\s*(\d+)/i) || [])[1];
  const max = (html.match(/max="(\d+)"/) || [])[1];
  const canBuy = /can-purchase-value="true"/.test(html);
  const stock = avail != null ? parseInt(avail, 10) : max != null ? parseInt(max, 10) : canBuy ? 1 : 0;
  return { variation_id: id || null, stock, in_stock: canBuy };
}

async function fetchVariation(slug, colour, size) {
  const q = new URLSearchParams();
  if (colour != null) q.set("color", colour);
  if (size != null) q.set("size", size);
  const html = await fetchText(`${BASE}/products/${slug}/variation_stock?${q}`,
    { headers: { Accept: "text/vnd.turbo-stream.html" }, retries: 2 });
  return parseVariation(html);
}

// Discover the REAL variants. Returns rows keyed by raw colour/size with the real
// variation_id + stock. Only combos meesa actually has (variation_id present) are
// kept. `capCombos` guards against pathological colour×size explosions.
export async function fetchVariants(slug, colours, sizes, { capCombos = 40 } = {}) {
  const cs = colours.length ? colours : [null];
  const ss = sizes.length ? sizes : [null];
  if (cs.length === 1 && cs[0] === null && ss.length === 1 && ss[0] === null) return [];

  const combos = [];
  for (const c of cs) for (const s of ss) combos.push([c, s]);
  const limited = combos.slice(0, capCombos);

  const out = [];
  for (const [c, s] of limited) {
    try {
      const v = await fetchVariation(slug, c, s);
      if (v.variation_id) out.push({ colour: c, size: s, ...v });
    } catch { /* skip this combo on failure */ }
    await sleep(60);
  }
  return out;
}

export { BASE };
