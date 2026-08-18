// Unit tests for the storefront's HTML sanitiser (src/views/sanitize.js).
//
// This is security code, so the cases below are adversarial rather than
// illustrative: each one is a real technique for smuggling script past a naive
// filter. It runs without a database or a server, so it belongs in the fast
// pre-commit path as well as CI.
//
//   npm run test:sanitize
import { sanitizeHtml } from "../src/views/sanitize.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  — " + extra : ""}`);
  cond ? pass++ : fail++;
};

// Nothing that could execute may survive, however it is dressed up.
const DANGEROUS = [
  ["plain script tag",            "<p>hi</p><script>alert(1)</script>"],
  ["uppercase SCRIPT",            "<SCRIPT>alert(1)</SCRIPT>"],
  ["mixed case ScRiPt",           "<ScRiPt>alert(1)</ScRiPt>"],
  ["script with attributes",      "<script type='text/javascript'>alert(1)</script>"],
  ["inline event handler",        "<img src=x onerror=alert(1)>"],
  ["event handler, quoted",       '<div onclick="alert(1)">click</div>'],
  ["event handler, spaced",       '<div on\tclick = "alert(1)">x</div>'],
  ["javascript: href",            '<a href="javascript:alert(1)">go</a>'],
  ["JaVaScRiPt: href",            '<a href="JaVaScRiPt:alert(1)">go</a>'],
  ["data: URL href",              '<a href="data:text/html;base64,PHNjcmlwdD4=">go</a>'],
  ["iframe",                      '<iframe src="//evil.test"></iframe>'],
  ["object embed",                '<object data="evil.swf"></object>'],
  ["style block",                 "<style>body{background:url('javascript:alert(1)')}</style>"],
  ["svg onload",                  '<svg onload="alert(1)"><circle /></svg>'],
  ["form + formaction",           '<form><button formaction="javascript:alert(1)">x</button></form>'],
  ["meta refresh",                '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
  ["conditional comment",         "<!--[if IE]><script>alert(1)</script><![endif]-->"],
  ["unclosed script",             "<script>alert(1)"],
  ["nested inside allowed tag",   "<p><script>alert(1)</script>text</p>"],
];

console.log("─── DANGEROUS INPUT ───");
for (const [name, input] of DANGEROUS) {
  const out = sanitizeHtml(input);
  const clean =
    !/<script/i.test(out) &&
    !/<iframe/i.test(out) &&
    !/<object/i.test(out) &&
    !/<style/i.test(out) &&
    !/<svg/i.test(out) &&
    !/\bon[a-z]+\s*=/i.test(out) &&
    !/javascript:/i.test(out) &&
    !/data:text\/html/i.test(out) &&
    !/formaction/i.test(out) &&
    !/http-equiv/i.test(out);
  ok(name, clean, clean ? "" : `LEAKED: ${out.slice(0, 90)}`);
}

// Legitimate merchant formatting must survive, or we have "fixed" the problem by
// destroying every product description.
console.log("\n─── LEGITIMATE CONTENT SURVIVES ───");
const keeps = [
  ["paragraph",        "<p>Soft cotton top.</p>",                    "<p>Soft cotton top.</p>"],
  ["bold and italic",  "<p><b>100%</b> <i>silk</i></p>",             "<p><b>100%</b> <i>silk</i></p>"],
  ["list",             "<ul><li>One</li><li>Two</li></ul>",          "<ul><li>One</li><li>Two</li></ul>"],
  ["heading",          "<h3>Care</h3>",                              "<h3>Care</h3>"],
  ["line break",       "Line<br>Break",                              "Line<br>Break"],
  ["table",            "<table><tr><td>S</td></tr></table>",         "<table><tr><td>S</td></tr></table>"],
];
for (const [name, input, expected] of keeps) {
  const out = sanitizeHtml(input);
  ok(name, out === expected, out === expected ? "" : `got: ${out}`);
}

const link = sanitizeHtml('<a href="https://meesa.shop/x" title="t" onclick="alert(1)">shop</a>');
ok("safe link keeps href, drops the handler",
   link.includes('href="https://meesa.shop/x"') && !/onclick/i.test(link), link);
ok("relative link is allowed", sanitizeHtml('<a href="/products/x">x</a>').includes('href="/products/x"'));
ok("text inside a dropped tag is preserved",
   sanitizeHtml("<marquee>still readable</marquee>") === "still readable",
   sanitizeHtml("<marquee>still readable</marquee>"));

console.log("\n─── EDGE CASES ───");
ok("empty input", sanitizeHtml("") === "");
ok("null input", sanitizeHtml(null) === "");
ok("undefined input", sanitizeHtml(undefined) === "");
ok("plain text passes through", sanitizeHtml("just words") === "just words");
ok("entities are left alone", sanitizeHtml("A &amp; B") === "A &amp; B");
ok("idempotent (sanitising twice changes nothing)",
   sanitizeHtml(sanitizeHtml("<p>x</p><script>y</script>")) === sanitizeHtml("<p>x</p><script>y</script>"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
