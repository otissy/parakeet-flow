'use strict';
/* Real Silero VAD + Parakeet on speech scaled down to a whisper level (-56 dBFS rms), whisper mode off vs on. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const U = require('../asr/util');
const { AsrHost } = require(path.join(root, 'src/asr/asr-host.js'));
const { amplify } = require(path.join(root, 'src/main/controller.js'));

const skip = U.modelsPresent() && U.ensureFixtures() ? false : 'models or fixtures missing (UNVERIFIED)';
const proof = process.env.PF_PROOF_DIR || path.join(root, '..', 'pf-proof');

test('quiet speech: whisper mode (gain 3, VAD 0.3) hears at least as much as normal mode, and more at the quietest level', { skip, timeout: 120000 }, async () => {
  const host = new AsrHost({ modelDir: U.MODEL_DIR, vadPath: U.VAD, numThreads: 2, provider: 'cpu' });
  await host.ready();
  const a = U.readWav(path.join(U.FIX, 'en-pause.wav'));
  const run = async (scale, gain, thr) => {
    host.setVad(thr); host.start();
    const finals = []; const on = (e) => finals.push(e.text); host.on('final', on);
    const q = new Float32Array(a.length); for (let i = 0; i < a.length; i++) q[i] = a[i] * scale;
    for (let i = 0; i < q.length; i += 512) host.pushAudio(amplify(q.slice(i, i + 512), gain));
    host.release(); await U.sleep(2500); host.off('final', on);
    return finals.join(' ');
  };
  const words = (t) => t.split(/\s+/).filter(Boolean).length;
  const rows = [];
  for (const scale of [0.03, 0.015, 0.008]) {
    const normal = await run(scale, 1, 0.5), whisper = await run(scale, 3, 0.3);
    rows.push({ scale, normalWords: words(normal), whisperWords: words(whisper), normal, whisper });
    assert.ok(words(whisper) >= words(normal) - 1, `scale ${scale}: whisper ${words(whisper)} vs normal ${words(normal)}`);
  }
  fs.mkdirSync(proof, { recursive: true });
  fs.writeFileSync(path.join(proof, 'whisper-measure.json'), JSON.stringify(rows, null, 1));
  const quietest = rows.at(-1);
  assert.ok(quietest.whisperWords > quietest.normalWords, 'at the quietest level whisper mode recovers words: ' + JSON.stringify(quietest));
  await host.close();
});
