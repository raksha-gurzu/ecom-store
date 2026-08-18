// The human storefront — home grid, category, search, product detail.
// Reads via the read pool; no auth. Additive only — never touches the API contract.
import { Router } from "express";
import { readPool } from "../db.js";
import { renderPage } from "../views/render.js";
import { productProps } from "../views/product-props.js";

const router = Router();
const PER_PAGE = 24;

// Category pills for the nav (top depts by product count).
async function getDepts() {
  const { rows } = await readPool.query(
    `SELECT dept, COUNT(*)::int n FROM product_groups GROUP BY dept ORDER BY n DESC, dept LIMIT 14`
  );
  return rows;
}

// One representative card row per product (image, price, in-stock flag).
const CARD_SELECT = `
  SELECT pg.sku_group, pg.title, pg.dept,
    COALESCE(pg.base_photo,
      (SELECT photo FROM product_images pi WHERE pi.sku_group=pg.sku_group ORDER BY position LIMIT 1),
      (SELECT photo FROM options o WHERE o.sku_group=pg.sku_group AND o.photo IS NOT NULL ORDER BY position LIMIT 1)
    ) AS photo,
    COALESCE(pg.base_amount,
      (SELECT MIN(amount) FROM options o WHERE o.sku_group=pg.sku_group)) AS price,
    (CASE WHEN pg.is_simple THEN COALESCE(pg.base_stock,0) > 0
          ELSE EXISTS (SELECT 1 FROM options o WHERE o.sku_group=pg.sku_group AND o.in_stock) END) AS any_in_stock
  FROM product_groups pg`;

async function renderGrid(res, { where = "", params = [], page, depts, active = null, q = "" }) {
  const { rows: c } = await readPool.query(
    `SELECT COUNT(*)::int n FROM product_groups pg ${where}`, params);
  const total = c[0].n;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const pg = Math.min(Math.max(1, page), totalPages);
  const { rows: products } = await readPool.query(
    `${CARD_SELECT} ${where} ORDER BY pg.created_at, pg.sku_group LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, PER_PAGE, (pg - 1) * PER_PAGE]
  );
  res.type("html").send(
    renderPage("home", { products, page: pg, totalPages, total, depts, active, q })
  );
}

// Home + search (?q=)
router.get("/", async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || "1", 10) || 1;
    const q = (req.query.q || "").toString().trim();
    const depts = await getDepts();
    if (q) {
      return await renderGrid(res, {
        where: "WHERE pg.title ILIKE $1 OR pg.long_desc ILIKE $1 OR pg.dept ILIKE $1",
        params: [`%${q}%`], page, depts, q,
      });
    }
    await renderGrid(res, { page, depts });
  } catch (err) { next(err); }
});

// Category
router.get("/category/:dept", async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || "1", 10) || 1;
    const depts = await getDepts();
    await renderGrid(res, {
      where: "WHERE pg.dept = $1", params: [req.params.dept], page, depts, active: req.params.dept,
    });
  } catch (err) { next(err); }
});

// Product detail
router.get("/products/:skuGroup", async (req, res, next) => {
  try {
    const { rows } = await readPool.query(
      "SELECT * FROM product_groups WHERE sku_group=$1", [req.params.skuGroup]);
    if (!rows.length) {
      const depts = await getDepts();
      return res.status(404).type("html").send(
        renderPage("home", {
          products: [], page: 1, totalPages: 1, total: 0, depts, active: null, q: "",
        })
      );
    }
    const [opts, imgs, depts] = await Promise.all([
      readPool.query("SELECT * FROM options WHERE sku_group=$1 ORDER BY position, sku", [req.params.skuGroup]),
      readPool.query("SELECT * FROM product_images WHERE sku_group=$1 ORDER BY position", [req.params.skuGroup]),
      getDepts(),
    ]);
    const props = productProps({ product: rows[0], options: opts.rows, images: imgs.rows });
    res.type("html").send(renderPage("product", { ...props, depts }));
  } catch (err) { next(err); }
});

export default router;
