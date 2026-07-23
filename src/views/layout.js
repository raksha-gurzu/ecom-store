// Shared HTML shell for the storefront: header (logo + search), category nav, footer.
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const rs = (n) => (n == null ? "—" : `Rs. ${Number(n).toLocaleString("en-IN")}`);

// GurzuVTO try-on panel — additive UI, off unless BOTH env vars are set, so a
// fresh clone with no key renders the plain store instead of failing on 401.
// The key is publishable + origin-locked (safe in page source); it lives in
// .env (gitignored), never in .env.example.
function tryOnBlock() {
  const apiBase = process.env.GURZU_API_BASE;
  const publishableKey = process.env.GURZU_PUBLISHABLE_KEY;
  if (!apiBase || !publishableKey) return { head: "", tail: "" };
  // JSON island — same handoff pattern as #pd-data. </ is escaped so a stray
  // "</script>" inside a value can't close the tag early.
  const cfg = JSON.stringify({ apiBase, publishableKey }).replace(/</g, "\\u003c");
  return {
    head: `<link rel="stylesheet" href="/tryon.css">`,
    tail: `<button id="gvto-launch" type="button" aria-label="Open search and try-on">✨ Search &amp; Try-On</button>
<script type="application/json" id="gvto-config">${cfg}</script>
<script src="/tryon.js" defer></script>`,
  };
}

// depts: [{dept, n}], active: current dept slug/name or null, q: search string
export function layout({ title, body, depts = [], active = null, q = "" }) {
  const tryOn = tryOnBlock();
  const pills = depts
    .map((d) => {
      const on = active && active.toLowerCase() === d.dept.toLowerCase();
      return `<a class="pill ${on ? "active" : ""}" href="/category/${encodeURIComponent(d.dept)}">${esc(d.dept)}</a>`;
    })
    .join("");

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='13' fill='%23e11d74'/></svg>">
<link rel="stylesheet" href="/store.css">
${tryOn.head}
</head><body>
<header class="hdr">
  <div class="hdr-top">
    <a class="logo" href="/"><span class="dot"></span>meesa</a>
    <span class="tagline">Nepal's marketplace for women's products</span>
    <form class="search" method="get" action="/">
      <span class="ico">⌕</span>
      <input name="q" value="${esc(q)}" placeholder="Search products…" autocomplete="off" aria-label="Search">
    </form>
    <nav class="hdr-right">
      <a href="/">Home</a>
      <a href="/api-info">API</a>
    </nav>
  </div>
  <div class="nav"><div class="nav-inner">
    <a class="pill ${active ? "" : "active"}" href="/">All</a>${pills}
  </div></div>
</header>
<main class="wrap">${body}</main>
<footer class="foot"><div class="foot-inner">
  <span>Test merchant store · data scraped from <a href="https://meesa.shop" target="_blank" rel="noopener">meesa.shop</a></span>
  <span>Machine API: <a href="/api-info">/api/catalog</a> (token-gated)</span>
</div></footer>
<script src="/store.js" defer></script>
${tryOn.tail}
</body></html>`;
}
