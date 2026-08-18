// Sanitise merchant-authored HTML before the STOREFRONT renders it.
//
// Why this exists: product descriptions are real HTML from a third-party site,
// and the storefront injects them with dangerouslySetInnerHTML so formatting
// survives. Without this, a description containing <script> executes in every
// visitor's browser — stored XSS, with the payload arriving through a scrape
// nobody reviews.
//
// What it does NOT do: touch the API. `GET /api/catalog` still ships the raw
// merchant HTML, because that is the merchant's real data and the consumer is
// specified to sanitise it. This is the storefront cleaning its own render path,
// which is exactly the split principle 6 describes — clean for the UI, never
// reshape the contract.
//
// Approach: an ALLOWLIST. Anything not explicitly permitted is dropped. A
// denylist ("remove <script>") loses to the next encoding trick; an allowlist
// fails closed.

// Formatting tags a product description legitimately uses.
const ALLOWED_TAGS = new Set([
  "p", "br", "b", "strong", "i", "em", "u", "s", "small", "span", "div",
  "ul", "ol", "li", "dl", "dt", "dd",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tr", "td", "th",
  "blockquote", "pre", "code", "hr", "a",
]);

// Tags whose CONTENT must go too — dropping only the tag would leave the script
// body as visible text, or worse, as markup once re-parsed.
const DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math"];

// Per-tag attribute allowlist. Everything else (including every on* handler) is
// removed, so no event handler can survive.
const ALLOWED_ATTRS = { a: new Set(["href", "title", "target", "rel"]) };

const SAFE_URL = /^(https?:|mailto:|\/|#)/i;

export function sanitizeHtml(input) {
  if (!input) return "";
  let html = String(input);

  // 1. Remove dangerous elements together with their contents.
  for (const tag of DROP_WITH_CONTENT) {
    html = html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
    // ...and any unclosed leftover opening tag.
    html = html.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
  }

  // 2. Drop comments: they can hide conditional-comment script in old engines.
  html = html.replace(/<!--[\s\S]*?-->/g, "");

  // 3. Walk every remaining tag and keep only what is allowed.
  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g, (match, rawName, rawAttrs) => {
    const name = rawName.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return "";           // unknown tag: drop the tag, keep its text
    if (match.startsWith("</")) return `</${name}>`;   // closing tag needs no attributes

    const allowed = ALLOWED_ATTRS[name];
    if (!allowed) return `<${name}>`;                 // allowed tag, but no attributes permitted

    const kept = [];
    for (const attr of rawAttrs.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g)) {
      const key = attr[1].toLowerCase();
      if (!allowed.has(key)) continue;                // drops every on* handler
      const value = attr[2].replace(/^["']|["']$/g, "");
      // javascript:, data:, vbscript: URLs are how a plain <a> becomes an exploit.
      if (key === "href" && !SAFE_URL.test(value.trim())) continue;
      kept.push(`${key}="${value.replace(/"/g, "&quot;")}"`);
    }
    // Anything we link to opens in a new tab without handing it window.opener.
    if (name === "a" && kept.some((k) => k.startsWith("target="))) kept.push('rel="noopener noreferrer"');
    return `<${name}${kept.length ? " " + kept.join(" ") : ""}>`;
  });

  return html;
}
