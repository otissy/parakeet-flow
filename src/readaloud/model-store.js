'use strict';
/* The read-aloud voice: Kokoro v1.0 multi-lang (fp32), the k2-fsa / sherpa-onnx pack. NOT bundled in the installer (350 MB would more than
   double it): downloaded once, only when the user presses "Download voice" in Settings > Read aloud, into <userData>/models/tts.
   Source: github.com/k2-fsa/sherpa-onnx, release "tts-models", asset kokoro-multi-lang-v1_0.tar.bz2, uploaded by csukuangfj (the
   sherpa-onnx author). The SHA-256 below is GitHub's own asset digest for that file, checked when this was written; the download is
   hashed while it arrives and is deleted unless it matches. Then it is unpacked by our own bzip2/tar reader (no tar.exe) into a
   temporary folder, only the files listed here are kept, each is checked by size and SHA-256, and the folder is renamed into place. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { download, sha256File } = require('../asr/model-store');

const PACK = {
  id: 'kokoro-multi-lang-v1_0',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2',
  bytes: 349886476,
  sha256: '60703707bc05ccd48d60e1eb723f38b07d6e474795a0b6a588d7220400e0f7a4',
  top: 'kokoro-multi-lang-v1_0',
  files: [
    { rel: 'model.onnx', bytes: 325560556, sha256: 'b40f62b166ac8164b0627ef48a0b358eda0985e272fb03ef5252e7206305da11' },
    { rel: 'voices.bin', bytes: 28200960, sha256: '1c5a5b983d3d50d8586d437a51f3faa2da7919ce76a013c081e65671a3447c29' },
    { rel: 'tokens.txt', bytes: 687, sha256: '6ebb6bb288f20f3ae8d004d3c2ca27697da27c037d75e81a60e2a6a663f95425' },
    { rel: 'lexicon-us-en.txt', bytes: 5956885, sha256: '7daaab53a181be9885b853a8582bf1838186317e5dadacbcef9c426d6fa0da14' },
    { rel: 'lexicon-gb-en.txt', bytes: 6366635, sha256: 'c4cbb37316f62210dff52718a7afcaae24f50c032cc75ab47ae67b831d1049e7' },
  ],
  keepDirs: ['espeak-ng-data/'],          // phonemizer data (355 small files); checked by file count
  espeakFiles: 355,
  extra: ['LICENSE', 'README.md'],
};

/** where the pack lives and the paths the engine needs */
function paths(modelsDir, pack = PACK) {
  const dir = path.join(modelsDir, 'tts', pack.id);
  return {
    dir, model: path.join(dir, 'model.onnx'), voices: path.join(dir, 'voices.bin'), tokens: path.join(dir, 'tokens.txt'),
    dataDir: path.join(dir, 'espeak-ng-data'), lexicon: [path.join(dir, 'lexicon-us-en.txt'), path.join(dir, 'lexicon-gb-en.txt')].join(','),
  };
}

const countFiles = (d) => { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(d, e.name)) : 1; return n; };

/** {ok, missing:[rel], bad:[rel]}. quick = sizes only; otherwise every file is hashed too */
async function status(modelsDir, { quick = true, pack = PACK } = {}) {
  const p = paths(modelsDir, pack);
  const missing = [], bad = [];
  for (const f of pack.files) {
    const file = path.join(p.dir, f.rel);
    if (!fs.existsSync(file)) { missing.push(f.rel); continue; }
    if (fs.statSync(file).size !== f.bytes) { bad.push(f.rel); continue; }
    if (!quick && (await sha256File(file)) !== f.sha256) bad.push(f.rel);
  }
  if (!fs.existsSync(p.dataDir)) missing.push('espeak-ng-data');
  else if (pack.espeakFiles && countFiles(p.dataDir) !== pack.espeakFiles) bad.push('espeak-ng-data');
  return { ok: !missing.length && !bad.length, missing, bad };
}

/** unpack in a worker thread: it takes seconds of CPU and must not stall the app */
function unpack(archive, dest, pack, onProgress) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'unpack-worker.js'), { workerData: { archive, dest, top: pack.top, keepDirs: pack.keepDirs, keepFiles: [...pack.files.map((f) => f.rel), ...pack.extra] } });
    w.on('message', (m) => { if (m.ev === 'progress') onProgress && onProgress(m.done); else if (m.ev === 'done') resolve(m.files); else if (m.ev === 'error') reject(new Error(m.message)); });
    w.on('error', reject);
    w.on('exit', (c) => { if (c !== 0) reject(new Error('unpack worker exited with ' + c)); });
  });
}

/** download (if needed), verify, unpack, verify, move into place. onProgress({phase:'download'|'unpack'|'verify', pct}). Returns paths. Throws on any mismatch, leaving nothing half-installed */
async function ensure(modelsDir, { onProgress = () => {}, pack = PACK, fetchArchive = download, rate = 0 } = {}) {
  const st = await status(modelsDir, { quick: false, pack });
  if (st.ok) return paths(modelsDir, pack);
  const root = path.join(modelsDir, 'tts');
  fs.mkdirSync(root, { recursive: true });
  const archive = path.join(root, pack.id + '.tar.bz2.part');
  const tmp = path.join(root, '.unpack-' + crypto.randomBytes(4).toString('hex'));
  try {
    fs.rmSync(archive, { force: true });
    const r = await fetchArchive(pack.url, archive, { rate, onBytes: (got, total) => onProgress({ phase: 'download', pct: Math.min(100, (got / (total || pack.bytes)) * 100) }) });
    if (r.sha256 !== pack.sha256 || r.bytes !== pack.bytes) throw new Error('hash mismatch for the voice pack: download deleted');
    onProgress({ phase: 'unpack', pct: 0 });
    fs.mkdirSync(tmp, { recursive: true });
    await unpack(archive, tmp, pack, (done) => onProgress({ phase: 'unpack', pct: Math.min(99, (done / 380e6) * 100) }));
    onProgress({ phase: 'verify', pct: 99 });
    const stage = path.join(tmp, pack.top);
    // the unpacked folder must hold exactly what the pack promises, with the right hashes, before it replaces anything
    const chk = await verifyDir(stage, pack);
    if (!chk.ok) throw new Error('the voice pack failed its check (' + [...chk.missing, ...chk.bad].join(', ') + '): nothing installed');
    const final = paths(modelsDir, pack).dir;
    fs.rmSync(final, { recursive: true, force: true });
    fs.renameSync(stage, final);
    onProgress({ phase: 'verify', pct: 100 });
    return paths(modelsDir, pack);
  } finally {
    fs.rmSync(archive, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** the same check as status(), on any folder */
async function verifyDir(dir, pack = PACK) {
  const missing = [], bad = [];
  for (const f of pack.files) {
    const file = path.join(dir, f.rel);
    if (!fs.existsSync(file)) { missing.push(f.rel); continue; }
    if (fs.statSync(file).size !== f.bytes || (await sha256File(file)) !== f.sha256) bad.push(f.rel);
  }
  const d = path.join(dir, 'espeak-ng-data');
  if (!fs.existsSync(d)) missing.push('espeak-ng-data'); else if (pack.espeakFiles && countFiles(d) !== pack.espeakFiles) bad.push('espeak-ng-data');
  return { ok: !missing.length && !bad.length, missing, bad };
}

/** remove the voice (Settings > Read aloud > Remove) */
function remove(modelsDir, pack = PACK) { fs.rmSync(path.join(modelsDir, 'tts'), { recursive: true, force: true }); }

module.exports = { PACK, paths, status, ensure, verifyDir, remove };
