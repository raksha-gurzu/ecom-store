// Home / category / search results: heading, product grid, pager.
// Presentational only — the server has already run the query and paged it.
import Layout from "./Layout.jsx";
import { rs } from "./format.js";

// Hide an image that fails to load rather than showing a broken-image icon.
// The catalog carries one deliberately dead image URL, so this fires for real.
const hideOnError = (e) => {
  e.currentTarget.style.visibility = "hidden";
};

function ProductCard({ product }) {
  return (
    <a className="card" href={`/products/${encodeURIComponent(product.sku_group)}`}>
      <div className="imgwrap">
        {!product.any_in_stock && <span className="badge-out">Out of stock</span>}
        <img
          src={product.photo || ""}
          alt={product.title}
          loading="lazy"
          onError={hideOnError}
        />
      </div>
      <div className="body">
        <p className="t">{product.title}</p>
        <div className="meta">
          <span className="price">{rs(product.price)}</span>
          <span className="dept">{product.dept}</span>
        </div>
      </div>
    </a>
  );
}

function Pager({ page, totalPages, active, q }) {
  if (totalPages <= 1) return null;

  const base = q
    ? `/?q=${encodeURIComponent(q)}&`
    : active
    ? `/category/${encodeURIComponent(active)}?`
    : "/?";

  return (
    <div className="pager">
      {page > 1 && <a href={`${base}page=${page - 1}`}>‹ Prev</a>}
      <span className="info">
        Page {page} of {totalPages}
      </span>
      {page < totalPages && <a href={`${base}page=${page + 1}`}>Next ›</a>}
    </div>
  );
}

// Heading text depends on how the grid was reached: search, category, or all.
function heading({ q, active, total }) {
  if (q) {
    return { title: `Search: “${q}”`, sub: `${total} result${total === 1 ? "" : "s"}` };
  }
  if (active) {
    return {
      title: active,
      sub: `${total} product${total === 1 ? "" : "s"} in ${active}`,
    };
  }
  return { title: "All products", sub: `${total} products from meesa.shop` };
}

export default function Home({ products, page, totalPages, total, depts, active, q }) {
  const { title, sub } = heading({ q, active, total });

  return (
    <Layout depts={depts} active={active} q={q}>
      <p className="page-title">{title}</p>
      <p className="page-sub">{sub}</p>
      {products.length > 0 ? (
        <>
          <div className="grid">
            {products.map((p) => (
              <ProductCard key={p.sku_group} product={p} />
            ))}
          </div>
          <Pager page={page} totalPages={totalPages} active={active} q={q} />
        </>
      ) : (
        <div className="empty">No products found.</div>
      )}
    </Layout>
  );
}

// The browser tab title for this page, chosen server-side but derived here so
// the rule lives next to the view it describes.
Home.documentTitle = ({ q, active }) =>
  q ? `Search · ${q}` : active || "meesa — store";
