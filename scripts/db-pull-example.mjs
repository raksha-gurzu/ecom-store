// Example: pull the catalog DIRECTLY from the merchant database via the read-only
// connection string — the "database integration" path, for tools/scripts/other
// consumers (the engine itself uses the API path).
//
// Any Postgres client works; this uses node-postgres. It connects read-only,
// reads clean JSON from the catalog_json view, and proves it cannot write.
//
//   npm run db:pull-example
import "dotenv/config";
import pg from "pg";

const CONN =
  process.env.READONLY_DATABASE_URL ||
  "postgres://gurzu_readonly:readonly_pw@localhost:5433/merchant_catalog";

const pool = new pg.Pool({ connectionString: CONN });

try {
  const { rows: [{ n }] } = await pool.query("SELECT COUNT(*)::int n FROM catalog_json");
  console.log(`✅ Connected (read-only). ${n} products available via catalog_json.\n`);

  // Clean JSON, in the merchant's own shape, straight from the DB — no API, no ORM.
  const { rows } = await pool.query(
    `SELECT product FROM catalog_json
      WHERE jsonb_array_length(product->'options') >= 2
      ORDER BY sku_group LIMIT 1`
  );
  console.log("Sample product (clean JSON from the DB):");
  console.log(JSON.stringify(rows[0].product, null, 2));

  // Flat rows are available too:
  const { rows: v } = await pool.query("SELECT sku, colour, size, stock, variation_id FROM v_variants LIMIT 3");
  console.log("\nSample variant rows (v_variants):");
  console.table(v);

  // Prove the connection is read-only.
  try {
    await pool.query("DELETE FROM product_groups");
    console.log("\n❌ WARNING: a write succeeded — the role is NOT read-only!");
  } catch (e) {
    console.log(`\n✅ Write correctly blocked: ${e.message}`);
  }
} catch (err) {
  console.error("Failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
