'use strict';
/* Controller: hotkey events -> HotkeyFsm -> DictationSession, mic wiring, pill state, usage stats.
   Deps are injected so the whole thing runs in tests with a MemoryTyper, a fake mic and a fake ASR host.
   emits 'pill' {state:'idle'|'listening'|'handsfree'|'processing'|'done'|'cancelled'|'error', text, note?}
         'level' number 0..1 ; 'result' {text, words, ...} ; 'history' entry */
const { EventEmitter } = require('events');
const { HotkeyFsm } = require('../core/hotkey-fsm');
const { DictationSession } = require('../core/session');
const { LABELS } = require('../core/commands');

/** whisper mode: scale the samples (clipped to +-1). Returns the same array when gain is 1. */
function amplify(a, gain) {
  if (!(gain > 1)) return a;
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) { const v = a[i] * gain; o[i] = v > 1 ? 1 : v < -1 ? -1 : v; }
  return o;
}
const NORMAL_VAD = 0.5;
const rmsOf = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, a.length)); };

class Controller extends EventEmitter {
  /** llm: LlmService-like or null; notes: {save(text)} or null (both optional: with them absent the controller behaves as before) */
  constructor({ getAsr, typer, store, mic, ownPid = process.pid, now = Date.now, doneFlashMs = 900, llm = null, notes = null }) {
    super();
    Object.assign(this, { getAsr, typer, store, mic, ownPid, now, doneFlashMs, llm, notes });
    this.carry = null; this.gain = 1; this.flash = '';
    this.enabled = true; this.capturing = false; this.session = null; this.lastLevelAt = 0; this.level = 0; this.pillState = 'idle';
    this.fsm = new HotkeyFsm({ mode: store.get().mode, onAction: (a) => this._action(a) });
  }

  attach() {
    this.typer.on('key', (e) => (this.enabled && !this.capturing ? (e.down ? this.fsm.down(this.now()) : this.fsm.up(this.now())) : null));
    this.typer.on('esc', () => this.fsm.esc());
    this._claim();
  }
  /** the helper swallows the chord (Ctrl+Space) only while dictation can actually use it: not paused, not in the hotkey picker */
  _claim() { if (this.typer.setClaim) this.typer.setClaim(this.enabled && !this.capturing); }
  /** the Settings hotkey picker is listening: the chord must reach the page, and must not start dictation */
  setCapturing(on) { this.capturing = !!on; if (on && this.session) this._action({ type: 'cancel' }); this._claim(); }
  applySettings() { this.fsm.mode = this.store.get().mode; this.emit('flags', this.flags()); }
  /** what the pill shows as always-on chips */
  flags() {
    const s = this.store.get();
    return { whisper: !!s.whisper.enabled, translate: s.translate.enabled ? s.translate.target : '', cleanup: !!s.cleanup.enabled };
  }

  /** settings the session needs, from the stored settings */
  sessionSettings(s) {
    const n = s.notes;
    const cmdOn = s.commands.enabled || n.enabled;
    return {
      liveMode: s.liveMode, trailingSpace: s.trailingSpace, fillers: s.fillers, dictionary: s.dictionary, snippets: s.snippets, style: s.style, deny: s.deny,
      commands: cmdOn ? { enabled: true, list: s.commands.enabled ? s.commands.list : [], carryMs: s.commands.carryMs, notes: { enabled: !!(n.enabled && this.notes), triggers: n.triggers } } : null,
      tone: s.tone, translate: s.translate, cleanup: s.cleanup,
    };
  }
  setEnabled(on) { this.enabled = !!on; if (!on && this.session) this._action({ type: 'cancel' }); this._claim(); this._pill('idle'); }

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
    const w = s.whisper;
    this.gain = w.enabled ? w.gain : 1;
    if (asr.setVad) asr.setVad(w.enabled ? w.vadThreshold : NORMAL_VAD);     // posted before 'start', so it applies to this session
    const carry = this.carry && this.now() - this.carry.at <= s.commands.carryMs ? this.carry : null;
    this.flash = '';
    this.session = new DictationSession({
      asr, typer: this.typer, ownPid: this.ownPid, now: this.now, llm: this.llm, carry,
      settings: this.sessionSettings(s),
    });
    const sess = this.session;
    const state = mode === 'hands-free' ? 'handsfree' : 'listening';
    sess.on('partial', (e) => { if (sess === this.session) this._pill(this.pillState === 'processing' ? 'processing' : state, { text: e.text }); });
    sess.on('final', (e) => { if (sess === this.session) this._pill(this.pillState === 'processing' ? 'processing' : state, { text: e.text }); });
    sess.on('halted', (e) => this.emit('note', { note: `Not typing: ${e.reason}` }));
    sess.on('late-final', () => this.emit('note', { note: 'Result arrived late, not typed' }));
    sess.on('note', ({ text }) => {
      const saved = this.notes ? this.notes.save(text) : null;
      if (saved) {
        this.flash = LABELS.note; this.emit('notes', { id: saved.id });
        // a short "Saved note" flash right now, while the session is still running
        if (sess === this.session && this.pillState !== 'idle') {
          const st = this.pillState; this._pill(st, { text: sess.display(), note: LABELS.note });
          setTimeout(() => { if (sess === this.session && this.pillState === st) this._pill(st, { text: sess.display() }); }, 1200);
        }
      }
      else this.emit('note', { note: 'Could not save the note' });
    });
    sess.on('command', (c) => { if (c.ok) { if (this.flash !== LABELS.note) this.flash = LABELS[c.action] || ''; } else this.emit('note', { note: `Command skipped: ${c.reason}` }); });
    sess.on('result', (r) => this._result(sess, r));
    const typingOk = sess.start();
    this.mic.start((raw) => {
      if (sess !== this.session || sess.ended) return;
      const chunk = amplify(raw, this.gain);
      sess.pushAudio(chunk);
      const t = this.now(); const l = rmsOf(chunk);
      this.level = Math.max(l, this.level * 0.8);
      if (t - this.lastLevelAt > 40) { this.lastLevelAt = t; this.emit('level', Math.min(1, this.level * 6)); this.level = 0; }
    });
    const tone = sess.profile && sess.profile !== 'default' ? `Tone: ${sess.profile}` : '';
    this._pill(state, { note: typingOk ? tone : 'Typing is off in this window' });
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
    if (r.carry && r.carry.entries) this.carry = { ...r.carry, at: this.now() };
    const flash = this.flash; this.flash = '';
    if (r.cancelled) return this._pill('idle');
    if (!r.text) {                       // a command or a note was the whole utterance: show what it did
      if (!flash) return this._pill('idle');
      this._pill('done', { text: flash });
      setTimeout(() => { if (this.pillState === 'done') this._pill('idle'); }, Math.max(this.doneFlashMs, 1100));
      return;
    }
    this.store.addUsage({ words: r.words, speechSec: r.speechSec });
    const h = this.store.addHistory(r.text);
    this.emit('result', { words: r.words, chars: r.text.length });
    if (h) this.emit('history', h);
    this._pill('done', { text: r.text, note: flash });
    setTimeout(() => { if (this.pillState === 'done') this._pill('idle'); }, this.doneFlashMs);
  }
}

module.exports = { Controller, amplify, NORMAL_VAD };
