'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const FIX = path.join(__dirname, '..', 'fixtures');
const CV = path.join(process.env.USERPROFILE || '', '.claude', 'claude-voice');
const MODEL_DIR = path.join(process.env.APPDATA || '', 'parakeet-flow', 'models', 'parakeet-tdt-0.6b-v3-int8');
const VAD = path.join(process.env.APPDATA || '', 'parakeet-flow', 'models', 'silero_vad.onnx');

const modelsPresent = () => fs.existsSync(path.join(MODEL_DIR, 'encoder.int8.onnx')) && fs.existsSync(VAD);

/** the three acceptance utterances (Kokoro TTS, read-only use of the claude-voice model files) */
function ensureFixtures() {
  const need = ['en1', 'nl1', 'en-pause'].filter((n) => !fs.existsSync(path.join(FIX, n + '.wav')));
  if (!need.length) return true;
  const py = path.join(CV, '.venv', 'Scripts', 'python.exe');
  if (!fs.existsSync(py)) return false;
  const r = spawnSync(py, [path.join(FIX, 'gen-audio.py'), CV, FIX], { encoding: 'utf8' });
  return r.status === 0;
}

/** 16 kHz mono 16-bit PCM wav -> Float32Array (44-byte header, as written by ffmpeg -ar 16000 -ac 1) */
function readWav(file) {
  const b = fs.readFileSync(file);
  const at = b.indexOf('data') + 8;
  const n = (b.length - at) >> 1;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = b.readInt16LE(at + 2 * i) / 32768;
  return a;
}

/** first sample (s) whose 20 ms rms exceeds 0.02: where speech starts in a fixture */
function onsetSec(a) {
  const w = 320;
  for (let i = 0; i + w < a.length; i += w) {
    let s = 0; for (let j = i; j < i + w; j++) s += a[j] * a[j];
    if (Math.sqrt(s / w) > 0.02) return i / 16000;
  }
  return 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** feed audio in real time, 32 ms chunks, drift-corrected; returns the wall start */
async function feedRealtime(a, push, chunk = 512) {
  const t0 = Date.now();
  for (let i = 0, k = 0; i < a.length; i += chunk, k++) {
    const due = t0 + (k * chunk / 16000) * 1000;
    const wait = due - Date.now();
    if (wait > 0) await sleep(wait);
    push(a.subarray(i, Math.min(a.length, i + chunk)));
  }
  return t0;
}

module.exports = { FIX, MODEL_DIR, VAD, modelsPresent, ensureFixtures, readWav, onsetSec, feedRealtime, sleep };
