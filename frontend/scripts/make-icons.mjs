// scripts/make-icons.mjs
// Generates the two PWA icon PNGs (192px and 512px) with zero image
// libraries: we build the raw pixel grid ourselves and wrap it in the
// PNG file format using Node's built-in zlib for compression.
//
// The drawing is simple math: a pixel is inside a diamond when
// |x - center| + |y - center| < radius (that is literally the equation
// of a rotated square). We draw a green diamond with a charcoal hole.
//
// Run manually if you ever want to regenerate:  node scripts/make-icons.mjs

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public");

// Brand colors as [r, g, b]
const CHARCOAL = [0x13, 0x12, 0x11];
const GREEN = [0x10, 0xb9, 0x81];

// CRC32 is a checksum every PNG chunk must carry. Standard table version.
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// A PNG is a signature followed by "chunks": length + type + data + crc.
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

function makeIcon(size) {
  const center = size / 2;
  const outer = size * 0.34; // diamond radius
  const inner = size * 0.13; // charcoal hole radius

  // Raw image data: each row starts with a filter byte (0 = no filter),
  // then size pixels of RGB.
  const raw = Buffer.alloc(size * (1 + size * 3));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter byte for this row
    for (let x = 0; x < size; x++) {
      const d = Math.abs(x - center) + Math.abs(y - center);
      const color = d < inner ? CHARCOAL : d < outer ? GREEN : CHARCOAL;
      raw[p++] = color[0];
      raw[p++] = color[1];
      raw[p++] = color[2];
    }
  }

  // IHDR: image header (size, 8-bit depth, color type 2 = plain RGB)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // signature
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  const file = join(outDir, `pwa-${size}.png`);
  writeFileSync(file, makeIcon(size));
  console.log(`wrote ${file}`);
}
