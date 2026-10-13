'use strict';
/* LiveTyper: turns a stream of hypotheses into keystrokes.
   - keeps `typed` per segment; each hypothesis -> longest common prefix, Backspace x (typed - prefix),
     then the new tail. A correction over `cap` backspaces waits (final may fix it, else it stays).
   - a final segment is IMMUTABLE while talking: only the live segment's own text is ever backspaced.
     The one exception is an explicit voice command ("delete that", "capitalize that", "undo that" ...), which
     rewrites the LAST typed segment, bounded by finalHardCap backspaces, and only if the window is unchanged.
   - types only while the session is active, plus `flushMs` after release; never after the
     foreground window changes or enters the deny-list; Esc removes only the live segment's text.
   - voice commands (opt-in via `commands`) are matched on FINALS only and are never typed. While a partial could
     still become a command phrase it is not typed either (see isCommandPrefix).
   Counting is in code points. Dictated text is never logged. */
const { EventEmitter } = require('events');
const { cp } = require('../typer/typer');
const { isDenied } = require('./deny');
const { matchCommand, matchNote, isCommandPrefix, transformFor } = require('./commands');

function lcpLen(a, b) { const n = Math.min(a.length, b.length); let i = 0; while (i < n && a[i] === b[i]) i++; return i; }
const NOTE_ARM_MS = 10000, OPS_MAX = 30;

class LiveTyper extends EventEmitter {
  /** `prepare(raw)` (sync clean-up) and `tone(text, profile)` are `finalize` split in two so a model can sit between
      them; pass either `finalize` (the old way) or `prepare` + `tone`.
      commands: {enabled, list, notes:{enabled, triggers}} or null (null = no command handling at all). */
  constructor({ typer, mode = 'aggressive', cap = 40, flushMs = 1500, finalHardCap = 400, now = Date.now, finalize = (t) => t,
                prepare = null, tone = null, resolveProfile = null, commands = null, carry = null, carryMs = 120000,
                trailingSpace = false, deny, ownPid, formal, casual } = {}) {
    super();
    Object.assign(this, { typer, mode, cap, flushMs, finalHardCap, now, finalize, prepare, tone, resolveProfile, commands, carry, carryMs,
                          trailingSpace, deny, ownPid, formalFn: formal, casualFn: casual });
    this.reset();
  }

  reset() {
    this.active = false; this.releasedAt = null; this.halted = null; this.cancelled = false;
    this.hwnd = null; this.cur = null; this.finals = []; this.finalizedChars = 0;
    this.profile = 'default'; this.entries = []; this.ops = []; this.commandsRun = []; this.armedNote = 0;
    this.stats = { keystrokeOps: 0, corrections: 0, maxBackspace: 0, maxFinalBackspace: 0, deferred: 0, lateFinals: 0, typedAfterFlush: 0 };
  }

  begin() {
    this.reset();
    const fg = this.typer.foreground();
    const d = isDenied(fg, { deny: this.deny, ownPid: this.ownPid });
    this.active = true;
    if (d.denied) { this.halted = d.reason; this.emit('halted', { reason: d.reason }); return false; }
    this.hwnd = fg.hwnd;
    if (this.resolveProfile) this.profile = this.resolveProfile(fg) || 'default';
    const c = this.carry;     // the previous dictation's last segments, so "delete that" works in a new hold
    if (c && this.commands && c.hwnd === fg.hwnd && this.now() - c.at <= this.carryMs) { this.entries = c.entries; this.ops = c.ops; }
    return true;
  }

  release() { if (this.active) { this.active = false; this.releasedAt = this.now(); } }

  canType() {
    if (this.halted || this.cancelled || this.hwnd == null) return false;
    if (this.active) return true;
    return this.releasedAt != null && this.now() - this.releasedAt <= this.flushMs;
  }

