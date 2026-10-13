'use strict';
/* Worker thread: owns the engine + VAD + Segmenter so a blocking decode never stalls the app. */
const { parentPort, workerData } = require('worker_threads');
const { createSherpaEngine, createSileroVad } = require('./engine-sherpa');
const { Segmenter } = require('./segmenter');

const o = workerData;
const engine = createSherpaEngine({ modelDir: o.modelDir, numThreads: o.numThreads, provider: o.provider });
const vad = createSileroVad({ modelPath: o.vadPath, minSilence: (o.endpointMs || 500) / 1000 });
const seg = new Segmenter({ engine, vad, partialIntervalMs: o.partialIntervalMs, capSec: o.capSec });
let curSid = 0;
for (const ev of ['segment-start', 'partial', 'final', 'endpoint', 'done']) {
  seg.on(ev, (p) => parentPort.postMessage({ ev, ...p, sid: curSid, workerAt: Date.now() }));
}
parentPort.on('message', (m) => {
  if (m.cmd === 'start') { curSid = m.sid; seg.start(); }
  else if (m.cmd === 'push') seg.pushAudio(m.samples);
  else if (m.cmd === 'release') seg.release();
  else if (m.cmd === 'cancel') seg.cancel();
  else if (m.cmd === 'close') { engine.close(); process.exit(0); }
});
parentPort.postMessage({ ev: 'ready', engine: engine.name, provider: o.provider });
