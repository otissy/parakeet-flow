'use strict';
/* On-demand, hash-verified model download into <userData>/models. Official sources only:
   - Parakeet TDT 0.6B v3 int8 sherpa-onnx export: huggingface.co/csukuangfj (the sherpa-onnx author's repo for
     the exported NVIDIA nvidia/parakeet-tdt-0.6b-v3 weights). SHA-256 + size are the Hugging Face LFS oids.
   - Silero VAD: github.com/k2-fsa/sherpa-onnx release asset (the file sherpa's own examples use).
   A file whose hash differs is deleted, never used. Nothing is bundled. */
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const HF = 'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/main';
const MODEL_ID = 'parakeet-tdt-0.6b-v3-int8';

const FILES = [
  { rel: `${MODEL_ID}/encoder.int8.onnx`, url: `${HF}/encoder.int8.onnx`, bytes: 652184281, sha256: 'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247' },
  { rel: `${MODEL_ID}/decoder.int8.onnx`, url: `${HF}/decoder.int8.onnx`, bytes: 11845275, sha256: '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e' },
  { rel: `${MODEL_ID}/joiner.int8.onnx`, url: `${HF}/joiner.int8.onnx`, bytes: 6355277, sha256: '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3' },
  { rel: `${MODEL_ID}/tokens.txt`, url: `${HF}/tokens.txt`, bytes: 93939, sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d' },
  { rel: 'silero_vad.onnx', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx', bytes: 643854, sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6' },
];

const paths = (modelsDir) => ({ modelDir: path.join(modelsDir, MODEL_ID), vadPath: path.join(modelsDir, 'silero_vad.onnx') });

function sha256File(file) {
  return new Promise((res, rej) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej);
  });
}

/** status without touching the network: {ok, missing:[rel], bad:[rel]} (hash-checks files that exist) */
async function verify(modelsDir, { quick = false } = {}) {
  const missing = [], bad = [];
  for (const f of FILES) {
    const p = path.join(modelsDir, f.rel);
    if (!fs.existsSync(p)) { missing.push(f.rel); continue; }
    if (f.bytes && fs.statSync(p).size !== f.bytes) { bad.push(f.rel); continue; }
    if (quick) continue;
    if ((await sha256File(p)) !== f.sha256) bad.push(f.rel);
  }
  return { ok: !missing.length && !bad.length, missing, bad };
}

function download(url, dest, { onBytes, rate = 0, redirects = 6 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'parakeet-flow' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dest, { onBytes, rate, redirects: redirects - 1 }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${new URL(url).host}`)); }
      const out = fs.createWriteStream(dest);
      const h = crypto.createHash('sha256');
      let got = 0, started = Date.now();
      res.on('data', (d) => {
        h.update(d); got += d.length; onBytes && onBytes(got, Number(res.headers['content-length'] || 0));
        if (rate && got / ((Date.now() - started) / 1000 + 0.001) > rate) { res.pause(); setTimeout(() => res.resume(), 100); }
      });
      res.pipe(out);
      out.on('finish', () => resolve({ sha256: h.digest('hex'), bytes: got }));
      out.on('error', reject); res.on('error', reject);
    });
    req.on('error', reject);
  });
}

/** fetch whatever is missing or wrong; every file is verified before it is moved into place */
async function ensureModels(modelsDir, { onProgress, rate = 0 } = {}) {
  const st = await verify(modelsDir);
  const todo = FILES.filter((f) => st.missing.includes(f.rel) || st.bad.includes(f.rel));
  for (const f of todo) {
    const dest = path.join(modelsDir, f.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const part = dest + '.part';
    const r = await download(f.url, part, { rate, onBytes: (g, t) => onProgress && onProgress({ file: f.rel, got: g, total: t || f.bytes || 0 }) });
    if (r.sha256 !== f.sha256 || (f.bytes && r.bytes !== f.bytes)) { fs.rmSync(part, { force: true }); throw new Error(`hash mismatch for ${f.rel}: download deleted`); }
    fs.renameSync(part, dest);
  }
  return paths(modelsDir);
}

module.exports = { FILES, MODEL_ID, paths, verify, ensureModels, sha256File, download };