  _guard() {
    if (!this.canType()) return false;
    const fg = this.typer.foreground();
    const d = isDenied(fg, { deny: this.deny, ownPid: this.ownPid });
    if (d.denied) return this._halt(d.reason);
    if (fg.hwnd !== this.hwnd) return this._halt('focus changed');
    return true;
  }
  _halt(reason) { if (!this.halted) { this.halted = reason; this.emit('halted', { reason }); } return false; }

  _lastBreak() { const e = this.entries[this.entries.length - 1]; return !!e && /\s$/.test(e.typed); }
  _seg(segId) {
    if (this.cur && this.cur.id === segId) return this.cur;
    if (this.cur) this._commit(this.cur);   // a segment that never got a final is frozen as typed
    this.cur = { id: segId, sep: this.finalizedChars > 0 && !this._lastBreak() ? ' ' : '', typed: '', prev: null };
    return this.cur;
  }
  _commit(seg) { this.finalizedChars += cp(seg.typed).length; seg.done = true; if (this.cur === seg) this.cur = null; }

  _apply(seg, desired, isFinal = false) {
    const a = cp(seg.typed), b = cp(desired);
    const k = lcpLen(a, b), bs = a.length - k, tail = b.slice(k).join('');
    if (bs === 0 && !tail) return true;
    // live corrections wait when over the cap; the FINAL is the one place a larger rewrite is allowed
    // (otherwise a mangled partial would stay on screen), bounded by a sanity limit
    if (bs > (isFinal ? this.finalHardCap : this.cap)) { this.stats.deferred++; this.emit('deferred', { segId: seg.id, backspaces: bs }); return false; }
    if (!this._guard()) return false;
    const opts = { hwnd: this.hwnd };
    const flushed = !this.active;
    if (bs > 0 && this.typer.backspace(bs, opts) === false) return this._halt('refused');
    if (tail && this.typer.type(tail, opts) === false) return this._halt('refused');
    if (bs > 0) {
      this.stats.corrections++;
      if (isFinal) this.stats.maxFinalBackspace = Math.max(this.stats.maxFinalBackspace, bs);
      else this.stats.maxBackspace = Math.max(this.stats.maxBackspace, bs);
    }
    this.stats.keystrokeOps += (bs > 0 ? 1 : 0) + (tail ? 1 : 0);
    if (flushed && this.releasedAt != null && this.now() - this.releasedAt > this.flushMs) this.stats.typedAfterFlush++;
    seg.typed = desired;
    this.emit('typed', { segId: seg.id, chars: cp(desired).length, backspaces: bs });
    return true;
  }

