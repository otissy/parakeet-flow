'use strict';
/* Deterministic stand-ins for the VAD and the engine, plus a fake ASR host (same interface as AsrHost). */
const { EventEmitter } = require('events');
const { Segmenter } = require('../../src/asr/segmenter');

const CH = 512; // 32 ms
const loud = (n = CH) => new Float32Array(n).fill(0.3);
const quiet = (n = CH) => new Float32Array(n);

class FakeVad {
  constructor({ silenceChunks = 16 } = {}) { this.silenceChunks = silenceChunks; this.reset(); }
  reset() { this.inSpeech = false; this.sil = 0; this.queue = 0; }
  acceptWaveform(f) {
    const speech = f[0] > 0.1;
    if (speech) { this.inSpeech = true; this.sil = 0; }
    else if (this.inSpeech && ++this.sil >= this.silenceChunks) { this.inSpeech = false; this.queue++; this.sil = 0; }
  }
  isDetected() { return this.inSpeech; }
  isEmpty() { return this.queue === 0; }
  pop() { this.queue--; }
}

/** engine: N words per second of audio: "w1 w2 ...", final variant adds a period */
class FakeEngine {
  constructor(wps = 2) { this.wps = wps; this.calls = 0; }
  decode(f) {
    this.calls++;
    const n = Math.floor(f.length / 16000 * this.wps);
    return { text: Array.from({ length: n }, (_, i) => 'w' + (i + 1)).join(' '), ms: 1 };
  }
}

function mkSegmenter(o = {}) {
  let t = 0;
  const engine = o.engine || new FakeEngine();
  const seg = new Segmenter({ engine, vad: o.vad || new FakeVad(), now: () => t, partialIntervalMs: 400, ...o });
  const events = [];
  for (const ev of ['segment-start', 'partial', 'final', 'endpoint', 'done']) seg.on(ev, (p) => events.push({ ev, ...p }));
  const push = (f) => { t += 32; seg.pushAudio(f); };
  return { seg, engine, events, push, time: () => t };
}

/** fake host driven by a scripted function; mirrors AsrHost's start()/sid contract */
class FakeHost extends EventEmitter {
  constructor() { super(); this.sid = 0; this.calls = []; }
  start() { this.calls.push('start'); return ++this.sid; }
  pushAudio() {} release() { this.calls.push('release'); } cancel() { this.calls.push('cancel'); }
  emitEv(ev, p) { this.emit(ev, { sid: this.sid, ...p }); }
}

module.exports = { FakeVad, FakeEngine, FakeHost, mkSegmenter, loud, quiet, CH };
