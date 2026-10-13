'use strict';
/* DictationSession: one hold-to-talk (or hands-free) utterance. Wires an ASR host (partial / final /
   done events) into a LiveTyper and tells the UI what is going on. Used by the app and the tests.
   events: 'partial' {text} 'final' {text} 'halted' {reason} 'late-final' {text} 'command' {action, ok, reason?}
           'note' {text} 'result' {text,halted,stats,cancelled,commands,carry,...}
   Dictated text only flows through events; this class never logs it.

   With every new feature off (no commands, no per-app tone, no model) the path is exactly the old synchronous one.
   With the model on (cleanup / translate) finals go through a promise chain: ONE model call per final, in order,
   with a hard timeout; partials that arrive meanwhile wait, so a finalised segment is never typed over by a newer one. */
const { EventEmitter } = require('events');
const { LiveTyper } = require('./live-typer');
const { clean, casual } = require('./postprocess');
const { applyTone, formal, resolveProfile } = require('./tone');

class DictationSession extends EventEmitter {
  /** llm: LlmService-like {cleanup(text), translate(text,{target}), warm()} or null */
  constructor({ asr, typer, settings = {}, now = Date.now, ownPid, llm = null, carry = null } = {}) {
    super();
    this.asr = asr; this.typer = typer; this.now = now; this.settings = settings; this.llm = llm;
    const cu = settings.cleanup || {}, tr = settings.translate || {}, tn = settings.tone || {};
    this.useCleanup = !!(llm && cu.enabled); this.useTranslate = !!(llm && tr.enabled);
    this.asyncMode = this.useCleanup || this.useTranslate;
    const split = !!(settings.commands || tn.enabled || this.asyncMode);
    const modelMs = this.asyncMode ? Math.max(this.useTranslate ? 3500 : 0, cu.timeoutMs || 1500) + 600 : 0;
    const style = settings.style;
    const base = {
      typer, now, ownPid, mode: settings.liveMode || 'aggressive', cap: settings.cap || 40,
      flushMs: (settings.flushMs || 1500) + modelMs, trailingSpace: !!settings.trailingSpace, deny: settings.deny,
      commands: settings.commands || null, carry, carryMs: (settings.commands && settings.commands.carryMs) || 120000, formal, casual,
    };
    if (split) {
      this.prepare = (t) => clean(t, { fillers: settings.fillers, dictionary: settings.dictionary, snippets: settings.snippets });
      this.live = new LiveTyper({ ...base, prepare: this.prepare,
        tone: (t, profile) => applyTone(t, profile, { globalCasual: !!(style && style.casual) }),
        resolveProfile: tn.enabled ? (fg) => resolveProfile(fg, { enabled: true, apps: tn.apps }).profile : null });
    } else {
      this.live = new LiveTyper({ ...base,
        finalize: (t) => clean(t, { fillers: settings.fillers, dictionary: settings.dictionary, snippets: settings.snippets, style }) });
    }
    for (const ev of ['halted', 'late-final', 'deferred', 'cancelled', 'command', 'note']) this.live.on(ev, (e) => this.emit(ev, e));
    this.speechSec = 0; this.finalsText = []; this.partialText = ''; this.ended = false; this.cancelled = false;
    this.pending = 0; this._chain = Promise.resolve(); this._heldPartial = null; this._finalSegs = new Set(); this._doneSeen = false;
    this._on = {
      partial: (e) => this._partial(e), final: (e) => this._final(e), done: (e) => this._done(e),
    };
  }

  /** @returns {boolean} false when typing is not allowed (deny-list): the session still transcribes */
  start() {
    const typingOk = this.live.begin();
    if (this.asyncMode && this.llm && this.llm.warm) this.llm.warm();     // the model loads while the user talks
    this.sid = this.asr.start();
    for (const [k, f] of Object.entries(this._on)) this.asr.on(k, f);
    return typingOk;
  }
  get profile() { return this.live.profile; }
  _mine(e) { return e.sid === undefined || e.sid === this.sid; }
  _partial(e) {
    if (!this._mine(e) || this.cancelled) return;
    if (this.pending > 0) { this._heldPartial = e; return; }
    this._applyPartial(e);
  }
  _applyPartial(e) {
    this.partialText = e.text;
    this.live.hypothesis(e.segId, e.text);
    this.emit('partial', { text: this.display() });
  }
  _final(e) {
    if (!this._mine(e) || this.cancelled) return;
    this.speechSec += e.audioSec || 0;
    if (!this.asyncMode) return this._commitFinal(e);
    this.pending++;
    this._chain = this._chain.then(async () => {
      if (this.cancelled || this.ended) return;
      const mid = this.live.classify(e.text) ? undefined : await this._model(e.text);   // commands and notes never go to the model
      if (this.cancelled || this.ended) return;
      this._commitFinal(e, mid);
    }).catch(() => {}).then(() => { this.pending--; this._drain(); });
  }
  _commitFinal(e, mid) {
    this.live.final(e.segId, e.text, { mid });
    this._finalSegs.add(e.segId);
    this.finalsText = this.live.finals.slice(); this.partialText = '';
    this.emit('final', { text: this.display() });
  }

  /** the model step for one final. Always resolves: on timeout / error / a rejected reply the answer is undefined (= use the original) */
  async _model(raw) {
    const s = this.settings;
    const text = this.prepare(raw);
    if (!text) return undefined;
    if ((s.snippets || []).length && this._snippetHit(raw)) return undefined;      // a snippet expansion is typed as written
    try {
      const r = this.useTranslate ? await this.llm.translate(text, { target: s.translate.target }) : await this.llm.cleanup(text);
      return r && r.used ? r.text : undefined;
    } catch (_) { return undefined; }
  }
  _snippetHit(raw) {
    const s = this.settings;
    return clean(raw, { fillers: s.fillers, dictionary: [], snippets: s.snippets }) !== clean(raw, { fillers: s.fillers, dictionary: [], snippets: [] });
  }

  _drain() {
    if (this.pending > 0 || this.ended || this.cancelled) return;
    const h = this._heldPartial; this._heldPartial = null;
    if (h && !this._doneSeen && !this._finalSegs.has(h.segId)) this._applyPartial(h);
    if (this._doneSeen) this._finish();
  }
  _done(e) {
    if (!this._mine(e) || this.ended) return;
    this._doneSeen = true;
    if (this.pending === 0) this._finish();
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
    if (this.ended) return;
    this.ended = true;
    for (const [k, f] of Object.entries(this._on)) this.asr.off(k, f);
    const r = this.live.end();
    this.emit('result', { ...r, cancelled: this.cancelled, speechSec: this.speechSec, words: r.text ? r.text.split(/\s+/).filter(Boolean).length : 0 });
  }
}

module.exports = { DictationSession };
