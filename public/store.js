// Storefront interactivity: thumbnail switching + colour/size variant selector
// that updates price, stock, and swaps the main image to the colour's lead photo.
(function () {
  const main = document.getElementById("pd-main");

  // Thumbnails
  document.querySelectorAll(".thumb").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".thumb").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      if (main && t.dataset.src) main.src = t.dataset.src;
    });
  });

  const dataEl = document.getElementById("pd-data");
  if (!dataEl) return;
  let model;
  try { model = JSON.parse(dataEl.textContent); } catch { return; }
  if (model.isSimple || !model.variants?.length) return;

  const variants = model.variants;
  const priceEl = document.getElementById("pd-price");
  const stockEl = document.getElementById("pd-stock");
  const hasColour = variants.some((v) => v.colour);
  const hasSize = variants.some((v) => v.size);

  const sel = { colour: null, size: null };
  const firstActive = (axis) =>
    document.querySelector(`.opt-group[data-axis="${axis}"] .swatch.active`)?.dataset.val || null;
  if (hasColour) sel.colour = firstActive("colour");
  if (hasSize) sel.size = firstActive("size");

  const fmt = (n) => "Rs. " + Number(n).toLocaleString("en-IN");

  function match() {
    return variants.find((v) =>
      (!hasColour || v.colour === sel.colour) && (!hasSize || v.size === sel.size));
  }

  function sizeExists(size) {
    return variants.some((v) => v.size === size && (!hasColour || v.colour === sel.colour));
  }

  function render() {
    // disable sizes not available for the chosen colour
    if (hasSize && hasColour) {
      document.querySelectorAll('.opt-group[data-axis="size"] .swatch').forEach((b) => {
        const ok = sizeExists(b.dataset.val);
        b.classList.toggle("disabled", !ok);
      });
      // if current size is now unavailable, jump to the first available one
      if (sel.size && !sizeExists(sel.size)) {
        const avail = [...document.querySelectorAll('.opt-group[data-axis="size"] .swatch')]
          .find((b) => !b.classList.contains("disabled"));
        if (avail) selectSwatch(avail, "size", false);
      }
    }
    const v = match();
    // swap main image to the colour's lead photo
    if (v && v.photo && main) main.src = v.photo;
    if (priceEl) priceEl.textContent = v ? fmt(v.amount) : (priceEl.textContent);
    if (stockEl) {
      if (v && v.in_stock) { stockEl.textContent = `In stock (${v.stock})`; stockEl.className = "pd-stock in"; }
      else { stockEl.textContent = "Out of stock"; stockEl.className = "pd-stock out"; }
    }
  }

  function selectSwatch(btn, axis, rerender = true) {
    btn.parentElement.querySelectorAll(".swatch").forEach((x) => x.classList.remove("active"));
    btn.classList.add("active");
    sel[axis] = btn.dataset.val;
    if (rerender) render();
  }

  document.querySelectorAll(".opt-group").forEach((g) => {
    const axis = g.dataset.axis;
    g.querySelectorAll(".swatch").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.classList.contains("disabled")) return;
        selectSwatch(btn, axis);
      });
    });
  });

  render();
})();
