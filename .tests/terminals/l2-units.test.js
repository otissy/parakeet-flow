'use strict';
/* Wispr-style insertion (the default since 2026-10-14) and the terminal regressions that led to it.
   2026-10-13: live typing with Backspace corrections left "hello wor ld i, it  is a nice day  second  sentence here" in the Claude Code prompt, and a
   480-word stress dictation had a defect every 8-12 words. Now nothing is typed while the key is held; the finished text goes in ONCE on release. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { DictationSession } = require(path.join(root, 'src/core/session.js'));
const { MemoryTyper } = require(path.join(root, 'src/typer/typer.js'));
const { FakeHost } = require(path.join(root, '.tests/asr/fakes.js'));
const { resolveProfile } = require(path.join(root, 'src/core/tone.js'));
const { newlineMode } = require(path.join(root, 'src/typer/newline.js'));
const { decideRoute } = require(path.join(root, 'src/core/routing.js'));
const { resolveInsertMethod } = require(path.join(root, 'src/core/insert-method.js'));

const PARTIALS = ['Hello', 'Hello wor', 'Hello word', 'Hello world i', 'Hello world it is a nice', 'Hello world it is a nice day.'];
/** a MemoryTyper that also has insert(), recording the method it was asked for */
class InsertTyper extends MemoryTyper {
  constructor(o) { super(o); this.inserts = []; }
  insert(text, opts) { this.inserts.push({ text, method: opts.method }); return this.type(text, opts); }
}
function dictate(proc, settings = {}) {
  const typer = new InsertTyper({ proc, pid: 5 }); typer.fg.title = 'x';
  const host = new FakeHost();
  const s = new DictationSession({ asr: host, typer, now: () => Date.now(), ownPid: 1, settings: { deferred: true, tone: { enabled: true, apps: [] }, ...settings } });
  const previews = []; s.on('partial', (e) => previews.push(e.text)); s.on('final', (e) => previews.push(e.text));
  let result = null; s.on('result', (r) => { result = r; });
  s.start();
  let typedWhileHeld = 0;
  for (const p of PARTIALS) { host.emitEv('partial', { segId: 1, text: p }); typedWhileHeld += typer.log.length; }
  host.emitEv('final', { segId: 1, text: 'Hello world, it is a nice day.' });
  host.emitEv('partial', { segId: 2, text: 'Second' }); host.emitEv('partial', { segId: 2, text: 'Second sentence here' });
  host.emitEv('final', { segId: 2, text: 'Second sentence here.' });
  typedWhileHeld += typer.log.length;
  s.release(); host.emitEv('done', {});
  return { typer, previews, typedWhileHeld, result, s };
}
const WANT_TERMINAL = 'hello world, it is a nice day. second sentence here.';

test('Wispr style in a terminal: the pill previews, nothing is typed while held, ONE insertion on release, no Backspace, exact text', () => {
  for (const proc of ['node.exe', 'conhost.exe', 'cmd.exe', 'WindowsTerminal.exe', 'claude.exe', 'Code.exe']) {
    const r = dictate(proc);
    assert.equal(r.typedWhileHeld, 0, proc + ': nothing typed while the key is held');
    assert.ok(r.previews.length >= 6 && r.previews[0] === 'Hello', 'the pill preview still gets every partial');
    assert.equal(r.typer.log.length, 1, proc + ': one insertion');
    assert.equal(r.typer.text, WANT_TERMINAL, proc);
    assert.ok(!r.typer.log.some((o) => o.op === 'bs'));
    assert.equal(r.result.text, WANT_TERMINAL); assert.equal(r.result.inserted, true);
  }
});

test('Wispr style in a normal app: capitals and punctuation kept, one space between sentences, optional trailing space', () => {
  const r = dictate('notepad.exe', { trailingSpace: false });
  assert.equal(r.typer.text, 'Hello world, it is a nice day. Second sentence here.'); assert.equal(r.typer.log.length, 1);
  assert.equal(dictate('notepad.exe', { trailingSpace: true }).typer.text, 'Hello world, it is a nice day. Second sentence here. ');
  assert.ok(!/ {2}/.test(r.typer.text) && !/^ /.test(r.typer.text));
});

