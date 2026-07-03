// Load a product (+ its options) and render it in the merchant's own wire shape.
// Used by the manage routes to build Phase-2 notification payloads — Gurzu must
// receive the product in the SAME shape its locked mapping expects.
import { pool } from "./db.js";
import { serializeProduct } from "./serialize.js";

export async function loadSerializedProduct(skuGroup) {
  const { rows } = await pool.query(
    "SELECT * FROM product_groups WHERE sku_group = $1", [skuGroup]
  );
  if (!rows.length) return null;
  const { rows: opts } = await pool.query(
    "SELECT * FROM options WHERE sku_group = $1 ORDER BY position, sku", [skuGroup]
  );
  return serializeProduct(rows[0], opts);
}

// Given an option sku, find which product it belongs to (for variant.updated).
export async function skuGroupForOption(sku) {
  const { rows } = await pool.query(
    "SELECT sku_group FROM options WHERE sku = $1", [sku]
  );
  return rows.length ? rows[0].sku_group : null;
}
