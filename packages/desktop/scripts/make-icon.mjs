// The window's icon, drawn here rather than downloaded: it is ours, it is reproducible, and it
// borrows nobody's marks. `node scripts/make-icon.mjs` rewrites `assets/icon.png` byte for byte.
//
// A 512x512 RGBA PNG: deep navy, geometric aiX, and an ice-blue modular X arm. No dependency —
// PNG and macOS ICNS are generated from the same artwork without native build dependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The same geometric aiX construction as the client wordmark, sampled at 2x for clean edges.
const ground = [0x08, 0x2f, 0x68];
const ink = [0xff, 0xff, 0xff];
const accent = [0xb6, 0xce, 0xf0];
const distance = (x, y, a, b, c, d) => {
  const vx=c-a, vy=d-b, t=Math.max(0,Math.min(1,((x-a)*vx+(y-b)*vy)/(vx*vx+vy*vy)));
  return Math.hypot(x-a-t*vx,y-b-t*vy);
};
const paint = (x, y) => {
  const cornerX=Math.max(224-x,0,x-800), cornerY=Math.max(224-y,0,y-800);
  if (Math.hypot(cornerX,cornerY)>224) return [0,0,0,0];
  const px=x-18, py=y+38;
  const ring=Math.hypot(px-284,py-574);
  const a=(ring>=67&&ring<=121)||distance(px,py,369,480,369,668)<=27;
  const i=distance(px,py,471,508,471,668)<=27||Math.hypot(px-471,py-426)<=29;
  const joint=Math.abs(px-684)+Math.abs(py-550)<50;
  const cross=!joint&&(distance(px,py,574,426,794,674)<=30||distance(px,py,574,674,794,426)<=30);
  if (a||i||cross) return [...(cross&&distance(px,py,684,550,794,426)<=30?accent:ink),255];
  return [...ground,255];
};

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

function pngAt(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y=0;y<size;y+=1) for (let x=0;x<size;x+=1) {
    const samples=[[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([dx,dy])=>paint((x+dx)*1024/size,(y+dy)*1024/size));
    const at=(y*size+x)*4;
    const alpha=samples.reduce((sum,p)=>sum+p[3],0);
    for(let channel=0;channel<3;channel+=1)pixels[at+channel]=alpha===0?0:Math.round(samples.reduce((sum,p)=>sum+p[channel]*p[3],0)/alpha);
    pixels[at+3]=Math.round(alpha/4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  // compression 0, filter 0, interlace 0 are already zero.

  // Scanlines, each with its filter byte (0: none).
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y += 1) {
    const at = y * (1 + size * 4);
    raw[at] = 0;
    pixels.copy(raw, at + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);

}

const out = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'assets/icon.png');
mkdirSync(path.dirname(out), { recursive: true });
const png = pngAt(512);
writeFileSync(out, png);
// Modern ICNS embeds PNGs at native 16–1024px sizes, including Retina representations.
const resources = [['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024]].map(([type, size]) => {
  const payload = size === 512 ? png : pngAt(size);
  const header = Buffer.alloc(8);
  header.write(type, 0, 'ascii'); header.writeUInt32BE(payload.length + 8, 4);
  return Buffer.concat([header, payload]);
});
const header = Buffer.alloc(8); header.write('icns');
header.writeUInt32BE(8 + resources.reduce((total, resource) => total + resource.length, 0), 4);
writeFileSync(out.replace(/\.png$/, '.icns'), Buffer.concat([header, ...resources]));
console.log(`icon: ${out} (${png.length} bytes)`);
