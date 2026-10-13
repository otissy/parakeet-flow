'use strict';
/* Typer interface:
     type(text, {hwnd})    insert text at the caret of the foreground window
     backspace(n, {hwnd})  press Backspace n times
     foreground()          -> {hwnd, pid, proc, title} | null
   Implementations: MemoryTyper (here), Win32Typer (win32-typer.js), TestWindowSink (test-window-sink.js).
   Counting is in code points, never UTF-16 units, so an emoji is one Backspace. */

const cp = (s) => Array.from(s);

/** apply a keystroke log to an empty buffer: what the target field ends up holding */
function replay(ops) {
  let buf = [];
  for (const o of ops) {
    if (o.op === 'type') buf.push(...cp(o.text));
    else if (o.op === 'bs') buf = buf.slice(0, Math.max(0, buf.length - o.n));
  }
  return buf.join('');
}

class MemoryTyper {
  constructor({ hwnd = 1, proc = 'notepad.exe', pid = 100 } = {}) {
    this.log = [];
    this.fg = { hwnd, pid, proc, title: 'memory' };
    this.refuseWhenForegroundDiffers = true;
  }
  _ok(opts) { return !opts || opts.hwnd == null || !this.refuseWhenForegroundDiffers || opts.hwnd === this.fg.hwnd; }
  type(text, opts) {
    if (!text || !this._ok(opts)) return false;
    this.log.push({ op: 'type', text, at: Date.now() }); return true;
  }
  backspace(n, opts) {
    if (!(n > 0) || !this._ok(opts)) return false;
    this.log.push({ op: 'bs', n, at: Date.now() }); return true;
  }
  foreground() { return this.fg; }
  get text() { return replay(this.log); }
  setForeground(fg) { this.fg = { ...this.fg, ...fg }; }
}

module.exports = { MemoryTyper, replay, cp };
