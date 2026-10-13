'use strict';
/* Shared by the ctrlspace tests: a helper process in test mode with CAPTURE on (Send reports the keys it WOULD send,
   nothing is pressed on this machine), and an OS-like sink that replays those keys with real modifier semantics:
   Backspace with Ctrl down deletes a whole word, a typed character with Ctrl down is a shortcut (lost). */
const path = require('path');
const os = require('os');
const fs = require('fs');
const root = path.join(__dirname, '..', '..');
const { Win32Typer } = require(path.join(root, 'src/typer/win32-typer.js'));
const BIN = path.join(os.tmpdir(), 'pf-cs-bin');       // compiled once (stamp on the source hash), deleted by hand when the work is done

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startHelper({ hotkey = [0x11, 0x20], claim = true } = {}) {
  const t = new Win32Typer({ binDir: BIN, test: true });
  await t.ready;
  t.keys = []; t.lines = [];
  t.on('key', (e) => t.keys.push(e.down ? 'down' : 'up'));
  t.on('line', (a) => t.lines.push(a));
  t.setHotkey(hotkey); t.setClaim(claim); t.raw('CAPTURE 1');
  t.close2 = () => t.close();
  return t;
}
/** send one command, wait for the next reply line of that kind */
async function ask(t, cmd, kind, ms = 3000) {
  const n = t.lines.filter((l) => l[0] === kind).length;
  t.raw(cmd);
  for (let i = 0; i < ms / 10; i++) { const got = t.lines.filter((l) => l[0] === kind); if (got.length > n) return got[got.length - 1]; await sleep(10); }
  throw new Error('no ' + kind + ' reply to ' + cmd);
}
const sim = async (t, vk, down) => (await ask(t, `SIM ${vk} ${down ? 'down' : 'up'}`, 'SIM'))[1];
const dump = async (t) => Object.fromEntries((await ask(t, 'DUMP', 'DUMP')).slice(1).map((kv) => kv.split('=')));
/** run fn (which makes the helper type / backspace) and return every SENT line it produced, as one string each */
async function sent(t, fn, want = 1) {
  const n = t.lines.filter((l) => l[0] === 'SENT').length;
  fn();
  for (let i = 0; i < 300; i++) {
    const got = t.lines.filter((l) => l[0] === 'SENT').slice(n);
    if (got.length >= want) { await sleep(40); return t.lines.filter((l) => l[0] === 'SENT').slice(n).map((l) => l.slice(1).join(' ')); }
    await sleep(10);
  }
  throw new Error('nothing sent');
}
/** what an application ends up with, replaying SENT tokens ("A2:U 08:D 08:U c41:D ...") the way Windows would */
function replayOs(tokens, text = '', ctrlStart = []) {
  const buf = Array.from(text); const ctrl = new Set(ctrlStart); const seen = []; let lost = 0;
  for (const tok of tokens.join(' ').split(' ').filter(Boolean)) {
    const [k, ud] = tok.split(':'); const down = ud === 'D';
    if (k === 'A2' || k === 'A3') { if (down) ctrl.add(k); else ctrl.delete(k); seen.push(tok); continue; }
    if (k === '08' && down) {
      if (ctrl.size) { while (buf.length && buf[buf.length - 1] === ' ') buf.pop(); while (buf.length && buf[buf.length - 1] !== ' ') buf.pop(); }   // Ctrl+Backspace
      else buf.pop();
    } else if (k[0] === 'c' && down) { if (ctrl.size) lost++; else buf.push(String.fromCharCode(parseInt(k.slice(1), 16))); }
  }
  return { text: buf.join(''), ctrlDownAtEnd: ctrl.size > 0, ctrlEvents: seen, shortcutsFired: lost };
}
module.exports = { startHelper, ask, sim, dump, sent, replayOs, sleep, root };
