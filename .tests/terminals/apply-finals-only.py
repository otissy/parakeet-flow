import sys
root = sys.argv[1]


def patch(p, pairs):
    p = root + '/' + p
    s = open(p, encoding='utf8').read()
    for o, n in pairs:
        assert s.count(o) == 1, (p, o)
        s = s.replace(o, n)
    open(p, 'w', encoding='utf8').write(s)


patch('src/core/live-typer.js', [
    ("trailingSpace = false, enterAfterFinal = false, deny,", "trailingSpace = false, enterAfterFinal = false, terminalFinalsOnly = false, deny,"),
    ("trailingSpace, enterAfterFinal, deny, ownPid,", "trailingSpace, enterAfterFinal, terminalFinalsOnly, deny, ownPid,"),
    ("    if (seg.done) return false;\n    const raw = text;",
     "    if (seg.done) return false;\n    // terminals (code profile): FINALS ONLY. A raw-mode prompt such as Claude Code's batches and drops rapid key bursts, so live\n"
     "    // Backspace corrections left \"wor ld i, it  is\" on screen (2026-10-13). A final is typed once, with no Backspace at all.\n"
     "    if (this.terminalFinalsOnly && this.profile === 'code') return false;\n    const raw = text;"),
])
patch('src/core/session.js', [("enterAfterFinal: !!settings.enterAfterFinal,", "enterAfterFinal: !!settings.enterAfterFinal, terminalFinalsOnly: settings.terminalFinalsOnly !== false,")])
patch('src/main/controller.js', [("enterAfterFinal: !!(s.typing && s.typing.enterAfterFinal),", "enterAfterFinal: !!(s.typing && s.typing.enterAfterFinal), terminalFinalsOnly: !(s.typing && s.typing.terminalLive),")])
patch('src/main/settings-notes.js', [
    ("const TYPING_DEFAULTS = { newline: 'auto', enterAfterFinal: false };", "const TYPING_DEFAULTS = { newline: 'auto', enterAfterFinal: false, terminalLive: false };"),
    ("  enterAfterFinal: t?.enterAfterFinal === true,\n", "  enterAfterFinal: t?.enterAfterFinal === true,\n  terminalLive: t?.terminalLive === true,\n"),
])
patch('src/renderer/settings-extra.js', [
    ("    <div class=\"srow\"><div class=\"l\"><b>Press Enter after I finish</b>",
     "    <div class=\"srow\"><div class=\"l\"><b>Live typing in terminals</b><div>Off (recommended). In a terminal or editor the words appear when each sentence is finished, with no Backspace corrections: a prompt like Claude Code's drops rapid corrections and left stray characters. On: partial words are typed and corrected live as elsewhere.</div></div><div class=\"c\">${toggle('ty-live', t.terminalLive)}</div></div>\n"
     "    <div class=\"srow\"><div class=\"l\"><b>Press Enter after I finish</b>"),
    ("  on('ty-enter',", "  on('ty-live', () => save({ typing: { ...s.typing, terminalLive: !s.typing.terminalLive } }));\n  on('ty-enter',"),
])
# paced typing in terminals: slices of 24 characters, 8 ms apart, so a prompt that reads stdin in chunks never gets one huge burst
patch('src/typer/win32-typer.js', [
    ("const { newlineMode } = require('./newline');", "const { newlineMode, isConsoleTerminal } = require('./newline');"),
    ("    const nl = text.includes('\\n') ? ' ' + newlineMode(this.fg, this.newline) : '';\n    this._send(`TYPE ${this.nextId++} ${hwnd || 0} ${Buffer.from(text, 'utf16le').toString('base64')}${nl}`);",
     "    const nl = ' ' + newlineMode(this.fg, this.newline);\n    const paced = isConsoleTerminal(this.fg) || /^code/.test(String(this.fg && this.fg.proc || '').toLowerCase()) ? ' p' : '';\n    this._send(`TYPE ${this.nextId++} ${hwnd || 0} ${Buffer.from(text, 'utf16le').toString('base64')}${nl}${paced}`);"),
])
print('ok')
