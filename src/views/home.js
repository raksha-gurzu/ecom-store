// Home / category / search view: a responsive product-card grid + pagination.
import { layout, esc, rs } from "./layout.js";

// products: rows with {sku_group,title,dept,photo,price,any_in_stock}
export function homeView({ products, page, totalPages, total, depts, active, q }) {
  const heading = q
    ? { title: `Search: “${q}”`, sub: `${total} result${total === 1 ? "" : "s"}` }
    : active
    ? { title: active, sub: `${total} product${total === 1 ? "" : "s"} in ${active}` }
    : { title: "All products", sub: `${total} products from meesa.shop` };

  const cards = products
    .map((p) => `
    <a class="card" href="/products/${encodeURIComponent(p.sku_group)}">
      <div class="imgwrap">
        ${p.any_in_stock ? "" : `<span class="badge-out">Out of stock</span>`}
        <img src="${esc(p.photo || "")}" alt="${esc(p.title)}" loading="lazy"
             onerror="this.style.visibility='hidden'">
      </div>
      <div class="body">
        <p class="t">${esc(p.title)}</p>
        <div class="meta"><span class="price">${rs(p.price)}</span><span class="dept">${esc(p.dept)}</span></div>
      </div>
    </a>`)
    .join("");

  const base = q ? `/?q=${encodeURIComponent(q)}&` : active ? `/category/${encodeURIComponent(active)}?` : "/?";
  const link = (n, label, cur = false) =>
    cur ? `<span class="cur">${label}</span>` : `<a href="${base}page=${n}">${label}</a>`;
  const pager = totalPages > 1
    ? `<div class="pager">
        ${page > 1 ? link(page - 1, "‹ Prev") : ""}
        <span class="info">Page ${page} of ${totalPages}</span>
        ${page < totalPages ? link(page + 1, "Next ›") : ""}
      </div>`
    : "";

  const body = `
    <p class="page-title">${esc(heading.title)}</p>
    <p class="page-sub">${esc(heading.sub)}</p>
    ${products.length ? `<div class="grid">${cards}</div>${pager}` : `<div class="empty">No products found.</div>`}`;

  return layout({ title: q ? `Search · ${q}` : active || "meesa — store", body, depts, active, q });
}
