'use strict';
/* Decode the synthesised carrier sentences with the real Parakeet engine (same recognizer config as the app) and record what it wrote.
   usage: node measure.js <wav dir with manifest.json> <out.json>
   result row: {term, text, heard}  heard = the part between "Yeah," and "that was something" */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..', '..');
const { createSherpaEngine } = require(path.join(root, 'src/asr/engine-sherpa.js'));

const MODEL_DIR = path.join(process.env.APPDATA || '', 'parakeet-flow', 'models', 'parakeet-tdt-0.6b-v3-int8');

function readWav(file) {
  const b = fs.readFileSync(file);
  const at = b.indexOf('data') + 8;
  const n = (b.length - at) >> 1;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = b.readInt16LE(at + 2 * i) / 32768;
  return a;
}
/** what Parakeet wrote for the term itself */
function cutTerm(text) {
  const m = /^\W*yeah\W*(.*?)\W*that was something\W*$/is.exec(text);
  return m ? m[1].replace(/^[\s,.!?;:]+|[\s,.!?;:]+$/g, '') : null;
}

if (require.main === module) {
  const [dir, out] = process.argv.slice(2);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const engine = createSherpaEngine({ modelDir: MODEL_DIR, numThreads: 4, provider: 'cpu' });
  const rows = [];
  const t0 = Date.now();
  for (const m of manifest) {
    const r = engine.decode(readWav(path.join(dir, m.wav)));
    rows.push({ term: m.term, text: r.text, heard: cutTerm(r.text) });
    if (rows.length % 100 === 0) console.log(rows.length, 'of', manifest.length, Math.round((Date.now() - t0) / 1000) + 's');
  }
  fs.writeFileSync(out, JSON.stringify(rows, null, 1));
  console.log('done', rows.length, 'rows,', Math.round((Date.now() - t0) / 1000), 's');
}
module.exports = { cutTerm, readWav, MODEL_DIR };
