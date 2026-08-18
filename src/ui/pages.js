// The page registry — the single list of renderable pages, shared by both sides.
//
// The server picks a component from here by name and renders it to HTML; the
// browser looks up the SAME name in the SAME map and hydrates it. Routes never
// import components directly, so there is exactly one place where a page name
// is bound to a component and no way for the two sides to disagree.
import Home from "./Home.jsx";
import Product from "./Product.jsx";

export const PAGES = { home: Home, product: Product };

/** Look up a page component, failing loudly rather than rendering a blank page. */
export function pageComponent(name) {
  const Component = PAGES[name];
  if (!Component) throw new Error(`unknown page "${name}" (have: ${Object.keys(PAGES).join(", ")})`);
  return Component;
}
