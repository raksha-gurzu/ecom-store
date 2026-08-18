// Generate the image files the CI fixture catalog references.
//
// They must be REAL images: scripts/audit.mjs sniffs magic bytes and rejects
// anything whose content is not a decodable image matching its extension (the
// check that catches meesa serving AVIF bytes named .jpg). Random bytes with an
// image extension fail it, correctly.
//
// So this writes genuine PNGs, encoded here with nothing but node:zlib — no
// image library, no binary blobs committed to the repo.
//
//   node scripts/ci-fixture-images.mjs [outDir]      default: ./ci-images
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const OUT = path.resolve(process.argv[2] || "ci-images");
const NAMES = ["ci-a", "ci-b", "ci-c", "ci-d", "ci-e", "ci-f", "ci-g"];
const SIZE = 48; // 48×48 of noise comfortably exceeds audit's 512-byte floor

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, data, CRC of (type + data). */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A valid RGB PNG of `size`×`size`, its colours seeded from `seed`. */
function png(size, seed) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type 2 = truecolour RGB
  // 10..12 = compression, filter, interlace — all 0

  // Raw scanlines: each row is a filter byte followed by RGB triples.
  const raw = Buffer.alloc(size * (1 + size * 3));
  let at = 0;
  let x = seed * 2654435761 % 4294967296;
  const next = () => (x = (x * 1103515245 + 12345) % 4294967296) % 256;
  for (let row = 0; row < size; row++) {
    raw[at++] = 0; // filter: none
    for (let col = 0; col < size * 3; col++) raw[at++] = next();
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [i, name] of NAMES.entries()) {
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, png(SIZE, i + 1));
  console.log(`  ${file}  ${fs.statSync(file).size} bytes`);
}
console.log(`✓ wrote ${NAMES.length} fixture images to ${OUT}`);
