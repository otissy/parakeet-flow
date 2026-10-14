'use strict';
/* Per-app tone through DictationSession + MemoryTyper: the app in front decides the profile; the deny-list still wins. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { DictationSession } = require(path.join(root, 'src/core/session.js'));
const { MemoryTyper } = require(path.join(root, 'src/typer/typer.js'));
const { FakeHost } = require(path.join(root, '.tests/asr/fakes.js'));

function say(fg, finals, settings = {}) {
  const host = new FakeHost(); const typer = new MemoryTyper({ pid: 77, ...fg });
  typer.fg.title = fg.title || '';
  let t = 0;
  const s = new DictationSession({ asr: host, typer, now: () => t, ownPid: 1, settings: { tone: { enabled: true, apps: [] }, ...settings } });
  const res = []; s.on('result', (r) => res.push(r));
  const typingOk = s.start();
  let seg = 1;
  for (const f of finals) { host.emitEv('partial', { segId: seg, text: f }); host.emitEv('final', { segId: seg, text: f }); seg++; }
  s.release(); host.emitEv('done', {});
  return { text: typer.text, typer, res: res[0], profile: s.profile, typingOk };
}

test('Discord: casual (no final stop, lower-case start)', () => {
  const r = say({ proc: 'Discord.exe', title: 'general - Discord' }, ['Hey are you coming tonight.']);
  assert.equal(r.text, 'hey are you coming tonight'); assert.equal(r.profile, 'casual');
});

test('Outlook: formal', () => {
  const r = say({ proc: 'OUTLOOK.EXE', title: 'Inbox - Outlook' }, ["i'm gonna send the report tomorrow"]);
  assert.equal(r.text, 'I am going to send the report tomorrow.'); assert.equal(r.profile, 'formal');
});

test('VS Code and terminals: code profile, no capital, punctuation kept and NO trailing space', () => {
  for (const fg of [{ proc: 'Code.exe', title: 'x - Visual Studio Code' }, { proc: 'WindowsTerminal.exe', title: 'pwsh' }]) {
    const r = say(fg, ['Git status.'], { trailingSpace: true });
    assert.equal(r.text, 'git status.', fg.proc); assert.equal(r.profile, 'code');
  }
  assert.equal(say({ proc: 'notepad.exe' }, ['Git status.'], { trailingSpace: true }).text, 'Git status. ');   // default profile keeps the space
});

test('an unknown app or tone switched off: the text is exactly what the old pipeline typed', () => {
  assert.equal(say({ proc: 'notepad.exe' }, ['Hello world.']).text, 'Hello world.');
  assert.equal(say({ proc: 'Discord.exe', title: 'Discord' }, ['Hello world.'], { tone: { enabled: false, apps: [] } }).text, 'Hello world.');
});

test('user rows beat the built-ins; the global casual style still applies in the default profile', () => {
  assert.equal(say({ proc: 'Discord.exe', title: 'Discord' }, ['hey there'], { tone: { enabled: true, apps: [{ match: 'discord', profile: 'formal' }] } }).text, 'Hey there.');
  assert.equal(say({ proc: 'notepad.exe' }, ['Hello world.'], { style: { casual: true } }).text, 'hello world');
});

test('the deny-list wins over a user tone row: nothing is typed into a password manager', () => {
  const r = say({ proc: 'KeePassXC.exe', title: 'Passwords' }, ['hunter two'], { tone: { enabled: true, apps: [{ match: 'keepass', profile: 'casual' }] } });
  assert.equal(r.text, ''); assert.equal(r.typingOk, false); assert.equal(r.profile, 'default'); assert.deepEqual(r.typer.log, []);
});

test('the profile is read once per hold: switching windows mid-hold stops typing, it does not retarget', () => {
  const host = new FakeHost(); const typer = new MemoryTyper({ pid: 77, proc: 'Discord.exe' });
  const s = new DictationSession({ asr: host, typer, ownPid: 1, settings: { tone: { enabled: true, apps: [] } } });
  s.start(); host.emitEv('partial', { segId: 1, text: 'Hello' });
  typer.setForeground({ hwnd: 9, proc: 'OUTLOOK.EXE' });
  host.emitEv('final', { segId: 1, text: 'Hello again.' });
  assert.equal(typer.text, 'hello'.replace('hello', 'Hello'), 'text typed before the switch stays; nothing more is typed');
  assert.equal(s.profile, 'casual');
});
