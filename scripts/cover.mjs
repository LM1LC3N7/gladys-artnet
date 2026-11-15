// -----------------------------------------------------------------------------
// Generates cover.png (800×534, the store size): a dark stage, three spotlight
// beams (red, green, blue) falling from a truss onto the floor, and the small
// Art-Net node at the side with its cable. Plain Node (zlib), no dependency.
// Run: npm run cover
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WIDTH = 800;
const HEIGHT = 534;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const smooth = (edge, distance) => Math.min(1, Math.max(0, edge - distance + 0.5));

const DARK = [10, 10, 22];
const STAGE = [40, 30, 70];
const WHITE = [255, 255, 255];
const SPOTS = [
  [230, [255, 70, 90]],
  [400, [80, 230, 150]],
  [570, [90, 140, 255]],
];

/** Distance to the border of a rounded rectangle (negative inside). */
function roundedBox(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - halfW + radius;
  const qy = Math.abs(y - cy) - halfH + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function pixel(x, y) {
  let color = mix(DARK, STAGE, Math.pow(y / HEIGHT, 1.5));
  // The truss.
  color = mix(color, [120, 120, 140], smooth(1, roundedBox(x, y, 400, 70, 300, 8, 4)) * 0.9);
  for (const [cx, tint] of SPOTS) {
    // The beam: a cone widening down to an ellipse on the floor.
    const top = 100;
    const floor = 430;
    if (y > top && y < floor) {
      const half = 14 + ((y - top) / (floor - top)) * 90;
      const inside = Math.max(0, 1 - Math.abs(x - cx) / half);
      color = mix(color, tint, inside * 0.35 * (0.6 + (0.4 * (y - top)) / (floor - top)));
    }
    const pool = Math.hypot((x - cx) / 110, (y - floor) / 26);
    color = mix(color, tint, Math.max(0, 1 - pool) * 0.75);
    // The fixture body under the truss.
    color = mix(color, [30, 30, 40], smooth(1, roundedBox(x, y, cx, 92, 22, 18, 6)));
    color = mix(color, tint, smooth(1, roundedBox(x, y, cx, 106, 14, 4, 2)) * 0.95);
  }
  // The Art-Net node and its cable to the truss.
  color = mix(color, WHITE, smooth(1, roundedBox(x, y, 720, 470, 48, 22, 8)) * 0.85);
  color = mix(color, [255, 190, 60], smooth(5, Math.hypot(x - 750, y - 470)));
  if (x > 716 && x < 724 && y > 78 && y < 448) color = mix(color, [180, 180, 200], 0.6);
  return color;
}

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw.set([r, g, b], row + 1 + x * 3);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../cover.png', import.meta.url), png);
console.log(`cover.png: ${WIDTH}×${HEIGHT}, ${png.length} bytes`);
