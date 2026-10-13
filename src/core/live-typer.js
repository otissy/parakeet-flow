'use strict';
/* LiveTyper: turns a stream of hypotheses into keystrokes.
   - keeps `typed` per segment; each hypothesis -> longest common prefix, Backspace x (typed - prefix),
     then the new tail. A correction over `cap` backspaces waits (final may fix it, else it stays).
   - a final segment is IMMUTABLE: only the live segment's own text is ever backspaced.
   - types only while the session is active, plus `flushMs` after release; never after the
     foreground window changes or enters the deny-list; Esc removes only the live segment's text.
   Counting is in code points. Dictated text is never logged. */
const { EventEmitter } = require('events');
const { cp } = require('../typer/typer');
const { isDenied } = require('./deny');

function lcpLen(a, b) { const n = Math.min(a.length, b.length); let i = 0; while (i < n && a[i] === b[i]) i++; return i; }

class LiveTyper extends EventEmitter {
  constructor({ typer, mode = 'aggressive', cap = 40, flushMs = 1500, finalHardCap = 400, now = Date.now, finalize = (t) => t,
                trailingSpace = false, deny, ownPid } = {}) {
    super();
    Object.assign(this, { typer, mode, cap, flushMs, finalHardCap, now, finalize, trailingSpace, deny, ownPid });
    this.reset();
  }

  reset() {
    this.active = false; this.releasedAt = null; this.halted = null; this.cancelled = false;
    this.hwnd = null; this.cur = null; this.finals = []; this.finalizedChars = 0;
    this.stats = { keystrokeOps: 0, corrections: 0, maxBackspace: 0, maxFinalBackspace: 0, deferred: 0, lateFinals: 0, typedAfterFlush: 0 };
  }

  begin() {
    this.reset();
    const fg = this.typer.foreground();
    const d = isDenied(fg, { deny: this.deny, ownPid: this.ownPid });
    this.active = true;
    if (d.denied) { this.halted = d.reason; this.emit('halted', { reason: d.reason }); return false; }
    this.hwnd = fg.hwnd;
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

  _seg(segId) {
    if (this.cur && this.cur.id === segId) return this.cur;
    if (this.cur) this._commit(this.cur);   // a segment that never got a final is frozen as typed
    this.cur = { id: segId, sep: this.finalizedChars > 0 ? ' ' : '', typed: '', prev: null };
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

  final(segId, rawText) {
    const clean = this.finalize(rawText);
    const seg = this._seg(segId);
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
    this.emit('final-typed', { segId, ok });
    return ok;
  }

  /** the ASR is done for this session; optional trailing space, then report */
  end() {
    if (this.trailingSpace && this.finalizedChars > 0 && this._guard()) {
      this.typer.type(' ', { hwnd: this.hwnd });
      this.finalizedChars += 1;
    }
    this.active = false;
    return { text: this.finals.filter(Boolean).join(' '), halted: this.halted, stats: { ...this.stats } };
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
