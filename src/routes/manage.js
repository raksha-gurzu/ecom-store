// Management (admin) endpoints — mutate the merchant catalog.
//
// These are THIS PROJECT'S addition, not part of Gurzu's pull contract. They let
// you (or a script) run the store: create/update/delete products and options.
// They also set up Phase 2: each mutation is the natural place to later emit an
// HMAC-signed change notification to Gurzu (see notify() stub at the bottom).
//
// All routes require ADMIN_TOKEN (applied at the router mount) and write through
// the owner pool. Admin reads return the RAW DB shape (not the merchant wire
// shape) so you can see exactly what's stored.
import { Router } from "express";
import { pool } from "../db.js";
import { notifyAsync } from "../notify.js";
import { loadSerializedProduct, skuGroupForOption } from "../product-repo.js";

const router = Router();

// Emit a Phase-2 change notification with the product in the merchant's own shape.
// `type` ∈ product.created | product.updated | variant.updated (spec §8).
async function emit(type, skuGroup) {
  const product = await loadSerializedProduct(skuGroup);
  if (product) notifyAsync({ type, product });
}
const PER_PAGE = 50;

// ── list / read ─────────────────────────────────────────────────────────────
router.get("/products", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
    const { rows: c } = await pool.query("SELECT COUNT(*)::int n FROM product_groups");
    const { rows } = await pool.query(
      `SELECT pg.*, COALESCE(o.cnt, 0)::int AS option_count
         FROM product_groups pg
         LEFT JOIN (SELECT sku_group, COUNT(*) cnt FROM options GROUP BY sku_group) o
           ON o.sku_group = pg.sku_group
        ORDER BY pg.created_at, pg.sku_group
        LIMIT $1 OFFSET $2`,
      [PER_PAGE, (page - 1) * PER_PAGE]
    );
    res.json({ page, total: c[0].n, items: rows });
  } catch (err) { next(err); }
});

router.get("/products/:skuGroup", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM product_groups WHERE sku_group = $1", [req.params.skuGroup]
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    const { rows: opts } = await pool.query(
      "SELECT * FROM options WHERE sku_group = $1 ORDER BY position, sku",
      [req.params.skuGroup]
    );
    res.json({ ...rows[0], options: opts });
  } catch (err) { next(err); }
});

// ── create product (with optional inline options) ────────────────────────────
router.post("/products", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const b = req.body || {};
    if (!b.sku_group || !b.title || !b.dept) {
      return res.status(400).json({ error: "sku_group, title, dept are required" });
    }
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO product_groups
         (sku_group, title, long_desc, page_url, brand_name, dept, source_url,
          is_simple, base_amount, base_stock, base_photo, serialize_quirk)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,'normal'))`,
      [b.sku_group, b.title, b.long_desc ?? null, b.page_url ?? null,
       b.brand_name ?? null, b.dept, b.source_url ?? null, !!b.is_simple,
       b.base_amount ?? null, b.base_stock ?? null, b.base_photo ?? null,
       b.serialize_quirk ?? null]
    );
    for (const [i, o] of (b.options || []).entries()) {
      await client.query(
        `INSERT INTO options (sku, sku_group, size, colour, amount, currency, stock, photo, position)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,'NPR'),COALESCE($7,0),$8,$9)`,
        [o.sku, b.sku_group, o.size ?? null, o.colour ?? null, o.amount,
         o.currency ?? null, o.stock ?? null, o.photo ?? null, o.position ?? i]
      );
    }
    await client.query("COMMIT");
    await emit("product.created", b.sku_group); // Phase 2: created → engine embeds
    res.status(201).json({ ok: true, sku_group: b.sku_group });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") return res.status(409).json({ error: "already_exists" });
    next(err);
  } finally {
    client.release();
  }
});

// ── update product fields ────────────────────────────────────────────────────
const PRODUCT_FIELDS = ["title", "long_desc", "page_url", "brand_name", "dept",
  "is_simple", "base_amount", "base_stock", "base_photo", "serialize_quirk"];

router.patch("/products/:skuGroup", async (req, res, next) => {
  try {
    const sets = [], vals = [];
    for (const f of PRODUCT_FIELDS) {
      if (f in (req.body || {})) { vals.push(req.body[f]); sets.push(`${f} = $${vals.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: "no updatable fields" });
    vals.push(req.params.skuGroup);
    const { rowCount } = await pool.query(
      `UPDATE product_groups SET ${sets.join(", ")} WHERE sku_group = $${vals.length}`, vals
    );
    if (!rowCount) return res.status(404).json({ error: "not_found" });
    // Product-level edit = content change → engine re-NULLs embedding (spec §8).
    await emit("product.updated", req.params.skuGroup);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete("/products/:skuGroup", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM product_groups WHERE sku_group = $1", [req.params.skuGroup]
    );
    if (!rowCount) return res.status(404).json({ error: "not_found" });
    notifyAsync({ type: "product.deleted", external_product_id: req.params.skuGroup });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── option (variant) mutations ───────────────────────────────────────────────
router.post("/products/:skuGroup/options", async (req, res, next) => {
  try {
    const o = req.body || {};
    if (!o.sku || o.amount == null) return res.status(400).json({ error: "sku and amount required" });
    await pool.query(
      `INSERT INTO options (sku, sku_group, size, colour, amount, currency, stock, photo, position)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'NPR'),COALESCE($7,0),$8,COALESCE($9,0))`,
      [o.sku, req.params.skuGroup, o.size ?? null, o.colour ?? null, o.amount,
       o.currency ?? null, o.stock ?? null, o.photo ?? null, o.position ?? null]
    );
    await emit("product.updated", req.params.skuGroup); // new variant = structural change
    res.status(201).json({ ok: true, sku: o.sku });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "already_exists" });
    if (err.code === "23503") return res.status(404).json({ error: "product_not_found" });
    next(err);
  }
});

const OPTION_FIELDS = ["size", "colour", "amount", "currency", "stock", "photo", "position"];

router.patch("/options/:sku", async (req, res, next) => {
  try {
    const sets = [], vals = [];
    for (const f of OPTION_FIELDS) {
      if (f in (req.body || {})) { vals.push(req.body[f]); sets.push(`${f} = $${vals.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: "no updatable fields" });
    vals.push(req.params.sku);
    const { rowCount } = await pool.query(
      `UPDATE options SET ${sets.join(", ")} WHERE sku = $${vals.length}`, vals
    );
    if (!rowCount) return res.status(404).json({ error: "not_found" });

    // Embedding effect (spec §8): a pure price/quantity change skips re-embedding
    // (they're search filters, not vector inputs) → variant.updated. An image or
    // attribute change is content → product.updated (re-NULL the embedding).
    const touched = new Set(Object.keys(req.body || {}));
    const contentChange = ["photo", "size", "colour"].some((f) => touched.has(f));
    const skuGroup = await skuGroupForOption(req.params.sku);
    if (skuGroup) await emit(contentChange ? "product.updated" : "variant.updated", skuGroup);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete("/options/:sku", async (req, res, next) => {
  try {
    const skuGroup = await skuGroupForOption(req.params.sku);
    const { rowCount } = await pool.query("DELETE FROM options WHERE sku = $1", [req.params.sku]);
    if (!rowCount) return res.status(404).json({ error: "not_found" });
    if (skuGroup) await emit("product.updated", skuGroup); // removed variant = structural
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
