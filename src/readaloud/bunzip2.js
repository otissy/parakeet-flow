'use strict';
/* A small bzip2 decoder and a tar reader, in plain JavaScript, so the voice pack (a .tar.bz2 release asset) can be unpacked on any Windows
   PC: Node has no bzip2, and tar.exe needs a separate bzip2 program for it (it hung here). Not used on anything but an archive whose
   SHA-256 was already checked against the pinned value, so the per-block CRCs are read and skipped, not verified. */
const fs = require('fs');
const path = require('path');

class BitReader {
  constructor(buf) { this.buf = buf; this.pos = 0; this.bit = 0; this.cur = 0; }      // cur holds `bit` unread low bits
  read(n) {                                                                           // n <= 24
    while (this.bit < n) {
      if (this.pos >= this.buf.length) throw new Error('bzip2: unexpected end of data');
      this.cur = ((this.cur << 8) | this.buf[this.pos++]) >>> 0;
      this.bit += 8;
    }
    const v = (this.cur >>> (this.bit - n)) & ((1 << n) - 1);
    this.bit -= n;
    this.cur &= (1 << this.bit) - 1;
    return v;
  }
  read1() { return this.read(1); }
  align() { this.bit = 0; this.cur = 0; }
  atEnd() { return this.pos >= this.buf.length; }
}

const MAX_CODE_LEN = 20;

/** canonical Huffman decoding tables for one coding group */
function makeTable(lengths, alphaSize) {
  let minLen = 32, maxLen = 0;
  for (let i = 0; i < alphaSize; i++) { if (lengths[i] > maxLen) maxLen = lengths[i]; if (lengths[i] < minLen) minLen = lengths[i]; }
  const perm = new Int32Array(alphaSize), limit = new Int32Array(MAX_CODE_LEN + 2), base = new Int32Array(MAX_CODE_LEN + 2);
  let pp = 0;
  for (let l = minLen; l <= maxLen; l++) for (let s = 0; s < alphaSize; s++) if (lengths[s] === l) perm[pp++] = s;
  const count = new Int32Array(MAX_CODE_LEN + 2);
  for (let i = 0; i < alphaSize; i++) count[lengths[i]]++;
  let code = 0, idx = 0;
  for (let l = minLen; l <= maxLen; l++) {
    base[l] = idx - code;               // symbol index = code + base[l]
    code += count[l]; idx += count[l];
    limit[l] = code - 1;
    code <<= 1;
  }
  return { minLen, maxLen, perm, limit, base };
}

