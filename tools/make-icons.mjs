// Generator ikon PWA tanpa dependency eksternal (zlib bawaan Node).
// Menghasilkan PNG rounded-square + glyph pin lokasi.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

const BRAND_A = hex('#4F46E5');
const BRAND_B = hex('#06B6D4');
const WHITE = [255, 255, 255];

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// signed distance ke rounded-rect (untuk anti-aliasing halus)
function radiusAlpha(px, py, cx, cy, hw, hh, r, soft) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  return clamp01(0.5 - d / soft);
}

// glyph: pin lokasi + lubang tengah, digambar lewat signed distance
function pinAlpha(px, py, s) {
  const cx = 0.5;
  const headY = 0.42;
  const R = 0.235;
  const dHead = Math.hypot(px - cx, py - headY) - R;
  // ekor segitiga dari bawah kepala ke ujung runcing
  const tipY = 0.855;
  const halfW = 0.175;
  const t = clamp01((py - (headY + R * 0.15)) / (tipY - (headY + R * 0.15)));
  const wNow = halfW * (1 - t);
  let dTail = 1;
  if (py > headY && py < tipY) {
    dTail = Math.abs(px - cx) - wNow;
    if (wNow <= 0) dTail = Math.hypot(px - cx, py - tipY) - 0.002;
  }
  const dOuter = Math.min(dHead, dTail);
  const dInner = Math.hypot(px - cx, py - headY) - 0.098;
  return { outer: clamp01(0.5 - dOuter / s), inner: clamp01(0.5 - dInner / s) };
}

function render(size, { pad, gradient }) {
  const SS = 3; // supersampling
  const out = Buffer.alloc(size * size * 4);
  const half = size / 2;
  const hw = half - pad;
  const r = size * 0.235;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ar = 0, ag = 0, ab = 0, aa = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const soft = size / 160;
          const bgA = radiusAlpha(px, py, half, half, hw, hw, r, soft);
          if (bgA <= 0) continue;
          let base;
          if (gradient) {
            const t = clamp01((px / size) * 0.5 + (py / size) * 0.5);
            base = mix(BRAND_A, BRAND_B, t);
          } else {
            base = BRAND_A;
          }
          const p = pinAlpha(px / size, py / size, soft / size);
          const glyph = p.outer * (1 - p.inner);
          const col = mix(base, WHITE, glyph);
          ar += col[0] * bgA;
          ag += col[1] * bgA;
          ab += col[2] * bgA;
          aa += bgA;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      if (aa > 0) {
        out[i] = Math.round(ar / aa);
        out[i + 1] = Math.round(ag / aa);
        out[i + 2] = Math.round(ab / aa);
        out[i + 3] = Math.round(clamp01(aa / n) * 255);
      }
    }
  }
  return encodePng(size, size, out);
}

mkdirSync(resolve(ROOT, 'icons'), { recursive: true });

const targets = [
  ['icons/icon-192.png', 192, { pad: 8, gradient: true }],
  ['icons/icon-512.png', 512, { pad: 20, gradient: true }],
  ['icons/maskable-512.png', 512, { pad: 92, gradient: true }],
  ['icons/apple-touch-icon.png', 180, { pad: 0, gradient: true }],
  ['icons/favicon.png', 64, { pad: 4, gradient: true }],
];

for (const [file, size, opt] of targets) {
  writeFileSync(resolve(ROOT, file), render(size, opt));
  console.log('generated', file, `${size}x${size}`);
}
