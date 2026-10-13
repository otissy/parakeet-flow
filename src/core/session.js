'use strict';
/* DictationSession: one hold-to-talk (or hands-free) utterance. Wires an ASR host (partial / final /
   done events) into a LiveTyper and tells the UI what is going on. Used by the app and the tests.
   events: 'partial' {text} 'final' {text} 'halted' {reason} 'late-final' {text} 'result' {text,halted,stats,cancelled}
   Dictated text only flows through events; this class never logs it. */
const { EventEmitter } = require('events');
const { LiveTyper } = require('./live-typer');
const { clean } = require('./postprocess');

class DictationSession extends EventEmitter {
  constructor({ asr, typer, settings = {}, now = Date.now, ownPid } = {}) {
    super();
    this.asr = asr; this.typer = typer; this.now = now; this.settings = settings;
    this.live = new LiveTyper({
      typer, now, ownPid, mode: settings.liveMode || 'aggressive', cap: settings.cap || 40,
      flushMs: settings.flushMs || 1500, trailingSpace: !!settings.trailingSpace, deny: settings.deny,
      finalize: (t) => clean(t, { fillers: settings.fillers, dictionary: settings.dictionary, snippets: settings.snippets, style: settings.style }),
    });
    for (const ev of ['halted', 'late-final', 'deferred', 'cancelled']) this.live.on(ev, (e) => this.emit(ev, e));
    this.speechSec = 0; this.finalsText = []; this.partialText = ''; this.ended = false; this.cancelled = false;
    this._on = {
      partial: (e) => this._partial(e), final: (e) => this._final(e), done: (e) => this._done(e),
    };
  }

  /** @returns {boolean} false when typing is not allowed (deny-list): the session still transcribes */
  start() {
    const typingOk = this.live.begin();
    this.sid = this.asr.start();
    for (const [k, f] of Object.entries(this._on)) this.asr.on(k, f);
    return typingOk;
  }
  _mine(e) { return e.sid === undefined || e.sid === this.sid; }
  _partial(e) {
    if (!this._mine(e) || this.cancelled) return;
    this.partialText = e.text;
    this.live.hypothesis(e.segId, e.text);
    this.emit('partial', { text: this.display() });
  }
  _final(e) {
    if (!this._mine(e) || this.cancelled) return;
    this.speechSec += e.audioSec || 0;
    this.live.final(e.segId, e.text);
    this.finalsText = this.live.finals.slice(); this.partialText = '';
    this.emit('final', { text: this.display() });
  }
  _done(e) {
    if (!this._mine(e) || this.ended) return;
    this._finish();
  }
  display() { return [...this.finalsText, this.partialText].filter(Boolean).join(' '); }

  pushAudio(f32) { if (!this.ended && !this.cancelled) this.asr.pushAudio(f32); }
  /** key released / stop pressed */
  release() { if (this.ended || this.cancelled) return; this.live.release(); this.asr.release(); }
  /** Esc */
  cancel() {
    if (this.ended || this.cancelled) return;
    this.cancelled = true;
    this.live.cancelSegment(); this.asr.cancel();
    this._finish();
  }
  _finish() {
    this.ended = true;
    for (const [k, f] of Object.entries(this._on)) this.asr.off(k, f);
    const r = this.live.end();
    this.emit('result', { ...r, cancelled: this.cancelled, speechSec: this.speechSec, words: r.text ? r.text.split(/\s+/).filter(Boolean).length : 0 });
  }
}

module.exports = { DictationSession };
