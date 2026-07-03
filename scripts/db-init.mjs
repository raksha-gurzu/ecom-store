// Apply db/schema.sql to the database. The docker `db` service runs this once on
// first init automatically; this script lets you (re)apply it by hand — it's
// idempotent (IF NOT EXISTS / DO blocks), so re-running is safe.
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sql = await fs.readFile(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
try {
  await pool.query(sql);
  console.log("[db:init] schema applied");
} catch (err) {
  console.error("[db:init] FAILED:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
