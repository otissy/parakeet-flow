'use strict';
/* NoteSink: a Typer that types nothing. A dictation that is going to become a note (note mode, or the desktop / no-window
   fallback) runs through the normal DictationSession with this in place of the real typer, so the live segmenting,
   cleanup and final text work unchanged but no key is ever sent to any window. Same interface as MemoryTyper / Win32Typer. */
class NoteSink {
  constructor() { this.fg = { hwnd: 1, pid: 0, proc: 'note-mode', title: '', cls: '' }; }
  foreground() { return this.fg; }
  type() { return true; }
  backspace() { return true; }
  enter() { return true; }
}

module.exports = { NoteSink };