/** decode every bzip2 stream in `buf`; onData(Uint8Array) is called with the output piece by piece (the array is reused: copy to keep) */
function bunzip2(buf, onData) {
  const br = new BitReader(buf);
  const tt = new Uint32Array(900000);
  const out = new Uint8Array(1 << 20);
  let outLen = 0;
  const put = (b) => { out[outLen++] = b; if (outLen === out.length) { onData(out.subarray(0, outLen)); outLen = 0; } };
  let streams = 0;
  while (!br.atEnd()) {
    if (br.read(8) !== 0x42 || br.read(8) !== 0x5A || br.read(8) !== 0x68) { if (streams) break; throw new Error('bzip2: bad header'); }   // 'BZh'
    const level = br.read(8) - 0x30;
    if (level < 1 || level > 9) throw new Error('bzip2: bad block size');
    const blockMax = level * 100000;
    streams++;
    for (;;) {
      const m1 = br.read(24), m2 = br.read(24);
      if (m1 === 0x177245 && m2 === 0x385090) { br.read(24); br.read(8); br.align(); break; }          // end of stream + combined CRC
      if (m1 !== 0x314159 || m2 !== 0x265359) throw new Error('bzip2: bad block header');
      br.read(24); br.read(8);                                                                        // block CRC (skipped)
      if (br.read1()) throw new Error('bzip2: randomised blocks are not supported');
      const origPtr = br.read(24);
      // symbol map
      const used16 = br.read(16);
      const seqToUnseq = new Uint8Array(256); let nInUse = 0;
      for (let i = 0; i < 16; i++) if (used16 & (0x8000 >> i)) { const bits = br.read(16); for (let j = 0; j < 16; j++) if (bits & (0x8000 >> j)) seqToUnseq[nInUse++] = i * 16 + j; }
      if (!nInUse) throw new Error('bzip2: empty symbol map');
      const alphaSize = nInUse + 2;
      const nGroups = br.read(3), nSelectors = br.read(15);
      if (nGroups < 2 || nGroups > 6 || nSelectors < 1) throw new Error('bzip2: bad tables');
      const mtfSel = []; for (let i = 0; i < nGroups; i++) mtfSel.push(i);
      const selectors = new Uint8Array(nSelectors);
      for (let i = 0; i < nSelectors; i++) {
        let j = 0; while (br.read1()) { j++; if (j >= nGroups) throw new Error('bzip2: bad selector'); }
        const v = mtfSel[j]; for (; j > 0; j--) mtfSel[j] = mtfSel[j - 1]; mtfSel[0] = v; selectors[i] = v;
      }
      const tables = [];
      for (let g = 0; g < nGroups; g++) {
        const len = new Uint8Array(alphaSize);
        let curLen = br.read(5);
        for (let s = 0; s < alphaSize; s++) {
          for (;;) {
            if (curLen < 1 || curLen > MAX_CODE_LEN) throw new Error('bzip2: bad code length');
            if (!br.read1()) break;
            curLen += br.read1() ? -1 : 1;
          }
          len[s] = curLen;
        }
        tables.push(makeTable(len, alphaSize));
      }
      // symbols -> MTF -> bytes (tt[i] low byte), counting for the inverse BWT
      const EOB = nInUse + 1;
      const mtf = new Uint8Array(256); for (let i = 0; i < 256; i++) mtf[i] = i;
      const unzftab = new Int32Array(256);
      let nblock = 0, groupNo = -1, groupPos = 0, table = null, run = 0, runBit = 1;
      for (;;) {
        if (groupPos === 0) { groupNo++; if (groupNo >= nSelectors) throw new Error('bzip2: ran out of selectors'); groupPos = 50; table = tables[selectors[groupNo]]; }
        groupPos--;
        let l = table.minLen, v = br.read(l);
        while (v > table.limit[l]) { l++; if (l > table.maxLen) throw new Error('bzip2: bad code'); v = (v << 1) | br.read1(); }
        const sym = table.perm[v + table.base[l]];
        if (sym <= 1) { run += (sym + 1) * runBit; runBit <<= 1; continue; }                          // RUNA / RUNB: a run of the front symbol
        if (run) {
          const b = seqToUnseq[mtf[0]];
          if (nblock + run > blockMax) throw new Error('bzip2: block too large');
          unzftab[b] += run; while (run--) tt[nblock++] = b;
          run = 0; runBit = 1;
        }
        if (sym === EOB) break;
        if (nblock >= blockMax) throw new Error('bzip2: block too large');
        const idx = sym - 1;
        const mv = mtf[idx]; mtf.copyWithin(1, 0, idx); mtf[0] = mv;
        const b = seqToUnseq[mv];
        unzftab[b]++; tt[nblock++] = b;
      }
      if (origPtr >= nblock && nblock) throw new Error('bzip2: bad origin pointer');
      // inverse BWT
      const cftab = new Int32Array(257);
      for (let i = 0; i < 256; i++) cftab[i + 1] = cftab[i] + unzftab[i];
      for (let i = 0; i < nblock; i++) { const b = tt[i] & 0xFF; tt[cftab[b]++] |= (i << 8); }
      // walk it, undoing the first run-length step (4 equal bytes, then a count of 0..255 more)
      let pos = nblock ? tt[origPtr] >>> 8 : 0, prev = -1, same = 0;
      for (let i = 0; i < nblock; i++) {
        const e = tt[pos]; pos = e >>> 8;
        const b = e & 0xFF;
        if (same === 4) { for (let k = 0; k < b; k++) put(prev); same = 0; prev = -1; continue; }
        if (b === prev) same++; else { same = 1; prev = b; }
        put(b);
      }
    }
  }
  if (outLen) onData(out.subarray(0, outLen));
  if (!streams) throw new Error('bzip2: no data');
}

/* ---------------- tar ---------------- */
const str = (b, off, len) => { let e = off; while (e < off + len && b[e] !== 0) e++; return Buffer.from(b.buffer, b.byteOffset + off, e - off).toString('utf8'); };
const oct = (b, off, len) => { const t = str(b, off, len).trim(); return t ? parseInt(t, 8) : 0; };

