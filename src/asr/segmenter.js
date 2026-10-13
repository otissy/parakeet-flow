'use strict';
/* Segmenter: turns a push-audio stream into partial / final / endpoint events for an OFFLINE
   engine. A VAD finds speech; the live segment is re-decoded every `partialIntervalMs` for
   `partial`; a pause (VAD min-silence) or release() finalises it. A finalised segment is
   immutable: later audio only ever starts a new segment.

   Injected: engine {decode(f32)->{text,ms}}, vad {acceptWaveform,isDetected,isEmpty,pop,reset},
   now() -> ms.  Events: 'segment-start' 'partial' 'final' 'endpoint' 'done'. */
const { EventEmitter } = require('events');

const SR = 16000;
const rms = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, to - from)); };

class Segmenter extends EventEmitter {
  constructor({ engine, vad, now = () => Date.now(), partialIntervalMs = 400, capSec = 9, softCapSec = 6,
                preRollMs = 600, minNewAudioMs = 200, quietRms = 0.01 } = {}) {
    super();
    Object.assign(this, { engine, vad, now, partialIntervalMs, capSec, softCapSec, preRollMs, minNewAudioMs, quietRms });
    this.segId = 0;
    this._resetAll();
  }

  _resetAll() {
    this.chunks = [];          // live segment audio
    this.len = 0;
    this.active = false;       // a segment is live
    this.pre = [];             // pre-roll ring (chunks)
    this.preLen = 0;
    this.lastDecodeAt = 0;
    this.lastDecodedLen = -1;
    this.lastText = '';
    this.started = false;      // between start() and release()/cancel()
    if (this.vad.reset) this.vad.reset();
  }

  start() { this._resetAll(); this.started = true; this.lastDecodeAt = this.now(); }
  cancel() { this._resetAll(); }

  pushAudio(f32) {
    if (!this.started || !f32 || !f32.length) return;
    this.vad.acceptWaveform(f32);
    const detected = this.vad.isDetected();
    if (!this.active) {
      this._ring(f32);
      if (detected) {
        this.active = true;
        this.segId += 1;
        this.chunks = this.pre.slice(); this.len = this.preLen;
        this.pre = []; this.preLen = 0;
        this.lastDecodeAt = this.now() - this.partialIntervalMs + 100; // first partial soon
        this.lastDecodedLen = -1; this.lastText = '';
        this.emit('segment-start', { segId: this.segId, at: this.now() });
      }
    } else {
      this.chunks.push(f32); this.len += f32.length;
    }
    // pause endpoint: the VAD closed a segment
    if (!this.vad.isEmpty()) {
      while (!this.vad.isEmpty()) this.vad.pop();
      if (this.active) { this._finalize('pause'); return; }
    }
    if (!this.active) return;
    const sec = this.len / SR;
    if (sec >= this.capSec) { this._finalize('cap'); return; }
    if (sec >= this.softCapSec) {
      const all = this._audio();
      const tail = Math.floor(SR * 0.15);
      if (rms(all, all.length - tail, all.length) < this.quietRms) { this._finalize('cap'); return; }
    }
    this._maybePartial();
  }

  _ring(f32) {
    this.pre.push(f32); this.preLen += f32.length;
    const max = Math.floor(SR * this.preRollMs / 1000);
    while (this.pre.length > 1 && this.preLen - this.pre[0].length >= max) this.preLen -= this.pre.shift().length;
  }

  _audio() {
    if (this.chunks.length === 1) return this.chunks[0];
    const out = new Float32Array(this.len); let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    this.chunks = [out];
    return out;
  }

  _maybePartial() {
    const t = this.now();
    if (t - this.lastDecodeAt < this.partialIntervalMs) return;
    if (this.lastDecodedLen >= 0 && this.len - this.lastDecodedLen < SR * this.minNewAudioMs / 1000) return;
    const r = this.engine.decode(this._audio());
    this.lastDecodeAt = this.now(); this.lastDecodedLen = this.len; this.lastText = r.text;
    if (r.text) this.emit('partial', { segId: this.segId, text: r.text, decodeMs: r.ms, audioSec: this.len / SR });
  }

  _finalize(reason) {
    const segId = this.segId;
    let text = this.lastText, ms = 0;
    if (this.lastDecodedLen !== this.len) { const r = this.engine.decode(this._audio()); text = r.text; ms = r.ms; }
    const audioSec = this.len / SR;
    this.active = false; this.chunks = []; this.len = 0; this.lastDecodedLen = -1; this.lastText = '';
    if (text) this.emit('final', { segId, text, reason, decodeMs: ms, audioSec });
    this.emit('endpoint', { segId, reason });
  }

  /** key released: settle whatever is live, then 'done'. */
  release() {
    if (!this.started) return;
    if (this.active) this._finalize('release');
    this.started = false;
    if (this.vad.reset) this.vad.reset();
    this.emit('done', { at: this.now() });
  }
}

module.exports = { Segmenter, SR };
