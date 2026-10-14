'use strict';
/* Settings for note routing, the MCP server, Markdown export and terminal typing. Kept out of settings.js so that file stays small:
   it only spreads these defaults and calls these normalisers.
     notes.noteHotkey   the "note mode" chord: modifiers + exactly one plain key, held (default Ctrl+Shift+Space)
     notes.autoRoute    desktop / no window / own window -> the dictation is kept as a note (default on)
     notes.export       Markdown export folder (off by default)
     mcp.shareHistory   let MCP clients read recent dictation (off by default; needs transcript history)
     typing.newline     what "new line" presses: auto | shift-enter | ctrl-j (src/typer/newline.js)
     typing.enterAfterFinal   press Enter once after each finished dictation (off by default) */
const MODS = new Set([0x10, 0x11, 0x12, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C]);
const isMod = (v) => MODS.has(v);
/** the family of a modifier: 0x11 and 0xA2/0xA3 are all "Ctrl" */
const family = (v) => (v === 0x10 || v === 0xA0 || v === 0xA1 ? 'shift' : v === 0x11 || v === 0xA2 || v === 0xA3 ? 'ctrl' : v === 0x12 || v === 0xA4 || v === 0xA5 ? 'alt' : 'win');

const DEFAULT_NOTE_HOTKEY = { vks: [0x11, 0x10, 0x20], label: 'Ctrl+Shift+Space' };

const DEFAULTS = {
  noteHotkey: DEFAULT_NOTE_HOTKEY,
  autoRoute: true,
  export: { enabled: false, folder: '' },
};
const MCP_DEFAULTS = { shareHistory: false };
// live: false = Wispr style (the default): nothing is typed while you hold the key, the finished text is inserted once on release.
// live: true = "Type while I speak (experimental)": partials typed and corrected in place; it can misbehave in terminals.
const TYPING_DEFAULTS = { newline: 'auto', enterAfterFinal: false, live: false, terminalMethod: 'burst', otherMethod: 'burst', insertApps: [] };

/** modifiers + exactly one plain key. Returns an error text, or '' when fine. `primary` = the dictation hotkey's vks */
function noteChordError(vks, primary = []) {
  if (!Array.isArray(vks) || vks.length < 2 || vks.length > 4) return 'Use at least one modifier plus one key';
  const plain = vks.filter((v) => !isMod(v)), mods = vks.filter(isMod);
  if (plain.length !== 1 || !mods.length) return 'Use at least one modifier (Ctrl, Shift, Alt, Win) plus exactly one other key';
  const pPlain = primary.filter((v) => !isMod(v));
  if (pPlain.length === 1 && pPlain[0] === plain[0]) {
    const mine = new Set(mods.map(family)), theirs = new Set(primary.filter(isMod).map(family));
    // the helper checks the note chord first, so a note chord that is the dictation chord or LESS specific than it (its modifiers all held by the dictation chord) would steal it
    if ([...mine].every((f) => theirs.has(f))) return 'That is the same as the dictation hotkey, or hidden by it';
  }
  return '';
}

function normNotes(n, primaryVks) {
  const d = DEFAULTS;
  const vks = Array.isArray(n?.noteHotkey?.vks) ? n.noteHotkey.vks.map(Number).filter((x) => x > 0 && x < 256).slice(0, 4) : [];
  const good = vks.length && !noteChordError(vks, primaryVks);
  const folder = String(n?.export?.folder || '').trim().slice(0, 260);
  return {
    noteHotkey: good ? { vks, label: String(n.noteHotkey.label || '').slice(0, 40) || d.noteHotkey.label } : d.noteHotkey,
    autoRoute: n?.autoRoute !== false,
    export: { enabled: !!n?.export?.enabled, folder },
  };
}
const normMcp = (m) => ({ shareHistory: m?.shareHistory === true });
const normTyping = (t) => ({
  newline: ['auto', 'shift-enter', 'ctrl-j'].includes(t?.newline) ? t.newline : TYPING_DEFAULTS.newline,
  enterAfterFinal: t?.enterAfterFinal === true,
  live: t?.live === true,
  terminalMethod: ['paste', 'paste-insert', 'burst'].includes(t?.terminalMethod) ? t.terminalMethod : TYPING_DEFAULTS.terminalMethod,
  otherMethod: ['paste', 'paste-insert', 'burst'].includes(t?.otherMethod) ? t.otherMethod : TYPING_DEFAULTS.otherMethod,
  insertApps: Array.isArray(t?.insertApps) ? t.insertApps.map((r) => ({ match: String(r?.match ?? '').trim().slice(0, 80), method: String(r?.method ?? '') })).filter((r) => r.match && ['paste', 'paste-insert', 'burst'].includes(r.method)).slice(0, 100) : [],
});

module.exports = { DEFAULTS, MCP_DEFAULTS, TYPING_DEFAULTS, DEFAULT_NOTE_HOTKEY, noteChordError, normNotes, normMcp, normTyping, isMod };
