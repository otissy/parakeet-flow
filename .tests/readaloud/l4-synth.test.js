'use strict';
/* Offline synthesis with the REAL runtime (sherpa-onnx-node, the one the installer ships) and the REAL Kokoro pack, through the app's own
   TtsHost + worker: one line to a WAV file, streamed in pieces, cancelled mid-way. The pack is not in the repo (350 MB): point PF_TTS_PACK_DIR at an
   unpacked kokoro-multi-lang-v1_0 folder (the app's own download puts it in <userData>/models/tts/kokoro-multi-lang-v1_0). Skipped when it is absent.
   The WAV goes to proof/read-aloud-sample.wav (git-ignored). Nothing is played. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { TtsHost } = require(path.join(root, 'src/readaloud/tts-host.js'));
const MS = require(path.join(root, 'src/readaloud/model-store.js'));
const { sidOf } = require(path.join(root, 'src/readaloud/voices.js'));
const { chunkText } = require(path.join(root, 'src/readaloud/chunker.js'));

const PACK = process.env.PF_TTS_PACK_DIR || 'C:/builds/parakeet-flow/_ttsmodel/x3/kokoro-multi-lang-v1_0';
const have = fs.existsSync(path.join(PACK, 'model.onnx'));
const skip = have ? false : 'no unpacked Kokoro pack (set PF_TTS_PACK_DIR)';
const files = () => ({ model: path.join(PACK, 'model.onnx'), voices: path.join(PACK, 'voices.bin'), tokens: path.join(PACK, 'tokens.txt'), dataDir: path.join(PACK, 'espeak-ng-data'), lexicon: [path.join(PACK, 'lexicon-us-en.txt'), path.join(PACK, 'lexicon-gb-en.txt')].join(',') });

function wav16(f32, rate) {
  const n = f32.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767))), 44 + i * 2);
  return b;
}

test('the pinned file hashes and sizes match the real pack on disk (so the download check is checking the right thing)', { skip, timeout: 120000 }, async () => {
  const r = await MS.verifyDir(PACK, MS.PACK);
  assert.deepEqual(r, { ok: true, missing: [], bad: [] });
});

test('one line is synthesized offline to a WAV with the bundled runtime, bm_george, streamed in pieces', { skip, timeout: 120000 }, async () => {
  const host = new TtsHost({ files: files(), numThreads: 2 });
  try {
    const text = 'Hello, this is Bob reading your selection aloud. It works completely offline.';
    const { chunks } = chunkText(text);
    const got = [];
    let rate = 0, firstAt = 0; const t0 = Date.now();
    for (const piece of chunks) {
      await host.speak(piece, { sid: sidOf('bm_george'), speed: 1, onSamples: (f, r) => { if (!firstAt) firstAt = Date.now() - t0; rate = r; got.push(Float32Array.from(f)); } });
    }
    assert.equal(rate, 24000);
    const all = new Float32Array(got.reduce((s, a) => s + a.length, 0));
    let o = 0; for (const a of got) { all.set(a, o); o += a.length; }
    const sec = all.length / rate;
    assert.ok(sec > 3 && sec < 12, 'a believable length for the line: ' + sec.toFixed(2) + ' s');
    let peak = 0, energy = 0; for (const v of all) { peak = Math.max(peak, Math.abs(v)); energy += v * v; }
    assert.ok(peak > 0.1 && peak <= 1.0001, 'audible, not clipped to garbage: peak ' + peak);
    assert.ok(Math.sqrt(energy / all.length) > 0.01, 'real speech energy');
    const file = path.join(root, 'proof', 'read-aloud-sample.wav');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, wav16(all, rate));
    const st = fs.statSync(file);
    assert.ok(st.size > 44 + 3 * 24000 * 2);
    const h = fs.readFileSync(file).subarray(0, 44);
    assert.equal(h.toString('ascii', 0, 4), 'RIFF'); assert.equal(h.readUInt32LE(24), 24000);
    process.stdout.write(`# synth: ${chunks.length} pieces, ${sec.toFixed(2)} s of audio, first audio after ${firstAt} ms, total ${Date.now() - t0} ms, ${path.basename(file)} ${st.size} bytes\n`);
  } finally { host.close(); }
});

test('cancel stops a long synthesis promptly and the engine speaks again afterwards', { skip, timeout: 120000 }, async () => {
  const host = new TtsHost({ files: files(), numThreads: 2 });
  try {
    const long = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} is part of a longer text that we stop part of the way through.`).join(' ');
    let pieces = 0;
    const p = host.speak(long, { sid: sidOf('bm_george'), speed: 1.4, onSamples: () => { pieces++; if (pieces === 1) host.cancel(); } });
    const r = await p;
    assert.equal(r.cancelled, true);
    assert.ok(pieces < 12, 'stopped after ' + pieces + ' of ~12 sentences');
    const after = []; await host.speak('Back again.', { sid: sidOf('af_bella'), speed: 1, onSamples: (f) => after.push(f.length) });
    assert.ok(after.length >= 1, 'a second reading works with another voice');
  } finally { host.close(); }
});
