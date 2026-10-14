'use strict';
/* Which key "new line" presses, per foreground window.
   Shift+Enter is a soft newline in chat apps and editors, but a classic console window (conhost) and most terminal
   emulators deliver Shift+Enter to a raw-mode program as a plain Enter (CR): in a prompt such as Claude Code's that
   SUBMITS the line. Ctrl+J is a bare line feed (LF) in every one of them, and a raw-mode prompt takes it as "insert a
   newline". So in a console-class terminal the default is Ctrl+J. VS Code is an editor first (the terminal inside it is
   not distinguishable from outside), so it keeps Shift+Enter; the Settings choice overrides everything.
   Measured on this PC (.tests/terminals/real-terminals.js): conhost + node raw stdin: Shift+Enter arrives as 0d (Enter). */

const { TERMINAL_PROCS: PROCS, TERMINAL_CLASSES: CLASSES } = require('../core/terminals');
const TERMINAL_PROCS = new Set(PROCS);
const TERMINAL_CLASSES = new Set(CLASSES);

const lc = (x) => String(x || '').toLowerCase();
const procOf = (fg) => lc(fg && fg.proc).replace(/\.exe$/, '');

function isConsoleTerminal(fg) {
  if (!fg) return false;
  return TERMINAL_PROCS.has(procOf(fg)) || TERMINAL_CLASSES.has(lc(fg.cls));
}

/** @param setting 'auto' | 'shift-enter' | 'ctrl-j'  @returns 's' | 'j' (the helper's TYPE flag) */
function newlineMode(fg, setting = 'auto') {
  if (setting === 'shift-enter') return 's';
  if (setting === 'ctrl-j') return 'j';
  return isConsoleTerminal(fg) ? 'j' : 's';
}

module.exports = { newlineMode, isConsoleTerminal, TERMINAL_PROCS, TERMINAL_CLASSES };
