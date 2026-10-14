'use strict';
/* Duplicated / glued insertions seen in the user's Claude Code prompt on 2026-10-14:
   "...second sentence here.hello world, it is a nice day. second sentence here.hello world, ..." (the same text again, no space).
   Controller + session + typer with several consecutive holds, duplicate events, and both settings of the commands carry. */
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
}
class FakeMic { start(cb) { this.cb = cb; } stop() {} }

function rig(settings = {}, proc = 'node.exe') {
  const dir = fs.mkdtempSync(path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'pf-multi-'));
  const store = new Store(dir); if (Object.keys(settings).length) store.set(settings);
  const host = new FakeHost(); const typer = new EvTyper({ pid: 77, proc }); typer.fg.title = 'x';
  const c = new Controller({ getAsr: () => host, typer, store, mic: new FakeMic(), ownPid: 1, doneFlashMs: 5 });
  c.attach();
  const results = []; c.on('result', (r) => results.push(r));
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  /** one hold: partials preview, finals, key release, the ASR "done", with optional duplicate events like a VAD endpoint + key release both finalising */
  async function hold(finals, { dupFinals = false, dupDone = false } = {}) {
    typer.key(true); await tick(300);
    let seg = 1;
    for (const f of finals) {
      host.emitEv('partial', { segId: seg, text: f.slice(0, Math.ceil(f.length / 2)) });
      host.emitEv('final', { segId: seg, text: f, audioSec: 1 });
      if (dupFinals) host.emitEv('final', { segId: seg, text: f, audioSec: 1 });
      seg++;
    }
    typer.key(false);
    host.emitEv('done', {}); if (dupDone) host.emitEv('done', {});
    await tick(40);
  }
  return { c, host, typer, store, results, hold, tick };
}
const UTTERANCES = ['Hello world, it is a nice day.', 'Second sentence here.', 'Btw I want you to make sure that you point me to the build folder.', 'Okay that was the last one.', 'Een Nederlandse zin met accenten: café.', 'And a sixth, short.'];

for (const [label, settings] of [['default settings (commands carry on)', {}], ['commands and notes switched off (no carry)', { commands: { enabled: false }, notes: { enabled: false } }]]) {
  test(`${label}: 6 consecutive holds, each utterance exactly once, in order, one space between insertions, never glued`, async () => {
    const { typer, hold, results } = rig(settings);
    for (const u of UTTERANCES) await hold([u]);
    const want = UTTERANCES.map((u) => u.replace(/^./, (ch) => ch.toLowerCase())).join(' ');     // terminal (code tone): first letter lower-case, punctuation kept
    assert.equal(typer.text, want);
    assert.equal(typer.log.length, UTTERANCES.length, 'one insertion per hold');
    assert.ok(!/\.[a-z]/.test(typer.text.replace(/\bhello\.world/g, '')) && !/ {2}/.test(typer.text), 'no glued sentence, no double space');
    for (const u of UTTERANCES) assert.equal(typer.text.split(u.slice(2, 14)).length - 1, 1, 'appears exactly once: ' + u.slice(0, 12));
    assert.deepEqual(results.map((r) => r.insertions), UTTERANCES.map(() => 1));
  });

  test(`${label}: duplicate finals and duplicate "done" events never insert twice`, async () => {
    const { typer, hold, results } = rig(settings);
    await hold([UTTERANCES[0], UTTERANCES[1]], { dupFinals: true, dupDone: true });
    await hold([UTTERANCES[2]], { dupFinals: true, dupDone: true });
    assert.equal(typer.text, 'hello world, it is a nice day. second sentence here. btw I want you to make sure that you point me to the build folder.');
    assert.equal(typer.log.length, 2);
    assert.deepEqual(results.map((r) => [r.finals, r.insertions, r.duplicateFinals]), [[2, 1, 2], [1, 1, 1]], 'counts per hold, no text');
  });
}

test('a normal app gets capitals and the same exact-once, single-space behaviour', async () => {
  const { typer, hold } = rig({}, 'notepad.exe');
  for (const u of UTTERANCES.slice(0, 4)) await hold([u]);
  assert.equal(typer.text, UTTERANCES.slice(0, 4).join(' '));
  assert.equal(typer.log.length, 4);
});

test('the memory of the last insertion is per window and expires: another window starts clean', async () => {
  const { typer, hold } = rig({ commands: { enabled: false }, notes: { enabled: false } });
  await hold(['First one.']);
  typer.setForeground({ hwnd: 2, pid: 78, proc: 'node.exe' });
  await hold(['Other window.']);
  assert.equal(typer.text, 'first one.other window.'.replace('.other', '.other'), 'MemoryTyper keeps one buffer; the second window got no leading space');
  assert.ok(!typer.text.includes('. other'));
});

test('the log line carries counts only (finals, insertions), no dictated text', async () => {
  const { results, hold } = rig();
  await hold(['Secret words one.', 'Secret words two.']);
  const line = JSON.stringify(results[0]);
  assert.ok(!/ecret/.test(line)); assert.equal(results[0].finals, 2); assert.equal(results[0].insertions, 1);
});
