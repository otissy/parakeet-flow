'use strict';
/* Real Parakeet + Silero VAD through the Segmenter, audio pushed as fast as it can go (not paced). */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const U = require('./util');

const ok = U.modelsPresent() && U.ensureFixtures();
const skip = ok ? false : 'models or fixtures missing (UNVERIFIED)';

test('real engine: en-pause splits at the pause into two immutable finals with text', { skip }, () => {
  const { createSherpaEngine, createSileroVad } = require(path.join(root, 'src/asr/engine-sherpa.js'));
  const { Segmenter } = require(path.join(root, 'src/asr/segmenter.js'));
  const engine = createSherpaEngine({ modelDir: U.MODEL_DIR });
  const vad = createSileroVad({ modelPath: U.VAD, minSilence: 0.5 });
  const seg = new Segmenter({ engine, vad });
  const ev = [];
  for (const e of ['partial', 'final', 'endpoint', 'done']) seg.on(e, (p) => ev.push({ e, ...p }));
  const a = U.readWav(path.join(U.FIX, 'en-pause.wav'));
  seg.start();
  for (let i = 0; i < a.length; i += 512) seg.pushAudio(a.subarray(i, i + 512));
  seg.release();
  const finals = ev.filter((x) => x.e === 'final');
  assert.equal(finals.length, 2, 'two segments around the 1.3 s pause');
  assert.equal(finals[0].reason, 'pause');
  assert.ok(finals.every((f) => f.text.length > 10));
  assert.match(finals[0].text.toLowerCase(), /meeting/);
  assert.match(finals[1].text.toLowerCase(), /reports/);
  assert.equal(ev.at(-1).e, 'done');
});

test('real engine: Dutch fixture decodes to non-empty text (no WER claim: TTS accent)', { skip }, () => {
  const { createSherpaEngine } = require(path.join(root, 'src/asr/engine-sherpa.js'));
  const engine = createSherpaEngine({ modelDir: U.MODEL_DIR });
  const r = engine.decode(U.readWav(path.join(U.FIX, 'nl1.wav')));
  assert.ok(r.text.split(' ').length >= 8);
});
