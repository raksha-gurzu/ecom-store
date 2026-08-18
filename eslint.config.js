// ESLint flat config.
//
// The goal is a net that catches real defects — a typo'd variable, an unused
// import left behind by a refactor, a React hook called conditionally — without
// arguing about style. Formatting is deliberately not enforced: this repo has no
// formatter and adding opinions nobody agreed to only creates noise in review.
//
//   npm run lint        report problems
//   npm run lint:fix    fix what can be fixed automatically
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    // Generated output and dependencies are never linted — dist/ and
    // public/bundle.js are build artifacts, and linting them reports errors
    // nobody can fix in source.
    ignores: ["node_modules/**", "dist/**", "public/bundle.js", "images/**", "seed/**", "ci-images/**"],
  },

  js.configs.recommended,

  // ── Server and scripts: Node, ES modules ──────────────────────────────────
  {
    files: ["src/**/*.js", "scripts/**/*.mjs", "scripts/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // Unused variables are usually a refactor that was not finished. Allow the
      // `_`-prefixed convention already used for deliberately ignored arguments
      // (Express error handlers need a 4-arity signature to be recognised).
      "no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
      }],
      "no-console": "off",          // these are CLI scripts and a server; logging is the point
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "warn",
    },
  },

  // ── UI components: browser + React, rendered on BOTH sides ────────────────
  {
    files: ["src/ui/**/*.jsx", "src/ui/**/*.js", "src/client/**/*.jsx"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^[A-Z_]" }],
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "warn",
    },
  },
];