  hypothesis(segId, rawText) {
    const text = String(rawText || '').normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!text || !this.canType()) return false;
    const seg = this._seg(segId);
    if (seg.done) return false;
    // a partial that could still turn into "delete that" / "note to self ..." is held back, so a command is never typed
    if (this.commands && this.commands.enabled && !seg.typed && this._maybeCommand(text)) return false;
    let words = text.split(' ');
    let use = words;
    if (this.mode === 'stable') {
      const prev = seg.prev; seg.prev = words;
      if (!prev) return false;
      use = words.slice(0, lcpLen(prev, words));
      if (!use.length) return false;
    }
    return this._apply(seg, seg.sep + use.join(' '));
  }

  _maybeCommand(text) {
    const c = this.commands, n = c.notes || {};
    if (this.armedNote && this.now() < this.armedNote) return true;      // "note to self" was said alone: the next segment is the note
    return isCommandPrefix(text, { list: c.list, triggers: n.triggers, notes: !!n.enabled });
  }

  _base(rawText) { return this.prepare ? this.prepare(rawText) : this.finalize(rawText); }

  /** what a final would be: {kind:'note', text} | {kind:'command', action, phrase} | null. Pure; the session uses it too. */
  classify(rawText) {
    const c = this.commands;
    if (!c || !c.enabled) return null;
    const base = this._base(rawText);
    const n = c.notes || {};
    if (this.armedNote && this.now() < this.armedNote && base) return { kind: 'note', text: base[0].toUpperCase() + base.slice(1) };
    if (n.enabled) { const m = matchNote(base, n.triggers); if (m) return { kind: 'note', text: m.text, armed: !m.text }; }
    const m = matchCommand(base, c.list);
    return m ? { kind: 'command', action: m.action, phrase: m.phrase } : null;
  }

  /** `mid`: the text after the model (cleanup / translate), instead of prepare(raw); the tone profile is applied after it */
  final(segId, rawText, { mid } = {}) {
    const seg = this._seg(segId);
    const cls = this.classify(rawText);
    if (cls) return this._command(seg, cls);
    const clean = this.prepare ? (this.tone ? this.tone(mid != null ? mid : this.prepare(rawText), this.profile) : (mid != null ? mid : this.prepare(rawText))) : this.finalize(rawText);
    if (!this.canType()) {
      this.stats.lateFinals++;
      this.finals.push(clean);
      this._commit(seg);
      this.emit('late-final', { segId, text: clean });
      return false;
    }
    const ok = this._apply(seg, seg.sep + clean, true);
    this.finals.push(clean);
    this._commit(seg);
    if (this.commands && seg.typed) {      // the entry is what is really on screen, so a later command rewrites the right thing
      const e = { kind: 'text', sep: seg.sep, typed: seg.typed };
      this.entries.push(e); this._op({ type: 'remove', entry: e });
    }
    this.emit('final-typed', { segId, ok });
    return ok;
  }

  _op(o) { this.ops.push(o); if (this.ops.length > OPS_MAX) this.ops.shift(); }

  /* ---------- voice commands ---------- */
  _skip(action, reason) { this.emit('command', { action, ok: false, reason }); this.commandsRun.push({ action, ok: false, reason }); return false; }
  _done(action, extra = {}) { this.emit('command', { action, ok: true, ...extra }); this.commandsRun.push({ action, ok: true }); return true; }

  _command(seg, cls) {
    const name = cls.kind === 'note' ? 'note' : cls.action;
    // whatever a mistaken partial typed for this segment goes away first (it is this segment's own live text)
    if (seg.typed && !this._apply(seg, '', true)) { this._commit(seg); return this._skip(name, 'could not remove the live text'); }
    this._commit(seg);
    if (cls.kind === 'note') {
      if (cls.armed) { this.armedNote = this.now() + NOTE_ARM_MS; this.emit('note-armed', {}); this.commandsRun.push({ action: 'note-armed', ok: true }); return true; }
      this.armedNote = 0;
      if (!cls.text) return this._skip('note', 'empty note');
      this.emit('note', { text: cls.text });           // saving a note types nothing, so it works even where typing is off
      return this._done('note');
    }
    if (!this._guard()) return this._skip(name, this.halted || 'not typing');
    switch (cls.action) {
      case 'delete': return this._delete();
      case 'undo': return this._undo();
      case 'newline': return this._break('\n', 'newline');
      case 'paragraph': return this._break('\n\n', 'paragraph');
      default: return this._rewriteLast(cls.action);
    }
  }

  _bs(n) {
    if (n > this.finalHardCap) return false;
    if (this.typer.backspace(n, { hwnd: this.hwnd }) === false) { this._halt('refused'); return false; }
    this.stats.keystrokeOps++;
    return true;
  }
  _type(s) {
    if (this.typer.type(s, { hwnd: this.hwnd }) === false) { this._halt('refused'); return false; }
    this.stats.keystrokeOps++; return true;
  }

  _delete() {
    const e = this.entries[this.entries.length - 1];
    if (!e) return this._skip('delete', 'nothing to delete');
    const n = cp(e.typed).length;
    if (n > this.finalHardCap) return this._skip('delete', 'too long to delete safely');
    if (!this._bs(n)) return this._skip('delete', 'refused');
    this.entries.pop(); this.finalizedChars = Math.max(0, this.finalizedChars - n);
    this._op({ type: 'restore', entry: e });
    return this._done('delete', { chars: n });
  }

  _break(s, action) {
    if (!this._type(s)) return this._skip(action, 'refused');
    const e = { kind: 'nl', sep: '', typed: s };
    this.entries.push(e); this.finalizedChars += s.length; this._op({ type: 'remove', entry: e });
    return this._done(action);
  }

  _rewriteLast(action) {
    const e = this.entries[this.entries.length - 1];
    if (!e || e.kind !== 'text') return this._skip(action, 'nothing to change');
    const body = e.typed.slice(e.sep.length);
    const next = e.sep + transformFor(action, body, { formal: this.formalFn, casual: this.casualFn });
    if (next === e.typed) return this._skip(action, 'no change');
    const before = e.typed;
    if (!this._rewrite(e, next)) return this._skip(action, 'refused or too long');
    this._op({ type: 'rewrite', entry: e, before });
    return this._done(action);
  }

  /** replace the typed text of entry e (the last thing on screen) with `next`, touching only the part that differs */
  _rewrite(e, next) {
    const a = cp(e.typed), b = cp(next), k = lcpLen(a, b), bs = a.length - k, tail = b.slice(k).join('');
    if (bs > this.finalHardCap) return false;
    if (bs > 0 && !this._bs(bs)) return false;
    if (tail && !this._type(tail)) return false;
    this.finalizedChars += b.length - a.length;
    e.typed = next;
    return true;
  }

  _undo() {
    const o = this.ops.pop();
    if (!o) return this._skip('undo', 'nothing to undo');
    const last = this.entries[this.entries.length - 1];
    if (o.type === 'restore') {
      if (!this._type(o.entry.typed)) return this._skip('undo', 'refused');
      this.entries.push(o.entry); this.finalizedChars += cp(o.entry.typed).length;
    } else if (o.type === 'remove') {
      if (last !== o.entry) return this._skip('undo', 'text changed since');
      const n = cp(o.entry.typed).length;
      if (!this._bs(n)) return this._skip('undo', 'refused');
      this.entries.pop(); this.finalizedChars = Math.max(0, this.finalizedChars - n);
    } else if (o.type === 'rewrite') {
      if (last !== o.entry) return this._skip('undo', 'text changed since');
      if (!this._rewrite(o.entry, o.before)) return this._skip('undo', 'refused');
    }
    return this._done('undo');
  }

  /** the ASR is done for this session; optional trailing space, then report */
  end() {
    if (this.trailingSpace && this.profile !== 'code' && this.finalizedChars > 0 && !this._lastBreak() && this._guard()) {
      this.typer.type(' ', { hwnd: this.hwnd });
      this.finalizedChars += 1;
      const e = this.entries[this.entries.length - 1];
      if (e && e.kind === 'text') e.typed += ' ';
    }
    this.active = false;
    const r = { text: this.finals.filter(Boolean).join(' '), halted: this.halted, stats: { ...this.stats } };
    if (this.commands) {
      r.profile = this.profile; r.commands = this.commandsRun.slice();
      r.carry = { hwnd: this.hwnd, entries: this.entries, ops: this.ops };
    } else if (this.resolveProfile) r.profile = this.profile;
    return r;
  }

  /** Esc: remove only the live segment's typed text, if focus is still the same */
  cancelSegment() {
    const seg = this.cur;
    this.cancelled = true;
    if (seg && !seg.done && seg.typed) {
      const fg = this.typer.foreground();
      const ok = fg && fg.hwnd === this.hwnd && !isDenied(fg, { deny: this.deny, ownPid: this.ownPid }).denied;
      if (ok && !this.halted) this.typer.backspace(cp(seg.typed).length, { hwnd: this.hwnd });
      seg.typed = '';
    }
    this.cur = null;
    this.emit('cancelled', {});
  }
}

module.exports = { LiveTyper };