test('stress: 480 words (word0..word96 x5) as 6 segments with partial/final cadence: exact text, one insertion, no double space', () => {
  const words = []; for (let i = 0; i < 480; i++) words.push('word' + (i % 97));
  for (const proc of ['node.exe', 'notepad.exe']) {
    const host = new FakeHost(); const typer = new InsertTyper({ proc, pid: 5 }); typer.fg.title = 'x';
    const s = new DictationSession({ asr: host, typer, now: () => Date.now(), ownPid: 1, settings: { deferred: true, tone: { enabled: true, apps: [] } } });
    s.start();
    for (let seg = 1; seg <= 6; seg++) {
      const w = words.slice((seg - 1) * 80, seg * 80);
      for (const n of [40, 77, 80]) host.emitEv('partial', { segId: seg, text: n === 77 ? w.slice(0, 76).join(' ') + ' xx' : w.slice(0, n).join(' ') });
      host.emitEv('final', { segId: seg, text: w.join(' ') });
    }
    s.release(); host.emitEv('done', {});
    assert.equal(typer.text, words.join(' '), proc); assert.equal(typer.log.length, 1); assert.ok(!/ {2}/.test(typer.text));
  }
});

test('the insert method follows the per-app table: your rows first, then terminal / other defaults', () => {
  assert.equal(dictate('node.exe', { insert: { terminal: 'burst', other: 'paste', apps: [] } }).typer.inserts[0].method, 'burst');
  assert.equal(dictate('notepad.exe', { insert: { terminal: 'burst', other: 'paste', apps: [] } }).typer.inserts[0].method, 'paste');
  assert.equal(dictate('notepad.exe', { insert: { terminal: 'burst', other: 'paste', apps: [{ match: 'notepad', method: 'burst' }] } }).typer.inserts[0].method, 'burst');
  assert.equal(resolveInsertMethod({ proc: 'WindowsTerminal.exe' }, { terminal: 'paste', apps: [{ match: 'windowsterminal', method: 'burst' }] }), 'burst');
  assert.equal(resolveInsertMethod({ proc: 'node.exe', cls: 'ConsoleWindowClass' }), 'burst');
  assert.equal(resolveInsertMethod({ proc: 'chrome.exe', title: 'Google Docs' }, { other: 'paste-insert' }), 'paste-insert');
});

test('exactly one space between consecutive insertions (the next hold in the same window), none at the start', () => {
  const typer = new InsertTyper({ proc: 'notepad.exe', pid: 5 }); typer.fg.title = 'x';
  const settings = { deferred: true, commands: { enabled: true, list: [], carryMs: 120000, notes: { enabled: false, triggers: [] } }, tone: { enabled: true, apps: [] } };
  let carry = null;
  const say = (text) => {
    const host = new FakeHost();
    const s = new DictationSession({ asr: host, typer, now: () => Date.now(), ownPid: 1, carry, settings });
    s.on('result', (r) => { carry = r.carry && { ...r.carry, at: Date.now() }; });
    s.start(); host.emitEv('final', { segId: 1, text }); s.release(); host.emitEv('done', {});
  };
  say('First sentence.'); say('Second sentence.'); say('Third.');
  assert.equal(typer.text, 'First sentence. Second sentence. Third.');
});

test('voice commands act on the waiting text before it is inserted: delete that, new line, capitalize that', () => {
  const host = new FakeHost(); const typer = new InsertTyper({ proc: 'notepad.exe', pid: 5 }); typer.fg.title = 'x';
  const cmds = [{ phrase: 'delete that', action: 'delete' }, { phrase: 'new line', action: 'newline' }, { phrase: 'capitalize that', action: 'capitalize' }];
  const s = new DictationSession({ asr: host, typer, now: () => Date.now(), ownPid: 1, settings: { deferred: true, commands: { enabled: true, list: cmds, carryMs: 1, notes: { enabled: false, triggers: [] } }, tone: { enabled: true, apps: [] } } });
  s.start();
  host.emitEv('final', { segId: 1, text: 'keep this one.' }); host.emitEv('final', { segId: 2, text: 'mistake sentence.' }); host.emitEv('final', { segId: 3, text: 'delete that' });
  host.emitEv('final', { segId: 4, text: 'new line' }); host.emitEv('final', { segId: 5, text: 'second paragraph here.' }); host.emitEv('final', { segId: 6, text: 'capitalize that' });
  s.release(); host.emitEv('done', {});
  assert.equal(typer.text, 'keep this one.\nSecond Paragraph Here.'); assert.equal(typer.log.length, 1);
});

