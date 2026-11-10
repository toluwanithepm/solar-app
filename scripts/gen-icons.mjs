// Draws the app icons (amber tile with a lightning bolt, as in the design) as PNG files in public/.
// No image library needed. Usage: node scripts/gen-icons.mjs
import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const AMBER = [0xf2, 0xa0, 0x07];
const INK = [0x15, 0x19, 0x1f];
// Lightning bolt on a 24×24 grid
const BOLT = [[13, 3], [14, 3], [13, 10], [17, 10], [11, 21], [10, 21], [11, 14], [7, 14]];

function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** radius: corner radius as a share of the size (0 = square, full-bleed for maskable icons); boltScale: bolt size as a share of the tile. */
function draw(size, radius, boltScale) {
  const r = size * radius;
  const scale = (size * boltScale) / 24;
  const off = (size - 24 * scale) / 2;
  const bolt = BOLT.map(([x, y]) => [off + x * scale, off + y * scale]);
  const inTile = (x, y) => {
    const dx = Math.max(r - x, x - (size - r), 0);
    const dy = Math.max(r - y, y - (size - r), 0);
    return dx * dx + dy * dy <= r * r;
  };
  const SS = 4; // supersampling for smooth edges
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let tile = 0;
      let ink = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          if (inTile(fx, fy)) {
            tile++;
            if (inPolygon(fx, fy, bolt)) ink++;
          }
        }
      }
      const i = (y * size + x) * 4;
      const t = ink / Math.max(tile, 1);
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(AMBER[c] * (1 - t) + INK[c] * t);
      px[i + 3] = Math.round((tile / (SS * SS)) * 255);
    }
  }
  return px;
}

function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = new URL('../public/', import.meta.url);
const icons = [
  ['icon-192.png', 192, 0.22, 0.62],
  ['icon-512.png', 512, 0.22, 0.62],
  // Maskable: the phone crops the shape, so the tile is full-bleed and the bolt stays in the safe middle
  ['icon-maskable-512.png', 512, 0, 0.46],
  ['apple-touch-icon.png', 180, 0, 0.58],
];
for (const [name, size, radius, boltScale] of icons) {
  writeFileSync(new URL(name, out), png(size, draw(size, radius, boltScale)));
  console.log('wrote public/' + name);
}
