// Server-side rendering: React component → a complete HTML document.
//
// The flow for every storefront request:
//   1. the route queries the DB and builds a plain props object
//   2. renderToString() turns the page component into HTML
//   3. those SAME props are embedded as JSON in the page
//   4. the browser loads /bundle.js, reads the JSON, and hydrates
//
// Step 3 is what makes step 4 possible: React must re-render from identical
// input to attach to existing markup instead of replacing it. So props must be
// plain JSON — no Dates, no undefined, no DB row objects with methods.
//
// The shell loads NOTHING from a third party. This site is the merchant the
// GurzuVTO connector pulls FROM; it is not a GurzuVTO customer, so the storefront
// must not embed the try-on widget, a tenant key, or any other engine script.
// Adding one back would also mean shipping a credential in page source.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { pageComponent } from "../../dist/ui.js";

const DATA_ID = "__STOREFRONT_DATA__";

// Any "</script>" inside embedded JSON would close the tag early and inject
// markup, so the sequence is escaped. `<` alone is enough to make it inert.
const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

/**
 * Render a storefront page to a full HTML document.
 * @param {string} page   key in the page registry ("home" | "product")
 * @param {object} props  plain, JSON-serialisable props for that page
 */
export function renderPage(page, props) {
  const Component = pageComponent(page);
  const title = Component.documentTitle ? Component.documentTitle(props) : "meesa — store";
  const html = renderToString(createElement(Component, props));
  const data = safeJson({ page, props });

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='13' fill='%23e11d74'/></svg>">
<link rel="stylesheet" href="/store.css">
</head><body>
<div id="root">${html}</div>
<script id="${DATA_ID}" type="application/json">${data}</script>
<script src="/bundle.js" defer></script>
</body></html>`;
}

// Only used for the <title>, which sits outside the React tree.
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export { DATA_ID };
