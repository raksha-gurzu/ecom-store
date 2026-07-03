// GET /api/catalog?page=N — the Phase-1 read endpoint Gurzu pulls from.
//
// Contract (spec §4.1 / §9):
//   • Bearer READ_TOKEN required (401 otherwise) — applied by the router mount.
//   • Paginated: returns `page`, `total_pages`, and an `items` array.
//   • Stable ids: sku_group + option.sku are stable across syncs (DB keys).
//   • Items are in the merchant's OWN shape (see serialize.js).
//   • Reads through the SELECT-only role (readonly pool).
import { Router } from "express";
import { readPool } from "../db.js";
import { serializeProduct } from "../serialize.js";

const PER_PAGE = 50;
const router = Router();

router.get("/catalog", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1);

    const { rows: countRows } = await readPool.query(
      "SELECT COUNT(*)::int AS n FROM product_groups"
    );
    const total = countRows[0].n;
    const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
    const offset = (page - 1) * PER_PAGE;

    // Page of products, deterministically ordered so pagination is stable.
    const { rows: products } = await readPool.query(
      `SELECT * FROM product_groups
        ORDER BY created_at, sku_group
        LIMIT $1 OFFSET $2`,
      [PER_PAGE, offset]
    );

    // Their options in one query, grouped in JS.
    const ids = products.map((p) => p.sku_group);
    let optionsByGroup = new Map();
    if (ids.length) {
      const { rows: opts } = await readPool.query(
        `SELECT * FROM options WHERE sku_group = ANY($1)
          ORDER BY sku_group, position, sku`,
        [ids]
      );
      for (const o of opts) {
        if (!optionsByGroup.has(o.sku_group)) optionsByGroup.set(o.sku_group, []);
        optionsByGroup.get(o.sku_group).push(o);
      }
    }

    const items = products.map((p) =>
      serializeProduct(p, optionsByGroup.get(p.sku_group) || [])
    );

    res.json({ page, total_pages: totalPages, total_items: total, items });
  } catch (err) {
    next(err);
  }
});

export default router;
