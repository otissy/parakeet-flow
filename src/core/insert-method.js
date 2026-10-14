'use strict';
/* How a finished dictation is put into a window (Wispr style, once, on release):
     'paste'  the clipboard is saved, the text set, Ctrl+V sent, the old clipboard put back (PfHelper PASTE)
     'burst'  one SendInput burst of Unicode key events, no Backspace (PfHelper TYPE)
   Chosen per window: your rows (Settings > Terminals and typing > App table, a process name or window-title text) first, then the family default:
   terminals (core/terminals.js) use `terminal`, everything else `other`. The defaults were picked from measurements, see README "Insert method". */
const { isConsoleTerminal } = require('../typer/newline');

const METHODS = ['burst', 'paste', 'paste-insert'];
const DEFAULTS = { terminal: 'burst', other: 'burst', apps: [] };   // measured: Ctrl+V and Shift+Insert never reach a raw-mode program in a classic console window, a burst does

const lc = (x) => String(x || '').toLowerCase();

function resolveInsertMethod(fg, { terminal = DEFAULTS.terminal, other = DEFAULTS.other, apps = [] } = {}) {
  const proc = lc(fg && fg.proc).replace(/\.exe$/, ''), title = lc(fg && fg.title);
  for (const r of apps) {
    const m = lc(r.match).replace(/\.exe$/, '').trim();
    if (m && METHODS.includes(r.method) && (proc === m || title.includes(m))) return r.method;
  }
  return isConsoleTerminal(fg) || /^code/.test(proc) ? terminal : other;
}

module.exports = { resolveInsertMethod, METHODS, DEFAULTS };
