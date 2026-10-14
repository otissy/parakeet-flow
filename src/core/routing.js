'use strict';
/* Where does a dictation go: typed into the focused window, or saved as a note?
   Two ways to a note, and nothing else is guessed:
     1. the explicit "note mode" hold gesture (Ctrl+Shift+Space by default): always a note;
     2. the conservative fallback: the foreground is the Desktop / taskbar (the Windows shell), there is no window at all,
        or it is one of this app's own windows. There typing has nowhere to go, so the dictation is kept as a note.
   Inside any other application window the dictation is typed (or, if typing is refused there, dropped as before): this
   never decides "this looks like a notes situation" from titles or text. Pure functions, no side effects. */

/** classes of the Windows shell windows that cannot take typed text (the desktop, the taskbar, its overflow) */
const SHELL_CLASSES = ['progman', 'workerw', 'shell_traywnd', 'shell_secondarytraywnd', 'notifyiconoverflowwindow', 'traynotifywnd'];
const OWN_PROCS = ['parakeet-flow'];

const lc = (x) => String(x || '').toLowerCase();
const procOf = (fg) => lc(fg && fg.proc).replace(/\.exe$/, '');

/** @returns {{ok:boolean, reason?:'no window'|'own window'|'desktop'}} ok = a normal application window that can take typing */
function typingTarget(fg, { ownPid = process.pid, ownProcs = OWN_PROCS } = {}) {
  if (!fg) return { ok: true, unknown: true };       // the helper has not reported a foreground yet: never guess, keep the old behaviour
  if (!fg.hwnd) return { ok: false, reason: 'no window' };
  if ((ownPid && fg.pid === ownPid) || ownProcs.includes(procOf(fg))) return { ok: false, reason: 'own window' };
  if (procOf(fg) === 'explorer') {
    const cls = lc(fg.cls);
    if (SHELL_CLASSES.includes(cls)) return { ok: false, reason: 'desktop' };
    if (!cls && (lc(fg.title) === 'program manager' || !fg.title)) return { ok: false, reason: 'desktop' };   // an old helper without the class field
  }
  return { ok: true };
}

/** @param gesture 'note' when the note-mode chord started this dictation @param autoRoute the Settings switch
    @returns {{route:'type'|'note', why:string}} */
function decideRoute({ fg, gesture = null, autoRoute = true, ownPid = process.pid } = {}) {
  if (gesture === 'note') return { route: 'note', why: 'note mode' };
  if (autoRoute) {
    const t = typingTarget(fg, { ownPid });
    if (!t.ok) return { route: 'note', why: t.reason };
  }
  return { route: 'type', why: 'application window' };
}

module.exports = { typingTarget, decideRoute, SHELL_CLASSES };
