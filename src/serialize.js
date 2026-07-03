// Render DB rows into the MERCHANT'S OWN JSON shape.
//
// This is where the catalog deliberately stops looking like GurzuVTO's schema
// and where the §5 coercion "traps" are injected per-product via serialize_quirk.
// The DB stays clean and typed; the wire format is what's messy — exactly like a
// real merchant whose API happens to serialize prices/stock in odd conventions.

// price as a 2dp string, e.g. 1999 -> "1999.00"
const money = (n) => Number(n).toFixed(2);

// Photos are stored relative (e.g. "/img/x.jpg"); the catalog must hand Gurzu a
// fully-qualified URL it can download without auth. Absolutize against
// PUBLIC_BASE_URL at serialize time so the stored value stays host-independent.
function publicPhoto(photo) {
  if (!photo) return null;
  if (/^https?:\/\//i.test(photo)) return photo; // already absolute (e.g. a broken-url trap)
  const base = (process.env.PUBLIC_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
  return `${base}${photo.startsWith("/") ? "" : "/"}${photo}`;
}

// Build the price representation for a given quirk.
// Returns an object to spread into the variant/product (key name varies on purpose).
function priceShape(amount, currency, quirk) {
  switch (quirk) {
    case "cents":
      // integer cents, no currency, no nested object → cents->amount coercion trap
      return { price_cents: Math.round(Number(amount) * 100) };
    case "currency_string":
      // currency baked into the string → strip-and-parse trap
      return { cost: { amount: `Rs.${money(amount)}`, currency } };
    default: // 'normal', 'stock_text', 'array_options'
      return { cost: { amount: money(amount), currency } };
  }
}

// Build the stock representation for a given quirk.
function stockShape(stock, quirk) {
  if (quirk === "stock_text") {
    return { stock: Number(stock) > 0 ? `${stock} in stock` : "out of stock" };
  }
  return { stock: Number(stock) };
}

// One option (variant) in the merchant's shape.
function serializeOption(opt, quirk) {
  const base = {
    sku: opt.sku,
    ...priceShape(opt.amount, opt.currency, quirk),
    ...stockShape(opt.stock, quirk),
    photo: publicPhoto(opt.photo),
  };

  if (quirk === "array_options") {
    // array form: attrs:[{name,option}] instead of flat size/colour keys
    const attrs = [];
    if (opt.size) attrs.push({ name: "Size", option: opt.size });
    if (opt.colour) attrs.push({ name: "Color", option: opt.colour });
    return { ...base, attrs };
  }

  // flat form (the common case)
  const flat = {};
  if (opt.size != null) flat.size = opt.size;
  if (opt.colour != null) flat.colour = opt.colour;
  return { ...base, ...flat };
}

// One product (product_group) plus its options, in the merchant's shape.
// `product` is a product_groups row; `options` is its options rows (may be []).
export function serializeProduct(product, options) {
  const quirk = product.serialize_quirk || "normal";

  const out = {
    sku_group: product.sku_group,
    title: product.title,
    long_desc: product.long_desc || "",
    page_url: product.page_url || null,
    dept: product.dept,
  };

  // optional fields — omitted entirely when absent (missing-optional trap)
  if (product.brand_name) out.brand = { name: product.brand_name };

  if (product.is_simple) {
    // Simple product: price/stock/photo live at the PRODUCT level, no options
    // array. The engine synthesizes a single variant from these (spec §6.3).
    Object.assign(
      out,
      priceShape(product.base_amount, "NPR", quirk),
      stockShape(product.base_stock ?? 0, quirk),
      { photo: publicPhoto(product.base_photo) }
    );
  } else {
    out.options = options.map((o) => serializeOption(o, quirk));
  }

  return out;
}
