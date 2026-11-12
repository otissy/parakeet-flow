'use strict';
/* TtsHost: the voice engine in a worker thread, started on first use and stopped after it has been idle for a while (the model holds about 400 MB).
     await host.speak(text, {sid, speed, onSamples(Float32Array, sampleRate)}) -> {ms, samples, cancelled}
     host.cancel()  stops the running speak; host.close() ends the worker. `makeWorker` is replaceable for tests. */
const { Worker } = require('worker_threads');
const path = require('path');

class TtsHost {
  constructor({ files, numThreads = 2, idleMs = 5 * 60 * 1000, makeWorker = null, setTimer = (f, ms) => { const t = setTimeout(f, ms); if (t.unref) t.unref(); return t; }, clearTimer = clearTimeout }) {
    Object.assign(this, { files, numThreads, idleMs, setTimer, clearTimer });
    this.makeWorker = makeWorker || ((data) => new Worker(path.join(__dirname, 'tts-worker.js'), { workerData: data }));
    this.worker = null; this.ready = null; this.sampleRate = 24000; this.jobs = new Map(); this.nextId = 1; this.idle = null;
  }
  _start() {
    if (this.worker) return this.ready;
    const w = this.worker = this.makeWorker({ ...this.files, numThreads: this.numThreads });
    this.ready = new Promise((res, rej) => { this._res = res; this._rej = rej; });
    this.ready.catch(() => {});
    w.on('message', (m) => {
      if (w !== this.worker) return;
      if (m.ev === 'ready') { this.sampleRate = m.sampleRate; this._res(m); return; }
      if (m.ev === 'error' && m.id === undefined) { this._rej(new Error(m.message)); this._drop(new Error(m.message)); return; }
      const j = this.jobs.get(m.id);
      if (!j) return;
      if (m.ev === 'samples') { if (j.onSamples) j.onSamples(m.samples, this.sampleRate); }
      else if (m.ev === 'done') { this.jobs.delete(m.id); j.resolve({ ms: m.ms, samples: m.samples, cancelled: !!m.cancelled }); this._arm(); }
      else if (m.ev === 'error') { this.jobs.delete(m.id); j.reject(new Error(m.message)); this._arm(); }
    });
    w.on('error', (e) => { if (w === this.worker) { this._rej(e); this._drop(e); } });
    w.on('exit', () => { if (w === this.worker) { const e = new Error('voice engine stopped'); this._rej(e); this._drop(e); } });
    return this.ready;
  }
  _drop(err) {
    const w = this.worker; this.worker = null; this.ready = null;
    for (const j of this.jobs.values()) j.reject(err);
    this.jobs.clear();
    if (w) { try { w.terminate(); } catch (_) { /* gone */ } }
  }
  _arm() {
    if (this.idle) this.clearTimer(this.idle);
    this.idle = this.jobs.size ? null : this.setTimer(() => { this.idle = null; if (!this.jobs.size) this.close(); }, this.idleMs);
  }
  /** resolves when the text has been synthesized (or cancelled). Rejects if the engine cannot start or fails */
  async speak(text, { sid, speed = 1, onSamples } = {}) {
    if (this.idle) { this.clearTimer(this.idle); this.idle = null; }
    await this._start();
    const w = this.worker;
    if (!w) throw new Error('voice engine stopped');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject, onSamples });
      w.postMessage({ cmd: 'speak', id, text, sid, speed });
    });
  }
  cancel() { if (this.worker) for (const id of this.jobs.keys()) this.worker.postMessage({ cmd: 'cancel', id }); }
  loaded() { return !!this.worker; }
  close() {
    if (this.idle) { this.clearTimer(this.idle); this.idle = null; }
    const w = this.worker; if (!w) return;
    this.worker = null; this.ready = null;
    for (const j of this.jobs.values()) j.reject(new Error('voice engine stopped'));
    this.jobs.clear();
    try { w.postMessage({ cmd: 'close' }); const t = setTimeout(() => { try { w.terminate(); } catch (_) { /* gone */ } }, 500); if (t.unref) t.unref(); } catch (_) { /* gone */ }
  }
}

module.exports = { TtsHost };
