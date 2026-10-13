'use strict';
/* LlmWorker (host side): the local model as a lazily started worker thread.
   - nothing loads until the first chat() or warm(); after `idleMs` without use the worker is terminated
     (the model is freed) and starts again on the next request
   - chat() has ONE hard deadline that covers load + generation. Past it the caller gets LlmTimeout and the
     generation is cancelled. Callers then type the original text.
   - prompts and replies only travel through memory; nothing is logged. */
const { Worker } = require('worker_threads');
const { EventEmitter } = require('events');
const path = require('path');

class LlmTimeout extends Error { constructor(m = 'llm timeout') { super(m); this.name = 'LlmTimeout'; } }

class LlmWorker extends EventEmitter {
  constructor({ entry, modelPath, threads = 2, idleMs = 5 * 60 * 1000, ctxSize = 2048, workerPath = path.join(__dirname, 'llm-worker.js'), startTimeoutMs = 30000 } = {}) {
    super();
    Object.assign(this, { entry, modelPath, threads, idleMs, ctxSize, workerPath, startTimeoutMs });
    this.worker = null; this.state = 'stopped'; this._ready = null; this._idle = null; this._id = 0; this.pending = new Map();
    this.stats = { starts: 0, requests: 0, timeouts: 0, errors: 0 };
  }

  status() { return { state: this.state, ...this.stats }; }

  _touch() {
    clearTimeout(this._idle);
    if (this.state === 'stopped' || !(this.idleMs > 0)) return;
    this._idle = setTimeout(() => this.stop('idle'), this.idleMs);
    if (this._idle.unref) this._idle.unref();
  }

  _start() {
    if (this._ready) return this._ready;
    this.state = 'starting'; this.stats.starts++;
    const w = new Worker(this.workerPath, { workerData: { entry: this.entry, modelPath: this.modelPath, threads: this.threads, ctxSize: this.ctxSize } });
    this.worker = w;
    let res, rej;
    const ready = new Promise((a, b) => { res = a; rej = b; });
    ready.catch(() => {});
    this._ready = ready;
    const timer = setTimeout(() => { rej(new Error('llm start timeout')); this.stop('start timeout'); }, this.startTimeoutMs);
    if (timer.unref) timer.unref();
    w.on('message', (m) => {
      if (m.ev === 'ready') { clearTimeout(timer); this.state = 'ready'; res(); this.emit('ready'); }
      else if (m.ev === 'fatal') { clearTimeout(timer); rej(new Error(m.message)); this.stop('fatal'); }
      else if (m.ev === 'result' || m.ev === 'error') {
        const p = this.pending.get(m.id); if (!p) return;
        this.pending.delete(m.id);
        if (m.ev === 'result') p.res(String(m.text || '')); else p.rej(Object.assign(new Error(m.message), { aborted: !!m.aborted }));
      }
    });
    w.on('error', (e) => { clearTimeout(timer); rej(e); this._dead(w); });
    w.on('exit', () => { clearTimeout(timer); rej(new Error('llm worker exited')); this._dead(w); });
    w.postMessage({ cmd: 'warm' });
    return ready;
  }

  _dead(w) {
    if (this.worker !== w) return;
    this.worker = null; this.state = 'stopped'; this._ready = null; clearTimeout(this._idle);
    for (const [, p] of this.pending) p.rej(new Error('llm worker stopped'));
    this.pending.clear(); this.emit('stopped');
  }

  warm() { this._start().catch(() => {}); this._touch(); }

  /** @returns {Promise<string>} assistant text; rejects LlmTimeout past timeoutMs (start-up included) */
  async chat({ messages, maxTokens = 256, timeoutMs = 1500 }) {
    this.stats.requests++;
    const id = ++this._id;
    let timer;
    const deadline = new Promise((_r, rej) => { timer = setTimeout(() => rej(new LlmTimeout()), timeoutMs); });
    try {
      const run = (async () => {
        await this._start();
        this._touch();
        return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.worker.postMessage({ cmd: 'chat', id, messages, maxTokens }); });
      })();
      run.catch(() => {});
      const out = await Promise.race([run, deadline]);
      this._touch();
      return out;
    } catch (e) {
      if (e instanceof LlmTimeout) {
        this.stats.timeouts++; this.pending.delete(id);
        if (this.worker) this.worker.postMessage({ cmd: 'cancel', id });
        throw e;
      }
      if (e && e.aborted) { this.stats.timeouts++; throw new LlmTimeout(); }
      this.stats.errors++; throw e;
    } finally { clearTimeout(timer); }
  }

  stop(why = 'stop') {
    clearTimeout(this._idle);
    const w = this.worker;
    if (w) { this._dead(w); w.terminate().catch(() => {}); }
    this.state = 'stopped'; this._ready = null;
    this.emit('stopped', { why });
  }
}

module.exports = { LlmWorker, LlmTimeout };
