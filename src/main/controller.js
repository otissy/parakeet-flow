'use strict';
/* Controller: hotkey events -> HotkeyFsm -> DictationSession, mic wiring, pill state, usage stats.
   Deps are injected so the whole thing runs in tests with a MemoryTyper, a fake mic and a fake ASR host.
   emits 'pill' {state:'idle'|'listening'|'handsfree'|'processing'|'done'|'cancelled'|'error', text, note?}
         'level' number 0..1 ; 'result' {text, words, ...} ; 'history' entry */
const { EventEmitter } = require('events');
const { HotkeyFsm } = require('../core/hotkey-fsm');
const { DictationSession } = require('../core/session');

const rmsOf = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, a.length)); };

class Controller extends EventEmitter {
  constructor({ getAsr, typer, store, mic, ownPid = process.pid, now = Date.now, doneFlashMs = 900 }) {
    super();
    Object.assign(this, { getAsr, typer, store, mic, ownPid, now, doneFlashMs });
    this.enabled = true; this.session = null; this.lastLevelAt = 0; this.level = 0; this.pillState = 'idle';
    this.fsm = new HotkeyFsm({ mode: store.get().mode, onAction: (a) => this._action(a) });
  }

  attach() {
    this.typer.on('key', (e) => (this.enabled ? (e.down ? this.fsm.down(this.now()) : this.fsm.up(this.now())) : null));
    this.typer.on('esc', () => this.fsm.esc());
  }
  applySettings() { this.fsm.mode = this.store.get().mode; }
  setEnabled(on) { this.enabled = !!on; if (!on && this.session) this._action({ type: 'cancel' }); this._pill('idle'); }

  _pill(state, extra = {}) {
    this.pillState = state;
    this.emit('pill', { state, text: '', ...extra });
  }

  _action(a) {
    if (a.type === 'start') return this._start(a.mode);
    if (a.type === 'stop') return this._stop(a);
    if (a.type === 'cancel') return this._cancel();
  }

  _start(mode) {
    const asr = this.getAsr();
    if (!asr) { this._pill('error', { note: 'Speech model not ready' }); this.fsm.reset(); return; }
    const s = this.store.get();
    this.session = new DictationSession({
      asr, typer: this.typer, ownPid: this.ownPid, now: this.now,
      settings: { liveMode: s.liveMode, trailingSpace: s.trailingSpace, fillers: s.fillers, dictionary: s.dictionary, snippets: s.snippets, style: s.style, deny: s.deny },
    });
    const sess = this.session;
    const state = mode === 'hands-free' ? 'handsfree' : 'listening';
    sess.on('partial', (e) => { if (sess === this.session) this._pill(this.pillState === 'processing' ? 'processing' : state, { text: e.text }); });
    sess.on('final', (e) => { if (sess === this.session) this._pill(this.pillState === 'processing' ? 'processing' : state, { text: e.text }); });
    sess.on('halted', (e) => this.emit('note', { note: `Not typing: ${e.reason}` }));
    sess.on('late-final', () => this.emit('note', { note: 'Result arrived late, not typed' }));
    sess.on('result', (r) => this._result(sess, r));
    const typingOk = sess.start();
    this.mic.start((chunk) => {
      if (sess !== this.session || sess.ended) return;
      sess.pushAudio(chunk);
      const t = this.now(); const l = rmsOf(chunk);
      this.level = Math.max(l, this.level * 0.8);
      if (t - this.lastLevelAt > 40) { this.lastLevelAt = t; this.emit('level', Math.min(1, this.level * 6)); this.level = 0; }
    });
    this._pill(state, { note: typingOk ? '' : 'Typing is off in this window' });
  }

  _stop(a) {
    const sess = this.session;
    if (!sess) return;
    this.mic.stop();
    if (a.tap) { this.session = null; sess.cancel(); this._pill('idle'); return; }   // a lone tap is never a dictation
    this._pill('processing', { text: sess.display() });
    sess.release();
  }

  _cancel() {
    const sess = this.session;
    if (!sess) return;
    this.mic.stop();
    this.session = null;
    sess.cancel();
    this._pill('cancelled');
    setTimeout(() => { if (this.pillState === 'cancelled') this._pill('idle'); }, 600);
  }

  _result(sess, r) {
    if (sess !== this.session) return;           // a cancelled / replaced session
    this.session = null;
    this.mic.stop();
    this.fsm.reset();
    if (r.cancelled || !r.text) return this._pill('idle');
    this.store.addUsage({ words: r.words, speechSec: r.speechSec });
    const h = this.store.addHistory(r.text);
    this.emit('result', { words: r.words, chars: r.text.length });
    if (h) this.emit('history', h);
    this._pill('done', { text: r.text });
    setTimeout(() => { if (this.pillState === 'done') this._pill('idle'); }, this.doneFlashMs);
  }
}

module.exports = { Controller };