test('Esc / cancel inserts nothing, and a window change before release inserts nothing (the text is handed back as unsent)', () => {
  const host = new FakeHost(); const typer = new InsertTyper({ proc: 'notepad.exe', pid: 5 }); typer.fg.title = 'x';
  const s = new DictationSession({ asr: host, typer, now: () => Date.now(), ownPid: 1, settings: { deferred: true, tone: { enabled: true, apps: [] } } });
  s.start(); host.emitEv('final', { segId: 1, text: 'never typed.' }); s.cancel();
  assert.equal(typer.log.length, 0);
  const host2 = new FakeHost(); const t2 = new InsertTyper({ proc: 'notepad.exe', pid: 5, hwnd: 7 }); t2.fg.title = 'x';
  const s2 = new DictationSession({ asr: host2, typer: t2, now: () => Date.now(), ownPid: 1, settings: { deferred: true, tone: { enabled: true, apps: [] } } });
  let res; s2.on('result', (r) => { res = r; });
  s2.start(); host2.emitEv('final', { segId: 1, text: 'Hello there.' }); t2.setForeground({ hwnd: 99, pid: 6, proc: 'other.exe' }); s2.release(); host2.emitEv('done', {});
  assert.equal(t2.log.length, 0); assert.equal(res.inserted, false); assert.equal(res.unsent, 'Hello there.');
});

test('"Type while I speak (experimental)" is still there: live partials with corrections, final settles to the same text', () => {
  const r = dictate('notepad.exe', { deferred: false });
  assert.equal(r.typer.text.trim(), 'Hello world, it is a nice day. Second sentence here.');
  assert.ok(r.typer.log.some((o) => o.op === 'bs'), 'it corrects with Backspace');
  assert.ok(r.typedWhileHeld > 0);
});

test('terminal detection: process names measured on this PC, the console window class, per-window newline key', () => {
  for (const proc of ['node.exe', 'cmd.exe', 'powershell.exe', 'pwsh.exe', 'conhost.exe', 'WindowsTerminal.exe', 'alacritty.exe', 'wezterm-gui.exe', 'Code.exe', 'claude.exe']) assert.equal(resolveProfile({ proc, title: '' }).profile, 'code', proc);
  assert.equal(newlineMode({ proc: 'node.exe', cls: 'ConsoleWindowClass' }), 'j');
  assert.equal(newlineMode({ proc: 'Code.exe' }), 's'); assert.equal(newlineMode({ proc: 'discord.exe' }), 's');
  assert.equal(newlineMode({ proc: 'discord.exe' }, 'ctrl-j'), 'j'); assert.equal(newlineMode({ proc: 'node.exe' }, 'shift-enter'), 's');
});

test('routing: desktop, no window and own window become notes; any application window and an unknown foreground do not', () => {
  assert.equal(decideRoute({ fg: { hwnd: 5, pid: 9, proc: 'explorer.exe', title: 'Program Manager', cls: 'Progman' } }).route, 'note');
  assert.equal(decideRoute({ fg: { hwnd: 5, pid: 9, proc: 'explorer.exe', title: '', cls: 'Shell_TrayWnd' } }).route, 'note');
  assert.equal(decideRoute({ fg: { hwnd: 0, pid: 0, proc: '-.exe', title: '' } }).route, 'note');
  assert.equal(decideRoute({ fg: { hwnd: 5, pid: 77, proc: 'x.exe' }, ownPid: 77 }).route, 'note');
  assert.equal(decideRoute({ fg: { hwnd: 5, pid: 9, proc: 'explorer.exe', title: 'Downloads', cls: 'CabinetWClass' } }).route, 'type');
  assert.equal(decideRoute({ fg: { hwnd: 5, pid: 9, proc: 'notepad.exe', title: 'Notes', cls: 'Notepad' } }).route, 'type');
  assert.equal(decideRoute({ fg: null }).route, 'type');
  assert.equal(decideRoute({ fg: { hwnd: 5, pid: 9, proc: 'notepad.exe' }, gesture: 'note' }).route, 'note');
  assert.equal(decideRoute({ fg: { hwnd: 5, pid: 9, proc: 'explorer.exe', title: '', cls: 'Progman' }, autoRoute: false }).route, 'type');
});
