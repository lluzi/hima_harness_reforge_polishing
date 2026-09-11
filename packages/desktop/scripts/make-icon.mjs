// The window's icon, drawn here rather than downloaded: it is ours, it is reproducible, and it
// borrows nobody's marks. `node scripts/make-icon.mjs` rewrites `assets/icon.png` byte for byte.
//
// A 512x512 RGB PNG: the dark ground the window paints while the host boots, an "H" in the same grey
// the card's text uses, and one amber mark for the strategy knob a campaign turns. No dependency —
// a PNG is a header, one deflated block of scanlines, and an end marker.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const size = 512;
const ground = [0x11, 0x18, 0x27]; // #111827, the window's own background
const ink = [0xe5, 0xe7, 0xeb]; // #e5e7eb
const accent = [0xf5, 0x9e, 0x0b]; // #f59e0b

const pixels = Buffer.alloc(size * size * 3);
const put = (x, y, [r, g, b]) => {
  const at = (y * size + x) * 3;
  pixels[at] = r; pixels[at + 1] = g; pixels[at + 2] = b;
};
const box = (x0, y0, x1, y1, colour) => {
  for (let y = Math.max(0, y0); y < Math.min(size, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(size, x1); x += 1) put(x, y, colour);
  }
};

box(0, 0, size, size, ground);
// The H: two posts and a beam.
box(140, 128, 196, 384, ink);
box(316, 128, 372, 384, ink);
box(196, 228, 316, 284, ink);
// The mark: one amber square, where a knob would sit.
box(316, 396, 372, 452, accent);

/** One PNG chunk: length, type, payload, CRC-32 of type+payload. */
function chunk(type, payload) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length, 0);
  head.write(type, 4, 'ascii');
  const crcInput = Buffer.concat([head.subarray(4, 8), payload]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(crcInput) >>> 0, 0);
  return Buffer.concat([head, payload, tail]);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour
// compression 0, filter 0, interlace 0 are already zero.

// Scanlines, each with its filter byte (0: none).
const raw = Buffer.alloc(size * (1 + size * 3));
for (let y = 0; y < size; y += 1) {
  const at = y * (1 + size * 3);
  raw[at] = 0;
  pixels.copy(raw, at + 1, y * size * 3, (y + 1) * size * 3);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'assets/icon.png');
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`icon: ${out} (${png.length} bytes)`);
