// Build the storefront UI. Produces two bundles from ONE set of components:
//
//   dist/ui.js         ESM, imported by the Express server to render HTML
//   public/bundle.js   IIFE, sent to the browser to hydrate that same HTML
//
// Both come from src/ui/*.jsx, which is what keeps the server output and the
// browser output identical — if they diverged, React would throw away the
// server HTML on hydration and the page would flicker.
//
// React itself is EXTERNAL in the server bundle (Node resolves it from
// node_modules) and BUNDLED into the client one (the browser has no resolver).
//
//   node scripts/build.mjs           one-off build
//   node scripts/build.mjs --watch   rebuild on change (development)
import { build, context } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");
const dev = watch || process.env.NODE_ENV === "development";

/** @type {import("esbuild").BuildOptions} */
const shared = {
  bundle: true,
  format: "esm",
  target: ["node20", "chrome100", "firefox100", "safari15"],
  jsx: "automatic",          // no `import React` needed in every component
  logLevel: "info",
  absWorkingDir: ROOT,
};

const serverBuild = {
  ...shared,
  entryPoints: ["src/ui/pages.js"],
  outfile: "dist/ui.js",
  platform: "node",
  external: ["react", "react-dom", "react/jsx-runtime"],
  minify: false,             // server output is never shipped; keep it readable
};

const clientBuild = {
  ...shared,
  entryPoints: ["src/client/entry.jsx"],
  outfile: "public/bundle.js",
  platform: "browser",
  format: "iife",
  minify: !dev,
  sourcemap: dev,
  define: { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production") },
};

if (watch) {
  const contexts = await Promise.all([context(serverBuild), context(clientBuild)]);
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("watching src/ui and src/client…");
} else {
  await Promise.all([build(serverBuild), build(clientBuild)]);
  console.log("✓ built dist/ui.js and public/bundle.js");
}
