'use strict';

/**
 * Génère les icônes PNG de la PWA sans aucune dépendance:
 * un carré arrondi turquoise avec un micro blanc.
 *   node scripts/make-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filtre "none"
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Distance signée à un rectangle arrondi centré (pour un anticrénelage simple). */
function roundRect(x, y, cx, cy, halfW, halfH, r) {
  const dx = Math.abs(x - cx) - (halfW - r);
  const dy = Math.abs(y - cy) - (halfH - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.min(Math.max(dx, dy), 0) + Math.sqrt(ax * ax + ay * ay) - r;
}

function draw(size, { bleed = 0 } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size;
  const pad = bleed ? 0 : s * 0.06; // maskable = pas de marge, l'OS rogne
  const put = (i, r, g, b, a) => {
    // composition "source-over", couleurs non prémultipliées (0-255)
    const dstA = buf[i + 3] / 255;
    const A = a + dstA * (1 - a);
    if (A <= 0) return;
    for (let k = 0; k < 3; k += 1) {
      const src = [r, g, b][k] / 255;
      const dst = buf[i + k] / 255;
      buf[i + k] = Math.round(((src * a + dst * dstA * (1 - a)) / A) * 255);
    }
    buf[i + 3] = Math.round(A * 255);
  };
  const cover = (d) => Math.min(1, Math.max(0, 0.5 - d)); // ~1px d'antialiasing

  for (let y = 0; y < s; y += 1) {
    for (let x = 0; x < s; x += 1) {
      const i = (y * s + x) * 4;
      // fond: dégradé turquoise -> vert profond
      const bg = roundRect(x, y, s / 2, s / 2, s / 2 - pad, s / 2 - pad, bleed ? s * 0.02 : s * 0.22);
      const a = cover(bg);
      if (a > 0) {
        const t = y / s;
        put(i, Math.round(13 + 6 * t), Math.round(148 - 40 * t), Math.round(136 - 20 * t), a);
      }

      // micro: capsule + arceau + pied
      const capsule = roundRect(x, y, s / 2, s * 0.42, s * 0.105, s * 0.185, s * 0.105);
      const stem = roundRect(x, y, s / 2, s * 0.68, s * 0.022, s * 0.075, s * 0.022);
      const base = roundRect(x, y, s / 2, s * 0.755, s * 0.14, s * 0.024, s * 0.024);
      const dr = Math.sqrt((x - s / 2) ** 2 + (y - s * 0.47) ** 2);
      const arcBand = Math.abs(dr - s * 0.245) - s * 0.023;
      const arc = y > s * 0.47 ? arcBand : 1e9; // demi-cercle bas seulement
      const ink = Math.min(capsule, stem, base, arc);
      const ia = cover(ink);
      if (ia > 0) put(i, 255, 255, 255, ia);
    }
  }
  return png(s, s, buf);
}

const out = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });
const files = [
  ['icon-192.png', draw(192)],
  ['icon-512.png', draw(512)],
  ['maskable-512.png', draw(512, { bleed: 1 })],
  ['icon-48.png', draw(48)],
];
for (const [name, buf] of files) {
  fs.writeFileSync(path.join(out, name), buf);
  console.log(`${name}  ${buf.length} bytes`);
}
