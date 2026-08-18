// Browser entry point — bundled to public/bundle.js.
//
// It does NOT build the page. The server already sent complete HTML; this
// attaches React to that existing markup so the interactive parts (thumbnails,
// colour and size selection) start working. That is why the storefront still
// renders fully with JavaScript disabled or still loading.
import { hydrateRoot } from "react-dom/client";
import { createElement } from "react";
import { pageComponent } from "../ui/pages.js";

const DATA_ID = "__STOREFRONT_DATA__";

function boot() {
  const root = document.getElementById("root");
  const dataEl = document.getElementById(DATA_ID);
  if (!root || !dataEl) return; // not a storefront page (e.g. /api-info)

  let payload;
  try {
    payload = JSON.parse(dataEl.textContent);
  } catch (err) {
    // A parse failure leaves the server HTML in place — a static but correct
    // page beats a blank one, so fail quietly rather than throwing.
    console.error("storefront: could not read page data", err);
    return;
  }

  const { page, props } = payload;
  hydrateRoot(root, createElement(pageComponent(page), props));
}

boot();
