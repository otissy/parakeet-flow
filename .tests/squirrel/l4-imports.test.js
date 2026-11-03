'use strict';
/* L4: a clean Windows PC has the Windows system DLLs but NOT the Visual C++ redistributable. Every native file in the BUILT
   package (PF_BUILDS/<version>/win-unpacked) is read with a small PE import reader; each DLL it imports must be shipped in the
   package or be part of Windows. Visual C++ runtime DLLs (msvcp140, vcruntime140, vcruntime140_1 ...) are not part of Windows,
   so they must be inside the package (next to Parakeet Flow.exe: package.json build.extraFiles). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const built = path.join(process.env.PF_BUILT_DIR || path.join(process.env.PF_BUILDS || 'D:/builds/parakeet-flow', require(path.join(root, 'package.json')).version), 'win-unpacked');
const VC = /^(msvcp|vcruntime|msvcr|concrt|vcomp|vccorlib|mfc)\d*/i;

function imports(file) {
  const b = fs.readFileSync(file);
  if (b.length < 0x40 || b.toString('latin1', 0, 2) !== 'MZ') return null;
  const pe = b.readUInt32LE(0x3c);
  if (b.toString('latin1', pe, pe + 2) !== 'PE') return null;
  const nsec = b.readUInt16LE(pe + 6), opt = pe + 24, plus = b.readUInt16LE(opt) === 0x20b;
  const dd = opt + (plus ? 112 : 96), secs = [];
  for (let i = 0, o = opt + b.readUInt16LE(pe + 20); i < nsec; i++, o += 40) secs.push({ va: b.readUInt32LE(o + 12), vs: b.readUInt32LE(o + 8), raw: b.readUInt32LE(o + 20) });
  const off = (r) => { for (const s of secs) if (r >= s.va && r < s.va + Math.max(s.vs, 1)) return r - s.va + s.raw; return -1; };
  const str = (o) => { let e = o; while (b[e]) e++; return b.toString('latin1', o, e).toLowerCase(); };
  if (b.readUInt32LE(dd + 14 * 8)) return null;   // .NET assembly: needs the framework, not DLLs
  const out = [];
  for (const [idx, delay] of [[1, false], [13, true]]) {
    const rva = b.readUInt32LE(dd + idx * 8);
    if (!rva) continue;
    for (let o = off(rva); ; o += delay ? 32 : 20) {
      const nm = delay ? b.readUInt32LE(o + 4) : b.readUInt32LE(o + 12);
      if (!nm) break;
      out.push(str(off(nm)));
    }
  }
  return out;
}

test('every DLL imported by a shipped native file is shipped or part of Windows (no Visual C++ runtime assumed)', { skip: fs.existsSync(built) ? false : 'no built package for this version yet (UNVERIFIED)', timeout: 120000 }, () => {
  const all = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(dll|node|exe)$/i.test(e.name)) all.push(p); } })(built);
  const shipped = new Set(all.map((f) => path.basename(f).toLowerCase()));
  const sys = path.join(process.env.WINDIR || 'C:\Windows', 'System32');
  const missing = [];
  let checked = 0;
  for (const f of all) {
    const imp = imports(f);
    if (!imp) continue;
    checked++;
    for (const name of imp) {
      if (name === 'node.exe' || /^(api|ext)-ms-/.test(name) || shipped.has(name)) continue;
      if (VC.test(name) || !fs.existsSync(path.join(sys, name))) missing.push(`${path.relative(built, f)} imports ${name}`);
    }
  }
  assert.ok(checked > 20, 'native files read: ' + checked);
  assert.deepEqual(missing, []);
  for (const f of ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']) assert.ok(fs.existsSync(path.join(built, f)), f + ' is shipped next to Parakeet Flow.exe');
});
