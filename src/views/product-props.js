import { sanitizeHtml } from "./sanitize.js";

// Turn raw database rows into the plain props the Product page renders from.
//
// This lives on the server side on purpose. The component stays presentational,
// and the props it receives are the exact JSON embedded in the page for
// hydration — so anything derived here is computed once, not twice.
// Numbers are coerced here too: `pg` returns NUMERIC as a string, and shipping
// "1499.00" where the component expects 1499 would format the price wrong.
//
// This is also where merchant HTML is sanitised for the UI. It happens on the
// server, so the sanitised string is both what gets rendered AND what is embedded
// for hydration — the two sides stay identical, and the browser never sees the
// raw markup at all. The API is untouched and still ships the original.

/** @returns {{product, gallery: string[], variants: object[], isSimple: boolean}} */
export function productProps({ product, options, images }) {
  const isSimple = product.is_simple || options.length === 0;

  // Gallery: the real image gallery, falling back to option photos, then to the
  // simple product's own photo. A product with no images at all yields [].
  let gallery = images.map((i) => i.photo).filter(Boolean);
  if (!gallery.length) {
    const fromOptions = [...new Set(options.map((o) => o.photo).filter(Boolean))];
    gallery = fromOptions.length ? fromOptions : [product.base_photo].filter(Boolean);
  }
  const mainSrc = gallery[0] || "";

  const variants = options.map((o) => ({
    colour: o.colour || null,
    size: o.size || null,
    amount: Number(o.amount),
    stock: Number(o.stock),
    in_stock: !!o.in_stock,
    photo: o.photo || mainSrc,
  }));

  return {
    // Only the fields the page renders — not the whole row. Keeps the embedded
    // JSON small and avoids leaking columns the storefront has no business showing.
    product: {
      sku_group: product.sku_group,
      title: product.title,
      // Sanitised for rendering only — /api/catalog still serves the raw HTML.
      long_desc: sanitizeHtml(product.long_desc),
      page_url: product.page_url || null,
      dept: product.dept,
      brand_name: product.brand_name || null,
      base_amount: product.base_amount == null ? null : Number(product.base_amount),
      base_stock: product.base_stock == null ? null : Number(product.base_stock),
    },
    gallery,
    variants,
    isSimple,
  };
}
