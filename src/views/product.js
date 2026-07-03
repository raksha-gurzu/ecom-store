// Product detail: image gallery + live variant selector (colour/size → price,
// stock, and the main image swap). Variant data is embedded as JSON for store.js.
import { layout, esc, rs } from "./layout.js";

export function productView({ product, options, images, depts }) {
  const isSimple = product.is_simple || options.length === 0;

  // Gallery: product_images, else fall back to option photos / base photo.
  let gallery = images.map((i) => i.photo).filter(Boolean);
  if (!gallery.length) {
    const fromOpts = [...new Set(options.map((o) => o.photo).filter(Boolean))];
    gallery = fromOpts.length ? fromOpts : [product.base_photo].filter(Boolean);
  }
  const mainSrc = gallery[0] || "";

  const colours = [...new Set(options.map((o) => o.colour).filter(Boolean))];
  const sizes = [...new Set(options.map((o) => o.size).filter(Boolean))];

  // client-side variant model
  const variants = options.map((o) => ({
    colour: o.colour || null, size: o.size || null,
    amount: Number(o.amount), stock: Number(o.stock), in_stock: !!o.in_stock,
    photo: o.photo || mainSrc,
  }));
  const anyIn = isSimple ? Number(product.base_stock) > 0 : variants.some((v) => v.in_stock);
  const startPrice = isSimple ? Number(product.base_amount) : variants[0]?.amount ?? 0;
  const startStock = isSimple ? Number(product.base_stock || 0) : (variants.find((v) => v.in_stock)?.stock ?? 0);

  const thumbs = gallery
    .map((g, i) => `<div class="thumb ${i === 0 ? "active" : ""}" data-src="${esc(g)}">
        <img src="${esc(g)}" alt="" onerror="this.style.visibility='hidden'"></div>`)
    .join("");

  const swatchRow = (label, key, vals) => !vals.length ? "" : `
    <div class="opt-group" data-axis="${key}">
      <div class="opt-label">${label}</div>
      <div class="swatches">
        ${vals.map((v, i) => `<button type="button" class="swatch ${i === 0 ? "active" : ""}" data-val="${esc(v)}">${esc(v)}</button>`).join("")}
      </div>
    </div>`;

  const right = isSimple
    ? `
      ${product.brand_name ? `<div class="pd-brand">${esc(product.brand_name)}</div>` : ""}
      <h1 class="pd-title">${esc(product.title)}</h1>
      <div class="pd-price" id="pd-price">${rs(startPrice)}</div>
      <div class="pd-stock ${anyIn ? "in" : "out"}" id="pd-stock">${anyIn ? `In stock (${startStock})` : "Out of stock"}</div>
      <div class="buynote">Simple product — no variants. The connector synthesizes a single variant from these product-level fields.</div>`
    : `
      ${product.brand_name ? `<div class="pd-brand">${esc(product.brand_name)}</div>` : ""}
      <h1 class="pd-title">${esc(product.title)}</h1>
      <div class="pd-price" id="pd-price">${rs(startPrice)}</div>
      <div class="pd-stock ${anyIn ? "in" : "out"}" id="pd-stock">${anyIn ? `In stock (${startStock})` : "Out of stock"}</div>
      ${swatchRow("Colour", "colour", colours)}
      ${swatchRow("Size", "size", sizes)}`;

  const body = `
    <div class="crumbs"><a href="/">Home</a> › <a href="/category/${encodeURIComponent(product.dept)}">${esc(product.dept)}</a> › ${esc(product.title)}</div>
    <div class="pd">
      <div class="gallery">
        <div class="thumbs">${thumbs}</div>
        <div class="main-img"><img id="pd-main" src="${esc(mainSrc)}" alt="${esc(product.title)}" onerror="this.style.visibility='hidden'"></div>
      </div>
      <div class="pd-info">
        ${right}
        ${product.long_desc ? `<div class="pd-desc">${product.long_desc}</div>` : ""}
        <div class="pd-foot">
          id: <code>${esc(product.sku_group)}</code> ·
          <a href="${esc(product.page_url || "#")}" target="_blank" rel="noopener">View original on meesa.shop ↗</a>
        </div>
      </div>
    </div>
    <script id="pd-data" type="application/json">${JSON.stringify({ variants, isSimple }).replace(/</g, "\\u003c")}</script>`;

  return layout({ title: `${product.title} — meesa`, body, depts, active: product.dept });
}
