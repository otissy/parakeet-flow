'use strict';
/* Draws assets/icon.png (256 px) and assets/icon.ico (16..256 px) from code, no dependencies, no third-party
   artwork: a dark rounded square with five waveform bars (the app's own glyph, same accent as the tray icon).
   Run: node scripts/make-icon.js   The .ico is committed because PNG-to-ICO conversion crashed on Node 26 here. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const BG = [24, 24, 30], BG2 = [38, 36, 58], ACCENT = [140, 125, 255];
const BARS = [0.24, 0.45, 0.7, 0.45, 0.24];          // bar heights as a fraction of the icon

/** RGBA pixels (top-down), 4x4 supersampled for smooth edges */
function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4, rad = size * 0.22, barW = size * 0.085, gap = size * 0.145, cx0 = size / 2 - gap * 2;
  const inRound = (x, y) => {
    const qx = Math.min(Math.max(x, rad), size - rad), qy = Math.min(Math.max(y, rad), size - rad);
    return Math.hypot(x - qx, y - qy) <= rad;
  };
  const inBar = (x, y) => BARS.some((h, i) => {
    const cx = cx0 + gap * i, hh = (h * size) / 2, r = barW / 2;
    const dy = Math.max(0, Math.abs(y - size / 2) - (hh - r));
    return Math.hypot(Math.max(0, Math.abs(x - cx) - 0), dy) <= r && Math.abs(x - cx) <= r;
  });
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let a = 0, bar = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const fx = x + (sx + 0.5) / SS, fy = y + (sy + 0.5) / SS;
      if (inRound(fx, fy)) { a++; if (inBar(fx, fy)) bar++; }
    }
    const o = (y * size + x) * 4, n = SS * SS, t = y / size;
    const bg = BG.map((c, i) => Math.round(c + (BG2[i] - c) * t));
    const f = a ? bar / a : 0;
    for (let i = 0; i < 3; i++) px[o + i] = Math.round(bg[i] + (ACCENT[i] - bg[i]) * f);
    px[o + 3] = Math.round((a / n) * 255);
  }
  return px;
}

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(px, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/** classic BMP/DIB entry (32 bpp BGRA, bottom-up, plus the 1-bpp AND mask) for the small sizes */
function dib(px, size) {
  const hdr = Buffer.alloc(40);
  hdr.writeUInt32LE(40, 0); hdr.writeInt32LE(size, 4); hdr.writeInt32LE(size * 2, 8); hdr.writeUInt16LE(1, 12); hdr.writeUInt16LE(32, 14);
  const body = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const s = ((size - 1 - y) * size + x) * 4, d = (y * size + x) * 4;
    body[d] = px[s + 2]; body[d + 1] = px[s + 1]; body[d + 2] = px[s]; body[d + 3] = px[s + 3];
  }
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([hdr, body, Buffer.alloc(maskRow * size)]);
}
function ico(images) {          // images: [{size, data}]
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let off = 6 + 16 * images.length;
  const dir = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(off, 12); off += data.length; return e;
  });
  return Buffer.concat([head, ...dir, ...images.map((i) => i.data)]);
}

function build() {
  const images = SIZES.map((size) => {
    const px = render(size);
    return { size, px, data: size >= 128 ? png(px, size) : dib(px, size) };
  });
  return { ico: ico(images), png: png(images[images.length - 1].px, 256), sizes: SIZES };
}

if (require.main === module) {
  const out = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(out, { recursive: true });
  const r = build();
  fs.writeFileSync(path.join(out, 'icon.ico'), r.ico);
  fs.writeFileSync(path.join(out, 'icon.png'), r.png);
  console.log(`assets/icon.ico ${r.ico.length} bytes (${r.sizes.join(', ')} px), assets/icon.png ${r.png.length} bytes`);
}
module.exports = { build, render, SIZES };
