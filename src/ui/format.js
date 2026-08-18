// Formatting shared by the server render and the browser hydration. Both sides
// MUST format identically — a mismatch shows up as a hydration warning and a
// visible flicker as React corrects the DOM.
//
// Note there is no escaping helper here any more: React escapes every value it
// renders. The one deliberate exception is product.long_desc, which is real
// merchant HTML and is injected with dangerouslySetInnerHTML in Product.jsx.

/** 1499 → "Rs. 1,499"; null → "—" */
export const rs = (n) =>
  n == null ? "—" : `Rs. ${Number(n).toLocaleString("en-IN")}`;
