// Two Postgres pools, mirroring how a real merchant separates concerns:
//   pool      — owner role; used by the scraper and the manage (write) endpoints.
//   readPool  — SELECT-only `gurzu_readonly` role; used by the catalog endpoint
//               that Gurzu pulls from. It physically cannot write (spec §4.1).
import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://merchant:merchant_pw@localhost:5432/merchant_catalog",
});

export const readPool = new Pool({
  connectionString:
    process.env.READONLY_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgres://gurzu_readonly:readonly_pw@localhost:5432/merchant_catalog",
});

// Small helper so callers can `await query(...)` without grabbing a client.
export const query = (text, params, { readonly = false } = {}) =>
  (readonly ? readPool : pool).query(text, params);

export async function closePools() {
  await Promise.allSettled([pool.end(), readPool.end()]);
}
