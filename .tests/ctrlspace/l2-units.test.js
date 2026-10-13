'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startHelper, sim, dump, sleep, root } = require('./util');
const { DEFAULTS, normalize, Store } = require(path.join(root, 'src/main/settings.js'));
const L = require(path.join(root, 'src/renderer/lib.js'));
const { Controller } = require(path.join(root, 'src/main/controller.js'));
const { EventEmitter } = require('events');

test('default hotkey is Ctrl+Space (either Ctrl) and the picker labels it', () => {
  assert.deepEqual(DEFAULTS.hotkey.vks, [0x11, 0x20]);
  assert.equal(DEFAULTS.hotkey.label, 'Ctrl+Space');
  assert.deepEqual(normalize({}).hotkey, DEFAULTS.hotkey);
  assert.equal(L.hotkeyLabel([0x11, 0x20]), 'Ctrl + Space');
  assert.equal(L.validateHotkey([0x11, 0x20]), '', 'the picker accepts Ctrl+Space');
  assert.equal(L.validateHotkey([0x20]).length > 0, true, 'a lone Space is still refused by the picker');
});

test('the user can change it, and a chosen Pause survives (only the OLD default is migrated)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-cs-set-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ hotkey: { vks: [0x13], label: 'Pause' }, mode: 'toggle' }));
  const s = new Store(dir);
  assert.deepEqual(s.get().hotkey.vks, [0x11, 0x20], 'old default Pause (no hotkeyV) moves to Ctrl+Space');
  assert.equal(s.get().mode, undefined);
  s.set({ hotkey: { vks: [0x13], label: 'Pause' } });
  assert.deepEqual(new Store(dir).get().hotkey.vks, [0x13], 'picked again after the move: kept');
  s.set({ hotkey: { vks: [0xA3, 0x4B], label: 'Right Ctrl + K' } });
  assert.deepEqual(new Store(dir).get().hotkey.vks, [0xA3, 0x4B]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('controller claims the chord only while dictation can use it', () => {
  const typer = new EventEmitter(); const claims = [];
  Object.assign(typer, { setClaim: (on) => claims.push(on), foreground: () => ({ hwnd: 1, pid: 5, proc: 'x.exe' }) });
  const c = new Controller({ getAsr: () => null, typer, store: { get: () => ({ mode: 'hold' }) }, mic: {} });
  c.attach(); assert.deepEqual(claims, [true]);
  c.setEnabled(false); c.setEnabled(true); assert.deepEqual(claims, [true, false, true]);
  c.setCapturing(true); assert.equal(claims.at(-1), false, 'picker open: chord must reach the page');
  let started = 0; c.fsm.onAction = () => { started++; };
  typer.emit('key', { down: true }); assert.equal(started, 0, 'no dictation starts while the picker listens');
  c.setCapturing(false); assert.equal(claims.at(-1), true);
  typer.emit('key', { down: true }); assert.equal(started, 1);
  new Controller({ getAsr: () => null, typer: new EventEmitter(), store: { get: () => ({ mode: 'hold' }) }, mic: {} }).attach();   // typers without setClaim are fine
});

test('helper chord: only Ctrl THEN Space starts it; lone Ctrl, lone Space and Space-then-Ctrl never do', async () => {
  const t = await startHelper();
  try {
    assert.equal((await dump(t)).hook, '1', 'the keyboard hook installed');
    assert.equal(await sim(t, 0x20, true), 'pass', 'lone Space passes through'); assert.equal(await sim(t, 0x20, false), 'pass');
    assert.equal(await sim(t, 0xA2, true), 'pass', 'Ctrl itself always passes');
    assert.equal((await dump(t)).chord, '0', 'lone Ctrl is not a chord'); assert.equal(await sim(t, 0xA2, false), 'pass');
    await sim(t, 0x20, true); await sim(t, 0xA2, true);                          // Space held first, Ctrl second
    assert.equal((await dump(t)).chord, '0', 'Space then Ctrl is not the chord');
    assert.equal(await sim(t, 0x20, true), 'pass', 'an auto-repeat of the already-held Space does not start it either');
    assert.equal((await dump(t)).chord, '0');
    await sim(t, 0x20, false); await sim(t, 0xA2, false);
    await sleep(120); assert.deepEqual(t.keys, [], 'no KEY event for any of that');
    assert.equal(await sim(t, 0xA3, true), 'pass');                              // right Ctrl counts too (generic VK_CONTROL)
    assert.equal(await sim(t, 0x20, true), 'swallow', 'Ctrl, then Space: chord, Space swallowed');
    assert.equal((await dump(t)).chord, '1');
    assert.equal(await sim(t, 0x20, true), 'swallow', 'auto-repeat swallowed');
    await sleep(120); assert.deepEqual(t.keys, ['down']);
    assert.equal(await sim(t, 0xA3, false), 'pass', 'Ctrl released first: chord over, Ctrl up passes');
    await sleep(120); assert.deepEqual(t.keys, ['down', 'up']);
    assert.equal(await sim(t, 0x20, true), 'swallow', 'Space still held: repeats stay swallowed (apps never see half a chord)');
    assert.equal(await sim(t, 0x20, false), 'swallow', 'its up is swallowed too: no unmatched Space up');
    assert.equal((await dump(t)).swallowed, '0');
    assert.equal(await sim(t, 0x20, true), 'pass', 'afterwards a lone Space types normally again');
    await sim(t, 0x20, false);
  } finally { t.close2(); }
});

test('claim off or a lone-key hotkey: tracked, never swallowed', async () => {
  const off = await startHelper({ claim: false });
  try { await sim(off, 0xA2, true); assert.equal(await sim(off, 0x20, true), 'pass'); assert.equal((await dump(off)).chord, '1'); }
  finally { off.close2(); }
  const lone = await startHelper({ hotkey: [0x13] });
  try { assert.equal(await sim(lone, 0x13, true), 'pass'); assert.equal((await dump(lone)).chord, '1'); assert.equal(await sim(lone, 0x13, false), 'pass'); }
  finally { lone.close2(); }
});
