'use strict';
/* Worker thread: owns the Kokoro engine (sherpa-onnx OfflineTts, the runtime the app already ships for speech recognition).
   Messages in:  {cmd:'speak', id, text, sid, speed} | {cmd:'cancel', id} | {cmd:'close'}
   Messages out: {ev:'ready', sampleRate, speakers} | {ev:'samples', id, samples:Float32Array} | {ev:'done', id, ms, samples, cancelled} | {ev:'error', id?, message}
   Audio is posted as it is made, sentence by sentence, so playback can start before the whole text is synthesized. */
const { parentPort, workerData: o } = require('worker_threads');

let tts = null;
try {
  const sherpa = require('sherpa-onnx-node');
  tts = new sherpa.OfflineTts({
    model: { kokoro: { model: o.model, voices: o.voices, tokens: o.tokens, dataDir: o.dataDir, lexicon: o.lexicon, lang: 'en-us', lengthScale: 1 }, debug: false, numThreads: o.numThreads || 2, provider: 'cpu' },
    maxNumSentences: 1,
  });
  parentPort.postMessage({ ev: 'ready', sampleRate: tts.sampleRate, speakers: tts.numSpeakers });
} catch (e) {
  parentPort.postMessage({ ev: 'error', message: 'voice engine failed to start: ' + String((e && e.message) || e).slice(0, 160) });
  process.exit(1);
}

const cancelled = new Set();
parentPort.on('message', async (m) => {
  if (m.cmd === 'cancel') { cancelled.add(m.id); return; }
  if (m.cmd === 'close') { process.exit(0); }
  if (m.cmd !== 'speak') return;
  const t0 = Date.now();
  let total = 0;
  try {
    await tts.generateAsync({
      text: m.text, sid: m.sid, speed: m.speed, enableExternalBuffer: false,      // Electron does not allow external ArrayBuffers (the promise then fails to settle)
      onProgress: ({ samples }) => {
        if (cancelled.has(m.id)) return 0;                                  // 0 stops the generation after this piece
        const copy = new Float32Array(samples);                             // the engine reuses its buffer
        total += copy.length;
        parentPort.postMessage({ ev: 'samples', id: m.id, samples: copy }, [copy.buffer]);
        return 1;
      },
    });
    parentPort.postMessage({ ev: 'done', id: m.id, ms: Date.now() - t0, samples: total, cancelled: cancelled.has(m.id) });
  } catch (e) {
    parentPort.postMessage({ ev: 'error', id: m.id, message: String((e && e.message) || e).slice(0, 160) });
  } finally { cancelled.delete(m.id); }
});
