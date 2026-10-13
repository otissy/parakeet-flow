'use strict';
/* Official, hash-pinned download of the local LLM weights. Nothing is bundled.
   - model: Qwen/Qwen3-0.6B-GGUF (huggingface.co/Qwen, the model authors' own GGUF repo; Apache-2.0), Q8_0 file.
     The SHA-256 and size are that file's Hugging Face LFS oid. It goes into <userData>/models next to the speech model.
   - runtime: node-llama-cpp 3.22.1 + @node-llama-cpp/win-x64 (prebuilt CPU binary), installed by npm into llm-runtime/
     (integrity pinned by llm-runtime/package-lock.json); nothing is compiled.
   A file whose hash differs is deleted, never used. https only (http only for 127.0.0.1, which the tests use). */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const MODEL = {
  rel: 'Qwen3-0.6B-Q8_0.gguf', repo: 'Qwen/Qwen3-0.6B-GGUF',
  url: 'https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf',
  bytes: 639446688, sha256: '9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031',
};
const RUNTIME_ENTRY = path.join(__dirname, '..', '..', 'llm-runtime', 'node_modules', 'node-llama-cpp', 'dist', 'index.js');

const modelPath = (modelsDir, spec = MODEL) => path.join(modelsDir, spec.rel);
const runtimeInstalled = (entry = RUNTIME_ENTRY) => fs.existsSync(entry);

function sha256File(file) {
  return new Promise((res, rej) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej);
  });
}

/** {ok, missing:boolean, bad:boolean} for the model file */
async function verify(modelsDir, { spec = MODEL, quick = false } = {}) {
  const p = modelPath(modelsDir, spec);
  if (!fs.existsSync(p)) return { ok: false, missing: true, bad: false };
  if (fs.statSync(p).size !== spec.bytes) return { ok: false, missing: false, bad: true };
  if (quick) return { ok: true, missing: false, bad: false };
  const ok = (await sha256File(p)) === spec.sha256;
  return { ok, missing: false, bad: !ok };
}

function download(url, dest, { onBytes, rate = 0, redirects = 6 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const loop = u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
    if (u.protocol !== 'https:' && !loop) return reject(new Error('refusing non-https download'));
    const req = (loop ? http : https).get(url, { headers: { 'User-Agent': 'parakeet-flow' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dest, { onBytes, rate, redirects: redirects - 1 }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${u.host}`)); }
      const out = fs.createWriteStream(dest);
      const h = crypto.createHash('sha256');
      let got = 0; const started = Date.now();
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

/** fetch the model if missing or wrong; verified before it moves into place */
async function ensureModel(modelsDir, { spec = MODEL, onProgress, rate = 0 } = {}) {
  const st = await verify(modelsDir, { spec });
  const dest = modelPath(modelsDir, spec);
  if (st.ok) return dest;
  fs.mkdirSync(modelsDir, { recursive: true });
  const part = dest + '.part';
  const r = await download(spec.url, part, { rate, onBytes: (g, t) => onProgress && onProgress({ file: spec.rel, got: g, total: t || spec.bytes }) });
  if (r.sha256 !== spec.sha256 || (spec.bytes && r.bytes !== spec.bytes)) { fs.rmSync(part, { force: true }); throw new Error(`hash mismatch for ${spec.rel}: download deleted`); }
  fs.renameSync(part, dest);
  return dest;
}

module.exports = { MODEL, RUNTIME_ENTRY, modelPath, runtimeInstalled, verify, ensureModel, download, sha256File };
