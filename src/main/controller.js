'use strict';
/* Controller: hotkey events -> HotkeyFsm -> DictationSession, mic wiring, pill state, usage stats.
   Deps are injected so the whole thing runs in tests with a MemoryTyper, a fake mic and a fake ASR host.
   emits 'pill' {state:'idle'|'listening'|'handsfree'|'processing'|'done'|'cancelled'|'error', text, note?}
         'level' number 0..1 ; 'result' {text, words, ...} ; 'history' entry */
const { EventEmitter } = require('events');
const { HotkeyFsm } = require('../core/hotkey-fsm');
const { DictationSession } = require('../core/session');
const { LABELS } = require('../core/commands');
const { decideRoute } = require('../core/routing');
const { NoteSink } = require('../core/note-sink');
const NOTE_SAVED = 'Saved as note';

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
  constructor({ getAsr, typer, store, mic, ownPid = process.pid, now = Date.now, doneFlashMs = 900, llm = null, notes = null, slang = null }) {
    super();
    Object.assign(this, { getAsr, typer, store, mic, ownPid, now, doneFlashMs, llm, notes, slang });
    this.carry = null; this.gain = 1; this.flash = '';
    this.enabled = true; this.capturing = false; this.session = null; this.lastLevelAt = 0; this.level = 0; this.pillState = 'idle';
    this.fsm = new HotkeyFsm({ onAction: (a) => this._action(a) });
  }

  attach() {
    this.typer.on('key', (e) => (this.enabled && !this.capturing ? (e.down ? this.fsm.down(this.now()) : this.fsm.up(this.now())) : null));
    this.typer.on('toggle', () => (this.enabled && !this.capturing && this._toggleOn() ? this.fsm.toggle() : null));
    this.typer.on('esc', () => this.fsm.esc());
    this.typer.on('key2', (e) => this._noteKey(e));          // the note-mode chord (Ctrl+Shift+Space): hold, talk, release = a note
    this._claim();
  }
  _toggleOn() { const s = this.store.get(); return s.toggleOn !== false && !!(s.toggleKey && s.toggleKey.vks && s.toggleKey.vks[0]); }
  /** the helper swallows the chord (Ctrl+Space) and the toggle key (CapsLock) only while dictation can actually use them:
      not paused in the tray, not in a hotkey picker, and (CapsLock) only while its Settings switch is on. Anything else = normal keys. */
  _claim() {
    const live = this.enabled && !this.capturing;
    if (this.typer.setClaim) this.typer.setClaim(live);
    if (this.typer.setToggleKey) this.typer.setToggleKey(live && this._toggleOn() ? this.store.get().toggleKey.vks[0] : 0);
  }
  /** note mode: hold to talk, release to save the dictation as a note instead of typing it. A tap is never a dictation. */
  _noteKey(e) {
    if (!this.enabled || this.capturing || !this.notes) return;
    if (e.down) {
      if (this.session) return;
      this.noteHeldAt = this.now();
      this._start('hold', { gesture: 'note' });
    } else {
      const sess = this.session;
      if (!sess || !sess.noteMode || !this.noteHeldAt) return;
      const tap = this.now() - this.noteHeldAt < 250;
      this.noteHeldAt = 0;
      this._stop({ tap });
    }
  }
  /** a session that only becomes a note: nothing typed, no commands, no per-app tone */
  noteSessionSettings(s) {
    return { liveMode: s.liveMode, trailingSpace: false, fillers: s.fillers, dictionary: s.dictionary, snippets: s.snippets, style: s.style, deny: [],
      commands: null, tone: { enabled: false, apps: [] }, translate: s.translate, cleanup: s.cleanup };
  }
  /** the Settings hotkey picker is listening: the chord must reach the page, and must not start dictation */
  setCapturing(on) { this.capturing = !!on; if (on && this.session) this._action({ type: 'cancel' }); this._claim(); }
  applySettings() { this._claim(); this.emit('flags', this.flags()); }
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
      slang: this.slang ? this.slang.matcher(s.dictionary.map((d) => d.from)) : null,      // your Dictionary rows win over slang packs
      commands: cmdOn ? { enabled: true, list: s.commands.enabled ? s.commands.list : [], carryMs: s.commands.carryMs, notes: { enabled: !!(n.enabled && this.notes), triggers: n.triggers } } : null,
      tone: s.tone, translate: s.translate, cleanup: s.cleanup, enterAfterFinal: !!(s.typing && s.typing.enterAfterFinal), terminalFinalsOnly: true,
      deferred: !(s.typing && s.typing.live),
      joinPrev: this.lastInsert && this.now() - this.lastInsert.at <= s.commands.carryMs ? this.lastInsert : null,
      insert: { terminal: s.typing && s.typing.terminalMethod, other: s.typing && s.typing.otherMethod, apps: (s.typing && s.typing.insertApps) || [] },
    };
  }
  setEnabled(on) { this.enabled = !!on; if (!on && this.session) this._action({ type: 'cancel' }); this._claim(); this._pill('idle'); }

  _pill(state, extra = {}) {
    this.pillState = state;
    this.emit('pill', { state, text: '', ...extra });
  }

  _action(a) {
    if (a.type === 'start' && this.session && this.session.noteMode) { this.fsm.reset(); return; }   // a note is being held: the dictation chord does nothing
    if (a.type === 'start') return this._start(a.mode);
    if (a.type === 'stop') return this._stop(a);
    if (a.type === 'cancel') return this._cancel();
  }

  _start(mode, opts = {}) {
    const asr = this.getAsr();
    if (!asr) { this._pill('error', { note: 'Speech model not ready' }); this.fsm.reset(); return; }
    const s = this.store.get();
    // where does this dictation go: typed, or kept as a note (note-mode chord, or the desktop / no window / own window fallback)
    const route = decideRoute({ fg: this.typer.foreground(), gesture: opts.gesture, autoRoute: !!(this.notes && s.notes.autoRoute), ownPid: this.ownPid });
    const asNote = route.route === 'note' && !!this.notes;
    const w = s.whisper;
    this.gain = w.enabled ? w.gain : 1;
    if (asr.setVad) asr.setVad(w.enabled ? w.vadThreshold : NORMAL_VAD);     // posted before 'start', so it applies to this session
    const carry = !asNote && this.carry && this.now() - this.carry.at <= s.commands.carryMs ? this.carry : null;
    this.flash = '';
    this.session = new DictationSession({
      asr, typer: asNote ? new NoteSink() : this.typer, ownPid: this.ownPid, now: this.now, llm: this.llm, carry,
      settings: asNote ? this.noteSessionSettings(s) : this.sessionSettings(s),
    });
    const sess = this.session;
    if (asNote) sess.noteMode = route.why;
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
    if (asNote) this._pill(state, { note: route.why === 'note mode' ? 'Note mode' : 'Nothing to type into: saving a note' });
    else this._pill(state, { note: typingOk ? tone : 'Typing is off in this window' });
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

  /** a finished note-mode dictation: save the text as a note (never typed, never put in transcript history) */
  _noteResult(r) {
    if (r.cancelled) return this._pill('idle');
    if (!r.text) { this._pill('done', { text: 'Nothing heard' }); setTimeout(() => { if (this.pillState === 'done') this._pill('idle'); }, 900); return; }
    this.store.addUsage({ words: r.words, speechSec: r.speechSec });
    const saved = this.notes.save(r.text, { source: 'dictation' });
    if (saved) this.emit('notes', { id: saved.id });
    this._pill('done', { text: saved ? NOTE_SAVED : 'Could not save the note' });
    setTimeout(() => { if (this.pillState === 'done') this._pill('idle'); }, Math.max(this.doneFlashMs, 1400));
  }

  _result(sess, r) {
    if (sess !== this.session) return;           // a cancelled / replaced session
    this.session = null;
    this.mic.stop();
    this.fsm.reset();
    if (sess.noteMode) return this._noteResult(r);
    this.lastInsert = r.insertInfo && !(this.store.get().typing && this.store.get().typing.enterAfterFinal) ? { ...r.insertInfo, at: this.now() } : null;   // the next insertion into the same window starts with exactly one space
    if (r.carry && r.carry.entries) this.carry = { ...r.carry, at: this.now() };
    const flash = this.flash; this.flash = '';
    if (r.cancelled) return this._pill('idle');
    if (r.unsent && this.notes) {        // Wispr style: the window changed before release, so nothing was inserted; keep the words as a note instead of losing them
      const n = this.notes.save(r.unsent, { source: 'dictation' });
      if (n) this.emit('notes', { id: n.id });
      this._pill('done', { text: n ? 'Window changed: saved as note' : 'Not inserted: window changed' });
      setTimeout(() => { if (this.pillState === 'done') this._pill('idle'); }, 1800);
      return;
    }
    if (!r.text) {                       // a command or a note was the whole utterance: show what it did
      if (!flash) return this._pill('idle');
      this._pill('done', { text: flash });
      setTimeout(() => { if (this.pillState === 'done') this._pill('idle'); }, Math.max(this.doneFlashMs, 1100));
      return;
    }
    this.store.addUsage({ words: r.words, speechSec: r.speechSec });
    const h = this.store.addHistory(r.text);
    this.emit('result', { words: r.words, chars: r.text.length, finals: r.stats && r.stats.finals, insertions: r.stats && r.stats.insertions, duplicateFinals: r.stats && r.stats.duplicateFinals });
    if (h) this.emit('history', h);
    this._pill('done', { text: r.text, note: flash });
    setTimeout(() => { if (this.pillState === 'done') this._pill('idle'); }, this.doneFlashMs);
  }
}

module.exports = { Controller, amplify, NORMAL_VAD };
