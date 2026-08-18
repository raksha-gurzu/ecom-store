// src/ui/Layout.jsx
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function CategoryPills({ depts, active }) {
  return /* @__PURE__ */ jsx("div", { className: "nav", children: /* @__PURE__ */ jsxs("div", { className: "nav-inner", children: [
    /* @__PURE__ */ jsx("a", { className: `pill ${active ? "" : "active"}`, href: "/", children: "All" }),
    depts.map((d) => {
      const on = active && active.toLowerCase() === d.dept.toLowerCase();
      return /* @__PURE__ */ jsx(
        "a",
        {
          className: `pill ${on ? "active" : ""}`,
          href: `/category/${encodeURIComponent(d.dept)}`,
          children: d.dept
        },
        d.dept
      );
    })
  ] }) });
}
function Header({ depts, active, q }) {
  return /* @__PURE__ */ jsxs("header", { className: "hdr", children: [
    /* @__PURE__ */ jsxs("div", { className: "hdr-top", children: [
      /* @__PURE__ */ jsxs("a", { className: "logo", href: "/", children: [
        /* @__PURE__ */ jsx("span", { className: "dot" }),
        "meesa"
      ] }),
      /* @__PURE__ */ jsx("span", { className: "tagline", children: "Nepal's marketplace for women's products" }),
      /* @__PURE__ */ jsxs("form", { className: "search", method: "get", action: "/", children: [
        /* @__PURE__ */ jsx("span", { className: "ico", children: "\u2315" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            name: "q",
            defaultValue: q,
            placeholder: "Search products\u2026",
            autoComplete: "off",
            "aria-label": "Search"
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("nav", { className: "hdr-right", children: [
        /* @__PURE__ */ jsx("a", { href: "/", children: "Home" }),
        /* @__PURE__ */ jsx("a", { href: "/api-info", children: "API" })
      ] })
    ] }),
    /* @__PURE__ */ jsx(CategoryPills, { depts, active })
  ] });
}
function Footer() {
  return /* @__PURE__ */ jsx("footer", { className: "foot", children: /* @__PURE__ */ jsxs("div", { className: "foot-inner", children: [
    /* @__PURE__ */ jsxs("span", { children: [
      "Test merchant store \xB7 data scraped from",
      " ",
      /* @__PURE__ */ jsx("a", { href: "https://meesa.shop", target: "_blank", rel: "noopener noreferrer", children: "meesa.shop" })
    ] }),
    /* @__PURE__ */ jsxs("span", { children: [
      "Machine API: ",
      /* @__PURE__ */ jsx("a", { href: "/api-info", children: "/api/catalog" }),
      " (token-gated)"
    ] })
  ] }) });
}
function Layout({ depts = [], active = null, q = "", children }) {
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(Header, { depts, active, q }),
    /* @__PURE__ */ jsx("main", { className: "wrap", children }),
    /* @__PURE__ */ jsx(Footer, {})
  ] });
}

// src/ui/format.js
var rs = (n) => n == null ? "\u2014" : `Rs. ${Number(n).toLocaleString("en-IN")}`;

// src/ui/Home.jsx
import { Fragment as Fragment2, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var hideOnError = (e) => {
  e.currentTarget.style.visibility = "hidden";
};
function ProductCard({ product }) {
  return /* @__PURE__ */ jsxs2("a", { className: "card", href: `/products/${encodeURIComponent(product.sku_group)}`, children: [
    /* @__PURE__ */ jsxs2("div", { className: "imgwrap", children: [
      !product.any_in_stock && /* @__PURE__ */ jsx2("span", { className: "badge-out", children: "Out of stock" }),
      /* @__PURE__ */ jsx2(
        "img",
        {
          src: product.photo || "",
          alt: product.title,
          loading: "lazy",
          onError: hideOnError
        }
      )
    ] }),
    /* @__PURE__ */ jsxs2("div", { className: "body", children: [
      /* @__PURE__ */ jsx2("p", { className: "t", children: product.title }),
      /* @__PURE__ */ jsxs2("div", { className: "meta", children: [
        /* @__PURE__ */ jsx2("span", { className: "price", children: rs(product.price) }),
        /* @__PURE__ */ jsx2("span", { className: "dept", children: product.dept })
      ] })
    ] })
  ] });
}
function Pager({ page, totalPages, active, q }) {
  if (totalPages <= 1) return null;
  const base = q ? `/?q=${encodeURIComponent(q)}&` : active ? `/category/${encodeURIComponent(active)}?` : "/?";
  return /* @__PURE__ */ jsxs2("div", { className: "pager", children: [
    page > 1 && /* @__PURE__ */ jsx2("a", { href: `${base}page=${page - 1}`, children: "\u2039 Prev" }),
    /* @__PURE__ */ jsxs2("span", { className: "info", children: [
      "Page ",
      page,
      " of ",
      totalPages
    ] }),
    page < totalPages && /* @__PURE__ */ jsx2("a", { href: `${base}page=${page + 1}`, children: "Next \u203A" })
  ] });
}
function heading({ q, active, total }) {
  if (q) {
    return { title: `Search: \u201C${q}\u201D`, sub: `${total} result${total === 1 ? "" : "s"}` };
  }
  if (active) {
    return {
      title: active,
      sub: `${total} product${total === 1 ? "" : "s"} in ${active}`
    };
  }
  return { title: "All products", sub: `${total} products from meesa.shop` };
}
function Home({ products, page, totalPages, total, depts, active, q }) {
  const { title, sub } = heading({ q, active, total });
  return /* @__PURE__ */ jsxs2(Layout, { depts, active, q, children: [
    /* @__PURE__ */ jsx2("p", { className: "page-title", children: title }),
    /* @__PURE__ */ jsx2("p", { className: "page-sub", children: sub }),
    products.length > 0 ? /* @__PURE__ */ jsxs2(Fragment2, { children: [
      /* @__PURE__ */ jsx2("div", { className: "grid", children: products.map((p) => /* @__PURE__ */ jsx2(ProductCard, { product: p }, p.sku_group)) }),
      /* @__PURE__ */ jsx2(Pager, { page, totalPages, active, q })
    ] }) : /* @__PURE__ */ jsx2("div", { className: "empty", children: "No products found." })
  ] });
}
Home.documentTitle = ({ q, active }) => q ? `Search \xB7 ${q}` : active || "meesa \u2014 store";

// src/ui/Product.jsx
import { useState } from "react";
import { Fragment as Fragment3, jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var hideOnError2 = (e) => {
  e.currentTarget.style.visibility = "hidden";
};
var uniq = (xs) => [...new Set(xs.filter(Boolean))];
var axes = (variants) => ({
  colours: uniq(variants.map((v) => v.colour)),
  sizes: uniq(variants.map((v) => v.size)),
  hasColour: variants.some((v) => v.colour),
  hasSize: variants.some((v) => v.size)
});
function sizeExists(variants, size, colour, hasColour) {
  return variants.some(
    (v) => v.size === size && (!hasColour || v.colour === colour)
  );
}
function matchVariant(variants, { colour, size }, { hasColour, hasSize }) {
  return variants.find(
    (v) => (!hasColour || v.colour === colour) && (!hasSize || v.size === size)
  );
}
function initialSelection(variants) {
  const { colours, sizes, hasColour, hasSize } = axes(variants);
  const colour = hasColour ? colours[0] ?? null : null;
  const size = hasSize ? sizes.find((s) => sizeExists(variants, s, colour, hasColour)) ?? sizes[0] ?? null : null;
  return { colour, size };
}
function Gallery({ gallery, mainSrc, activeThumb, onPickThumb, title }) {
  return /* @__PURE__ */ jsxs3("div", { className: "gallery", children: [
    /* @__PURE__ */ jsx3("div", { className: "thumbs", children: gallery.map((src, i) => /* @__PURE__ */ jsx3(
      "div",
      {
        className: `thumb ${i === activeThumb ? "active" : ""}`,
        onClick: () => onPickThumb(i, src),
        children: /* @__PURE__ */ jsx3("img", { src, alt: "", onError: hideOnError2 })
      },
      `${src}-${i}`
    )) }),
    /* @__PURE__ */ jsx3("div", { className: "main-img", children: /* @__PURE__ */ jsx3("img", { id: "pd-main", src: mainSrc, alt: title, onError: hideOnError2 }) })
  ] });
}
function SwatchRow({ label, values, selected, disabledValues, onPick }) {
  if (!values.length) return null;
  return /* @__PURE__ */ jsxs3("div", { className: "opt-group", children: [
    /* @__PURE__ */ jsx3("div", { className: "opt-label", children: label }),
    /* @__PURE__ */ jsx3("div", { className: "swatches", children: values.map((v) => {
      const disabled = disabledValues.has(v);
      return /* @__PURE__ */ jsx3(
        "button",
        {
          type: "button",
          className: `swatch ${v === selected ? "active" : ""} ${disabled ? "disabled" : ""}`,
          onClick: () => !disabled && onPick(v),
          children: v
        },
        v
      );
    }) })
  ] });
}
function StockLine({ inStock, count }) {
  return /* @__PURE__ */ jsx3("div", { className: `pd-stock ${inStock ? "in" : "out"}`, id: "pd-stock", children: inStock ? `In stock (${count})` : "Out of stock" });
}
function VariantPicker({ variants, onPhotoChange }) {
  const { colours, sizes, hasColour, hasSize } = axes(variants);
  const [selection, setSelection] = useState(() => initialSelection(variants));
  const current = matchVariant(variants, selection, { hasColour, hasSize });
  const disabledSizes = new Set(
    hasSize && hasColour ? sizes.filter((s) => !sizeExists(variants, s, selection.colour, hasColour)) : []
  );
  function pickColour(colour) {
    const size = hasSize ? sizeExists(variants, selection.size, colour, hasColour) ? selection.size : sizes.find((s) => sizeExists(variants, s, colour, hasColour)) ?? selection.size : null;
    const next = { colour, size };
    setSelection(next);
    const v = matchVariant(variants, next, { hasColour, hasSize });
    if (v?.photo) onPhotoChange(v.photo);
  }
  function pickSize(size) {
    const next = { ...selection, size };
    setSelection(next);
    const v = matchVariant(variants, next, { hasColour, hasSize });
    if (v?.photo) onPhotoChange(v.photo);
  }
  return /* @__PURE__ */ jsxs3(Fragment3, { children: [
    /* @__PURE__ */ jsx3("div", { className: "pd-price", id: "pd-price", children: rs(current ? current.amount : variants[0]?.amount) }),
    /* @__PURE__ */ jsx3(
      StockLine,
      {
        inStock: !!current?.in_stock,
        count: current?.stock ?? 0
      }
    ),
    /* @__PURE__ */ jsx3(
      SwatchRow,
      {
        label: "Colour",
        values: colours,
        selected: selection.colour,
        disabledValues: /* @__PURE__ */ new Set(),
        onPick: pickColour
      }
    ),
    /* @__PURE__ */ jsx3(
      SwatchRow,
      {
        label: "Size",
        values: sizes,
        selected: selection.size,
        disabledValues: disabledSizes,
        onPick: pickSize
      }
    )
  ] });
}
function Product({ product, gallery, variants, isSimple, depts }) {
  const [mainSrc, setMainSrc] = useState(gallery[0] ?? "");
  const [activeThumb, setActiveThumb] = useState(0);
  function pickThumb(index, src) {
    setActiveThumb(index);
    setMainSrc(src);
  }
  const simpleInStock = Number(product.base_stock) > 0;
  return /* @__PURE__ */ jsxs3(Layout, { depts, active: product.dept, children: [
    /* @__PURE__ */ jsxs3("div", { className: "crumbs", children: [
      /* @__PURE__ */ jsx3("a", { href: "/", children: "Home" }),
      " \u203A",
      " ",
      /* @__PURE__ */ jsx3("a", { href: `/category/${encodeURIComponent(product.dept)}`, children: product.dept }),
      " \u203A",
      " ",
      product.title
    ] }),
    /* @__PURE__ */ jsxs3("div", { className: "pd", children: [
      /* @__PURE__ */ jsx3(
        Gallery,
        {
          gallery,
          mainSrc,
          activeThumb,
          onPickThumb: pickThumb,
          title: product.title
        }
      ),
      /* @__PURE__ */ jsxs3("div", { className: "pd-info", children: [
        product.brand_name && /* @__PURE__ */ jsx3("div", { className: "pd-brand", children: product.brand_name }),
        /* @__PURE__ */ jsx3("h1", { className: "pd-title", children: product.title }),
        isSimple ? /* @__PURE__ */ jsxs3(Fragment3, { children: [
          /* @__PURE__ */ jsx3("div", { className: "pd-price", id: "pd-price", children: rs(product.base_amount) }),
          /* @__PURE__ */ jsx3(StockLine, { inStock: simpleInStock, count: Number(product.base_stock || 0) }),
          /* @__PURE__ */ jsx3("div", { className: "buynote", children: "Simple product \u2014 no variants. The connector synthesizes a single variant from these product-level fields." })
        ] }) : /* @__PURE__ */ jsx3(VariantPicker, { variants, onPhotoChange: setMainSrc }),
        product.long_desc && /* @__PURE__ */ jsx3(
          "div",
          {
            className: "pd-desc",
            dangerouslySetInnerHTML: { __html: product.long_desc }
          }
        ),
        /* @__PURE__ */ jsxs3("div", { className: "pd-foot", children: [
          "id: ",
          /* @__PURE__ */ jsx3("code", { children: product.sku_group }),
          " \xB7",
          " ",
          /* @__PURE__ */ jsx3("a", { href: product.page_url || "#", target: "_blank", rel: "noopener noreferrer", children: "View original on meesa.shop \u2197" })
        ] })
      ] })
    ] })
  ] });
}
Product.documentTitle = ({ product }) => `${product.title} \u2014 meesa`;

// src/ui/pages.js
var PAGES = { home: Home, product: Product };
function pageComponent(name) {
  const Component = PAGES[name];
  if (!Component) throw new Error(`unknown page "${name}" (have: ${Object.keys(PAGES).join(", ")})`);
  return Component;
}
export {
  PAGES,
  pageComponent
};
