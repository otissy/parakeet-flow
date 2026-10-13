'use strict';
/* Draws the tray icon as a PNG in code (no image assets): a dark disc with three light level bars. */
const zlib = require('zlib');

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

function iconPng(size = 32, accent = [140, 125, 255]) {
  const px = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2, r = size / 2 - 1;
  const bars = [[0.30, 0.34], [0.46, 0.62], [0.62, 0.46]].map(([x, h]) => ({ x: x * size, h: h * size, w: size * 0.09 }));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - cx, y - cx), o = (y * size + x) * 4;
    const a = Math.max(0, Math.min(1, r + 0.5 - d));
    let col = [24, 24, 30];
    for (const b of bars) if (Math.abs(x - b.x) <= b.w && Math.abs(y - cx) <= b.h / 2) col = accent;
    px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = Math.round(a * 255);
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { iconPng };
