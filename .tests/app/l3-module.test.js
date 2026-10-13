'use strict';
/* Controller: hotkey events -> state machine -> session -> pill/state/stats, with a fake ASR host, fake mic, in-memory typer. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const root = path.join(__dirname, '..', '..');
const { Controller } = require(path.join(root, 'src/main/controller.js'));
const { Store } = require(path.join(root, 'src/main/settings.js'));
const { MemoryTyper } = require(path.join(root, 'src/typer/typer.js'));
const { FakeHost } = require(path.join(root, '.tests/asr/fakes.js'));

class EvTyper extends MemoryTyper {
  constructor(o) { super(o); this.ee = new EventEmitter(); }
  on(...a) { return this.ee.on(...a); }
  key(down) { this.ee.emit('key', { down }); }
  esc() { this.ee.emit('esc'); }
}
class FakeMic { constructor() { this.running = false; } start(cb) { this.running = true; this.cb = cb; } stop() { this.running = false; } }

function rig(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ctl-'));
  const store = new Store(dir); if (Object.keys(settings).length) store.set(settings);
  const host = new FakeHost(); const typer = new EvTyper({ pid: 77 }); const mic = new FakeMic();
  const c = new Controller({ getAsr: () => host, typer, store, mic, ownPid: 1, doneFlashMs: 20 });
  c.attach();
  const pills = []; c.on('pill', (p) => pills.push(p.state));
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  return { c, host, typer, mic, store, pills, tick, dir };
}

test('hold-to-talk: press starts mic + listening, partial typed, release -> processing -> final -> done -> idle', async () => {
  const { c, host, typer, mic, store, pills, tick } = rig({ historyEnabled: true });
  typer.key(true);
  assert.equal(mic.running, true); assert.equal(pills.at(-1), 'listening');
  await tick(300);                                  // not a tap
  host.emitEv('partial', { segId: 1, text: 'hello wor' });
  assert.equal(typer.text, 'hello wor');
  mic.cb(new Float32Array(512).fill(0.2));
  typer.key(false);
  assert.equal(mic.running, false); assert.equal(pills.at(-1), 'processing');
  host.emitEv('final', { segId: 1, text: 'Hello world.', audioSec: 1.2 });
  host.emitEv('done', {});
  assert.equal(typer.text, 'Hello world.');
  assert.equal(pills.at(-1), 'done');
  await tick(60);
  assert.equal(pills.at(-1), 'idle');
  assert.equal(store.summary().words, 2); assert.equal(store.history[0].text, 'Hello world.');
});

test('a lone quick tap dictates nothing', async () => {
  const { typer, host, pills, store } = rig();
  typer.key(true); typer.key(false);
  host.emitEv('partial', { segId: 1, text: 'ghost' });
  assert.equal(typer.text, ''); assert.equal(pills.at(-1), 'idle'); assert.equal(store.summary().words, 0);
});

test('double-tap = hands-free; next press stops it; typing continues while no key is held', async () => {
  const { typer, host, pills, mic, tick } = rig();
  typer.key(true); typer.key(false); typer.key(true); typer.key(false);
  assert.equal(pills.at(-1), 'handsfree'); assert.equal(mic.running, true);
  await tick(50);
  host.emitEv('partial', { segId: 1, text: 'still talking' });
  assert.equal(typer.text, 'still talking');
  typer.key(true);                                   // stop
  assert.equal(pills.at(-1), 'processing');
  host.emitEv('final', { segId: 1, text: 'Still talking.', audioSec: 1 }); host.emitEv('done', {});
  assert.equal(typer.text, 'Still talking.');
});

test('Esc cancels: typed segment removed, cancelled flash, no stats', async () => {
  const { typer, host, pills, store, tick } = rig();
  typer.key(true); await tick(300);
  host.emitEv('partial', { segId: 1, text: 'oops wrong' });
  typer.esc();
  assert.equal(typer.text, ''); assert.equal(pills.at(-1), 'cancelled');
  host.emitEv('final', { segId: 1, text: 'Oops wrong.', audioSec: 1 }); host.emitEv('done', {});
  assert.equal(typer.text, ''); assert.equal(store.summary().words, 0);
});

test('no history written while history is off', async () => {
  const { typer, host, store, tick } = rig();
  typer.key(true); await tick(300); typer.key(false);
  host.emitEv('final', { segId: 1, text: 'Private note.', audioSec: 1 }); host.emitEv('done', {});
  assert.equal(store.history.length, 0); assert.equal(store.summary().words, 2);
});

test('engine not ready: red pill, no session', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ctl-'));
  const typer = new EvTyper({}); const c = new Controller({ getAsr: () => null, typer, store: new Store(dir), mic: new FakeMic() });
  c.attach(); const pills = []; c.on('pill', (p) => pills.push(p));
  typer.key(true);
  assert.equal(pills.at(-1).state, 'error'); assert.match(pills.at(-1).note, /not ready/);
});

test('disabled from the tray: keys ignored', () => {
  const { c, typer, mic } = rig();
  c.setEnabled(false); typer.key(true);
  assert.equal(mic.running, false);
});

test('toggle mode: press, press', async () => {
  const { typer, mic, tick, host } = rig({ mode: 'toggle' });
  // the Controller reads the mode at construction; applySettings picks up later changes
  typer.key(true); typer.key(false);
  assert.equal(mic.running, true, 'release does not stop in toggle mode');
  await tick(10); typer.key(true);
  assert.equal(mic.running, false);
  host.emitEv('done', {});
});

test('deny-listed window: pill says typing is off, nothing typed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ctl-'));
  const typer = new EvTyper({ proc: 'KeePassXC.exe', pid: 5 }); const host = new FakeHost();
  const c = new Controller({ getAsr: () => host, typer, store: new Store(dir), mic: new FakeMic(), ownPid: 1 });
  c.attach(); const pills = []; c.on('pill', (p) => pills.push(p));
  typer.key(true);
  assert.match(pills.at(-1).note, /off in this window/);
  host.emitEv('partial', { segId: 1, text: 'hunter2' });
  assert.equal(typer.log.length, 0);
});
