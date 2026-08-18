// Product detail: image gallery plus a live colour/size selector that updates
// price, stock and the main image.
//
// This is the only genuinely interactive page, and the only place React earns
// its keep: what used to be public/store.js walking the DOM by hand is now
// state. The selection rules are unchanged —
//   • picking a colour disables sizes that colour does not come in
//   • if the chosen size vanishes, it jumps to the first available one
//   • the main image swaps to the selected colour's lead photo
import { useState } from "react";
import Layout from "./Layout.jsx";
import { rs } from "./format.js";

const hideOnError = (e) => {
  e.currentTarget.style.visibility = "hidden";
};

// ── Selection rules, kept as pure functions ─────────────────────────────────
// The server calls initialSelection() while rendering and the browser calls it
// again while hydrating. Being pure and deterministic is what makes those two
// runs agree — anything random or time-based here would desync them.

const uniq = (xs) => [...new Set(xs.filter(Boolean))];

const axes = (variants) => ({
  colours: uniq(variants.map((v) => v.colour)),
  sizes: uniq(variants.map((v) => v.size)),
  hasColour: variants.some((v) => v.colour),
  hasSize: variants.some((v) => v.size),
});

/** Does `size` exist in `colour`? (With no colour axis, just: does it exist?) */
function sizeExists(variants, size, colour, hasColour) {
  return variants.some(
    (v) => v.size === size && (!hasColour || v.colour === colour)
  );
}

/** The variant matching the current selection, if the combination is real. */
function matchVariant(variants, { colour, size }, { hasColour, hasSize }) {
  return variants.find(
    (v) => (!hasColour || v.colour === colour) && (!hasSize || v.size === size)
  );
}

/** First colour, and the first size that colour actually comes in. */
function initialSelection(variants) {
  const { colours, sizes, hasColour, hasSize } = axes(variants);
  const colour = hasColour ? colours[0] ?? null : null;
  const size = hasSize
    ? sizes.find((s) => sizeExists(variants, s, colour, hasColour)) ?? sizes[0] ?? null
    : null;
  return { colour, size };
}

// ── Components ──────────────────────────────────────────────────────────────

function Gallery({ gallery, mainSrc, activeThumb, onPickThumb, title }) {
  return (
    <div className="gallery">
      <div className="thumbs">
        {gallery.map((src, i) => (
          <div
            key={`${src}-${i}`}
            className={`thumb ${i === activeThumb ? "active" : ""}`}
            onClick={() => onPickThumb(i, src)}
          >
            <img src={src} alt="" onError={hideOnError} />
          </div>
        ))}
      </div>
      <div className="main-img">
        <img id="pd-main" src={mainSrc} alt={title} onError={hideOnError} />
      </div>
    </div>
  );
}

function SwatchRow({ label, values, selected, disabledValues, onPick }) {
  if (!values.length) return null;
  return (
    <div className="opt-group">
      <div className="opt-label">{label}</div>
      <div className="swatches">
        {values.map((v) => {
          const disabled = disabledValues.has(v);
          return (
            <button
              key={v}
              type="button"
              className={`swatch ${v === selected ? "active" : ""} ${disabled ? "disabled" : ""}`}
              onClick={() => !disabled && onPick(v)}
            >
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StockLine({ inStock, count }) {
  return (
    <div className={`pd-stock ${inStock ? "in" : "out"}`} id="pd-stock">
      {inStock ? `In stock (${count})` : "Out of stock"}
    </div>
  );
}

function VariantPicker({ variants, onPhotoChange }) {
  const { colours, sizes, hasColour, hasSize } = axes(variants);
  const [selection, setSelection] = useState(() => initialSelection(variants));

  const current = matchVariant(variants, selection, { hasColour, hasSize });

  // Sizes this colour does not come in are shown but not selectable.
  const disabledSizes = new Set(
    hasSize && hasColour
      ? sizes.filter((s) => !sizeExists(variants, s, selection.colour, hasColour))
      : []
  );

  function pickColour(colour) {
    // Keep the current size if this colour has it, else fall to the first it does.
    const size = hasSize
      ? sizeExists(variants, selection.size, colour, hasColour)
        ? selection.size
        : sizes.find((s) => sizeExists(variants, s, colour, hasColour)) ?? selection.size
      : null;
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

  return (
    <>
      <div className="pd-price" id="pd-price">
        {rs(current ? current.amount : variants[0]?.amount)}
      </div>
      <StockLine
        inStock={!!current?.in_stock}
        count={current?.stock ?? 0}
      />
      <SwatchRow
        label="Colour"
        values={colours}
        selected={selection.colour}
        disabledValues={new Set()}
        onPick={pickColour}
      />
      <SwatchRow
        label="Size"
        values={sizes}
        selected={selection.size}
        disabledValues={disabledSizes}
        onPick={pickSize}
      />
    </>
  );
}

export default function Product({ product, gallery, variants, isSimple, depts }) {
  const [mainSrc, setMainSrc] = useState(gallery[0] ?? "");
  const [activeThumb, setActiveThumb] = useState(0);

  function pickThumb(index, src) {
    setActiveThumb(index);
    setMainSrc(src);
  }

  const simpleInStock = Number(product.base_stock) > 0;

  return (
    <Layout depts={depts} active={product.dept}>
      <div className="crumbs">
        <a href="/">Home</a> ›{" "}
        <a href={`/category/${encodeURIComponent(product.dept)}`}>{product.dept}</a> ›{" "}
        {product.title}
      </div>

      <div className="pd">
        <Gallery
          gallery={gallery}
          mainSrc={mainSrc}
          activeThumb={activeThumb}
          onPickThumb={pickThumb}
          title={product.title}
        />

        <div className="pd-info">
          {product.brand_name && <div className="pd-brand">{product.brand_name}</div>}
          <h1 className="pd-title">{product.title}</h1>

          {isSimple ? (
            <>
              <div className="pd-price" id="pd-price">
                {rs(product.base_amount)}
              </div>
              <StockLine inStock={simpleInStock} count={Number(product.base_stock || 0)} />
              <div className="buynote">
                Simple product — no variants. The connector synthesizes a single
                variant from these product-level fields.
              </div>
            </>
          ) : (
            <VariantPicker variants={variants} onPhotoChange={setMainSrc} />
          )}

          {/* Merchant-authored HTML from the catalog. Rendered raw on purpose —
              the description field legitimately contains markup, and the same
              string is what the API hands the connector. */}
          {product.long_desc && (
            <div
              className="pd-desc"
              dangerouslySetInnerHTML={{ __html: product.long_desc }}
            />
          )}

          <div className="pd-foot">
            id: <code>{product.sku_group}</code> ·{" "}
            <a href={product.page_url || "#"} target="_blank" rel="noopener noreferrer">
              View original on meesa.shop ↗
            </a>
          </div>
        </div>
      </div>
    </Layout>
  );
}

Product.documentTitle = ({ product }) => `${product.title} — meesa`;
