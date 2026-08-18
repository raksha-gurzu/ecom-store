// Repository structure and hygiene check.
//
// Documentation and layout rot silently. Nothing tells you a doc now describes
// a file that moved, that a secret got committed, or that a build artifact is
// tracked in git — until it costs someone an afternoon. This makes those
// failures loud and cheap, on every commit and every push.
//
// It checks four things:
//   1. the folder structure the project claims to have still exists
//   2. no secrets or generated files are tracked in git
//   3. every npm script points at a file that exists
//   4. documentation references real paths, and every doc has an owner
//
//   npm run check:repo
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let problems = 0, warnings = 0;
const fail = (m) => { console.log(`❌ ${m}`); problems++; };
const warn = (m) => { console.log(`⚠️  ${m}`); warnings++; };
const ok = (m) => console.log(`✅ ${m}`);

const exists = (p) => fs.existsSync(path.join(ROOT, p));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const tracked = execSync("git ls-files", { cwd: ROOT }).toString().split("\n").filter(Boolean);

// ── 1. structure ────────────────────────────────────────────────────────────
// Each entry is a directory the project's own documentation promises, with the
// role it plays. If one disappears, the docs describing it are now fiction.
console.log("─── STRUCTURE ───");
const STRUCTURE = {
  "src": "application code",
  "src/routes": "HTTP route handlers",
  "src/ui": "React components (rendered on both server and client)",
  "src/views": "server-side rendering and props builders",
  "src/client": "browser entry point",
  "src/middleware": "auth guards",
  "db": "schema and fixtures",
  "docs": "written documentation",
  "scripts": "operational and test scripts",
  "public": "static assets served as-is",
  ".github/workflows": "CI pipelines",
};
for (const [dir, role] of Object.entries(STRUCTURE)) {
  exists(dir) ? ok(`${dir}/ — ${role}`) : fail(`missing directory ${dir}/ (${role})`);
}

// ── 2. nothing secret or generated is tracked ───────────────────────────────
console.log("\n─── GIT HYGIENE ───");
const MUST_NOT_TRACK = [
  { pattern: /^\.env$/, why: "real secrets" },
  { pattern: /^dist\//, why: "build output" },
  { pattern: /^public\/bundle\.js$/, why: "build output" },
  { pattern: /^node_modules\//, why: "dependencies" },
  { pattern: /^seed\//, why: "catalog snapshots (hundreds of MB)" },
  { pattern: /^images\/(?!\.gitkeep)/, why: "scraped images (hundreds of MB)" },
];
let dirty = 0;
for (const file of tracked) {
  for (const { pattern, why } of MUST_NOT_TRACK) {
    if (pattern.test(file)) { fail(`${file} is tracked in git but must not be (${why})`); dirty++; }
  }
}
if (!dirty) ok("no secrets, dependencies or build output tracked in git");

// A committed .env is the highest-cost mistake here, so check it explicitly.
exists(".env.example")
  ? ok(".env.example exists so a fresh clone knows what to set")
  : fail("no .env.example — a new engineer cannot tell which variables are required");

// ── 3. npm scripts point at real files ──────────────────────────────────────
console.log("\n─── NPM SCRIPTS ───");
const pkg = JSON.parse(read("package.json"));
let broken = 0;
for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
  const m = cmd.match(/(?:node|bash)\s+(\S+\.(?:mjs|js|sh))/);
  if (m && !exists(m[1])) { fail(`npm run ${name} → ${m[1]} does not exist`); broken++; }
}
if (!broken) ok(`all ${Object.keys(pkg.scripts ?? {}).length} npm scripts point at files that exist`);

// ── 4. documentation ────────────────────────────────────────────────────────
console.log("\n─── DOCUMENTATION ───");
const REQUIRED_DOCS = {
  "README.md": "the front door — what this is and how to run it",
  "CLAUDE.md": "working agreements for AI agents in this repo",
  "DEPLOY.md": "how DevOps hosts it",
  "INTEGRATION.md": "how a consumer connects to the catalog",
  "TEST-MERCHANT-SITE.md": "the specification this project implements",
  "docs/README.md": "documentation index — which doc answers which question",
};
for (const [doc, role] of Object.entries(REQUIRED_DOCS)) {
  exists(doc) ? ok(`${doc} — ${role}`) : fail(`missing ${doc} (${role})`);
}

// Every PATH a doc mentions in backticks must exist. This is the check that
// catches "we renamed the file and forgot the docs" the day it happens.
//
// Severity is deliberately split, because the two cases are not equally certain:
//   • `src/ui/Product.jsx` — an explicit path. If it does not resolve it is
//     wrong, full stop. That is an error.
//   • `Product.jsx` — shorthand. Fine if a file by that name exists anywhere.
//     If nothing matches it is usually an outside concept (Shopify's
//     `products.json`), so it is a warning, not a build failure.
const docFiles = tracked.filter((f) => f.endsWith(".md"));
// Names come from the working tree, not just from git: a file added in this
// very commit is not tracked yet, and warning about it would train people to
// ignore this check on exactly the commits that introduce new files.
const basenames = new Set(tracked.map((f) => path.basename(f)));
(function walk(dir) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (/^(node_modules|\.git|dist|images|seed|ci-images)$/.test(entry.name)) continue;
    if (entry.isDirectory()) walk(child);
    else basenames.add(entry.name);
  }
})(".");
let deadRefs = 0, looseRefs = 0;
const IGNORE_REF = /^(https?:|#|\.\.\.|\/img\/|\/api|\/manage|\/products|\/category|\/health|\/browse|\/store|\/bundle)/;
for (const doc of docFiles) {
  const text = read(doc);
  for (const m of text.matchAll(/`([a-zA-Z0-9_./-]+\.(?:js|mjs|jsx|sql|sh|yml|yaml|json|md|css))`/g)) {
    const ref = m[1];
    if (IGNORE_REF.test(ref) || ref.includes("*")) continue;
    // Resolve relative to the repo root, then relative to the doc's own folder.
    if (exists(ref) || exists(path.join(path.dirname(doc), ref))) continue;
    if (ref.includes("/")) {
      fail(`${doc} references \`${ref}\`, which does not exist`);
      deadRefs++;
    } else if (!basenames.has(ref)) {
      warn(`${doc} mentions \`${ref}\` — no file by that name in the repo (external concept?)`);
      looseRefs++;
    }
  }
}
if (!deadRefs) {
  ok(`every explicit file path across ${docFiles.length} markdown files resolves` +
     (looseRefs ? ` (${looseRefs} bare filenames unmatched — see warnings)` : ""));
}

// Docs under docs/ carry frontmatter naming an owner and a review date, so a
// stale page has someone to ask rather than being nobody's problem.
if (exists("docs")) {
  // Read from disk, not from git: a page added in this commit is untracked, and
  // checking only tracked files would let brand-new docs skip the contract.
  const pages = [];
  (function collect(dir) {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(child);
      else if (entry.name.endsWith(".md")) pages.push(child);
    }
  })("docs");
  let missingMeta = 0;
  for (const page of pages) {
    const text = read(page);
    if (!/^---[\s\S]*?owner:/m.test(text) || !/^---[\s\S]*?reviewed:/m.test(text)) {
      warn(`${page} has no owner/reviewed frontmatter`);
      missingMeta++;
    }
  }
  if (!missingMeta && pages.length) ok(`all ${pages.length} pages under docs/ declare an owner and review date`);
}

console.log(`\n${problems} problems, ${warnings} warnings`);
process.exit(problems ? 1 : 0);