/** a path from an archive, made safe: relative, forward slashes, no '..', no drive letter, no empty parts; '' when it is not */
function safeRel(name) {
  const n = String(name).replace(/\\/g, '/');
  if (!n || n.startsWith('/') || /^[A-Za-z]:/.test(n) || n.includes('\0')) return '';
  const parts = n.split('/').filter((p) => p && p !== '.');
  if (!parts.length || parts.some((p) => p === '..' || /[<>:"|?*]/.test(p))) return '';
  return parts.join('/');
}

/** feed output pieces of a tar stream in: onEntry({name, size, isDir}) then onChunk(Buffer) for a file's bytes then onEnd(); never writes anything itself */
class TarReader {
  constructor({ onFile, onDir }) {
    this.onFile = onFile; this.onDir = onDir;
    this.head = Buffer.alloc(512); this.hn = 0; this.left = 0; this.pad = 0; this.cur = null; this.longName = ''; this.paxPath = ''; this.meta = null; this.metaBuf = []; this.ended = false;
  }
  push(chunk) {
    let i = 0;
    while (i < chunk.length && !this.ended) {
      if (this.left > 0) {
        const n = Math.min(this.left, chunk.length - i);
        const piece = chunk.subarray(i, i + n);
        if (this.meta) this.metaBuf.push(Buffer.from(piece)); else if (this.cur) this.cur.write(piece);
        this.left -= n; i += n;
        if (this.left === 0) { this._endBody(); this.pad = (512 - (this.size % 512)) % 512; }
        continue;
      }
      if (this.pad > 0) { const n = Math.min(this.pad, chunk.length - i); this.pad -= n; i += n; continue; }
      const n = Math.min(512 - this.hn, chunk.length - i);
      this.head.set(chunk.subarray(i, i + n), this.hn); this.hn += n; i += n;
      if (this.hn === 512) { this.hn = 0; this._header(); }
    }
  }
  _endBody() {
    if (this.meta) {
      const text = Buffer.concat(this.metaBuf).toString('utf8'); this.metaBuf = [];
      if (this.meta === 'L') this.longName = text.replace(/\0.*$/s, '');
      else { const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text); if (m) this.paxPath = m[1]; }
      this.meta = null;
    } else if (this.cur) { this.cur.end(); this.cur = null; }
  }
  _header() {
    const h = this.head;
    if (h.every((b) => b === 0)) { this.zero = (this.zero || 0) + 1; if (this.zero >= 2) this.ended = true; return; }
    this.zero = 0;
    const type = String.fromCharCode(h[156] || 48);
    const size = oct(h, 124, 12);
    this.size = size;
    const prefix = str(h, 345, 155);
    let name = (str(h, 257, 5) === 'ustar' && prefix ? prefix + '/' : '') + str(h, 0, 100);
    if (type === 'L' || type === 'x') { this.meta = type === 'L' ? 'L' : 'x'; this.left = size; if (!size) this._endBody(); return; }
    if (type === 'g') { this.left = 0; this.pad = (512 - (size % 512)) % 512 + size; return; }
    if (this.longName) { name = this.longName; this.longName = ''; }
    if (this.paxPath) { name = this.paxPath; this.paxPath = ''; }
    if (type === '5') { this.onDir(name); return; }
    if (type === '0' || type === '\0' || type === '7') {
      this.cur = this.onFile(name, size);
      if (size === 0) { if (this.cur) this.cur.end(); this.cur = null; return; }
      this.left = size; return;
    }
    // links, devices and anything else are skipped with their data
    this.left = 0; this.pad = (512 - (size % 512)) % 512 + size;
  }
}

/** unpack a .tar.bz2 (read whole into memory) under destDir (filter(rel) = false skips an entry); only regular files and folders, only under `top/`, every path checked. Returns [{rel, bytes}] */
function extractTarBz2(archive, destDir, { top = '', filter = null, onProgress = () => {} } = {}) {
  const buf = fs.readFileSync(archive);
  const root = path.resolve(destDir);
  const made = [];
  const dest = (name) => {
    const rel = safeRel(name);
    if (!rel) throw new Error('unsafe path in archive: ' + String(name).slice(0, 80));
    if (top && rel !== top && !rel.startsWith(top + '/')) throw new Error('unexpected path in archive: ' + rel.slice(0, 80));
    const full = path.resolve(root, rel);
    if (full !== root && !full.startsWith(root + path.sep)) throw new Error('path escapes the folder: ' + rel.slice(0, 80));
    return { rel, full };
  };
  const tar = new TarReader({
    onDir: (name) => { const d = dest(name); if (!filter || filter(d.rel)) fs.mkdirSync(d.full, { recursive: true }); },
    onFile: (name, size) => {
      const { rel, full } = dest(name);
      if (filter && !filter(rel)) return null;                  // not wanted: its bytes are read past and dropped
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const fd = fs.openSync(full, 'w'); const rec = { rel, bytes: 0 };
      return { write: (b) => { fs.writeSync(fd, b); rec.bytes += b.length; }, end: () => { fs.closeSync(fd); made.push(rec); if (rec.bytes !== size) throw new Error('short file in archive: ' + rel); } };
    },
  });
  let done = 0;
  bunzip2(buf, (piece) => { tar.push(piece); done += piece.length; onProgress(done); });
  return made;
}

module.exports = { bunzip2, TarReader, extractTarBz2, safeRel };
