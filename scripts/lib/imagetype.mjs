// Identify an image by its MAGIC BYTES, not by the Content-Type header or the
// URL extension — both lie. meesa's R2 serves AVIF bytes under `image/jpeg` for
// some products; trusting the header wrote AVIF files named `.jpg`, which Express
// then served as `image/jpeg`. Browsers sniff and cope; strict consumers (the
// connector's image pipeline, PIL, sharp) fail to decode → a dead product.
//
// Returns the correct file extension, or null when the bytes are not an image we
// recognise (an HTML error page, a truncated body, a signed-URL expiry notice…).
// Callers treat null as "this image did not scrape properly".

const startsWith = (buf, bytes, at = 0) =>
  bytes.every((b, i) => buf[at + i] === b);

export function sniffImage(buf) {
  if (!buf || buf.length < 16) return null;

  // JPEG: FF D8 FF
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  // GIF: "GIF8"
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return "gif";
  // RIFF....WEBP
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8))
    return "webp";
  // ISO-BMFF box: ....ftyp<brand>. AVIF and HEIC share the container.
  if (startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buf.toString("latin1", 8, 12);
    if (brand === "avif" || brand === "avis") return "avif";
    if (brand.startsWith("hei") || brand === "mif1") return "heic";
  }
  return null;
}

// Extensions sniffImage can produce — used to find an already-cached download.
export const IMAGE_EXTS = ["jpg", "png", "webp", "gif", "avif", "heic"];

// Formats a browser AND a typical image pipeline can both handle.
//
// AVIF and HEIC are deliberately EXCLUDED. Browsers render AVIF, but the common
// server-side decoders don't without an extra plugin (stock Pillow raises
// UnidentifiedImageError on it), so an AVIF-only product reaches the connector as
// an undecodable image. A product whose photos are all AVIF counts as un-scraped
// and is dropped rather than shipped half-working. Move "avif" into this set if
// the consuming pipeline is known to support it.
export const USABLE_EXTS = new Set(["jpg", "png", "webp", "gif"]);

export const isUsable = (ext) => !!ext && USABLE_EXTS.has(ext);
