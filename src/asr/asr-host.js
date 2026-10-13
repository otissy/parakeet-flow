'use strict';
/* AsrHost: the pluggable ASR interface the rest of the app sees.
     await host.ready(); host.start(); host.pushAudio(f32); host.release(); host.cancel(); host.close()
   events: 'partial' {segId,text} 'final' {segId,text,reason} 'endpoint' {segId,reason} 'segment-start' 'done'
   Another engine only has to provide the same shape (see the Segmenter's injected engine). */
const { Worker } = require('worker_threads');
const { EventEmitter } = require('events');
const path = require('path');

class AsrHost extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = { numThreads: 4, provider: 'cpu', partialIntervalMs: 400, capSec: 9, endpointMs: 500, ...opts };
    this.worker = new Worker(path.join(__dirname, 'asr-worker.js'), { workerData: this.opts });
    this._ready = new Promise((res, rej) => { this._res = res; this._rej = rej; });
    this.worker.on('message', (m) => {
      if (m.ev === 'ready') { this.info = m; this._res(m); }
      else this.emit(m.ev, m);
    });
    this.worker.on('error', (e) => { this._rej(e); if (this.listenerCount('error')) this.emit('error', e); });
  }
  ready() { return this._ready; }
  /** begin a session; returns its id (events carry it as `sid`) */
  start() { const sid = (this._sid = (this._sid || 0) + 1); this.worker.postMessage({ cmd: 'start', sid }); return sid; }
  pushAudio(f32) { const c = f32.slice(); this.worker.postMessage({ cmd: 'push', samples: c }, [c.buffer]); }
  release() { this.worker.postMessage({ cmd: 'release' }); }
  /** Silero VAD speech threshold for the next session (whisper mode lowers it); ordered before the next start() */
  setVad(threshold) { this.worker.postMessage({ cmd: 'vad', threshold }); }
  cancel() { this.worker.postMessage({ cmd: 'cancel' }); }
  async close() { await this.worker.terminate(); }
}

module.exports = { AsrHost };
