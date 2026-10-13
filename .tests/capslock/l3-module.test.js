'use strict';
/* The real helper process in test mode: physical keys are SIMULATED into the hook logic (SIM), nothing is pressed on this machine.
   Then Controller + real Win32Typer + FSM together. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startHelper, sim, dump, sleep, root } = require('./util');

const CAPS = 0x14;
const done = (t) => { try { t.close(); } catch (_) { /* gone */ } };

test('CapsLock down, auto-repeat and up are all swallowed; one TOGGLE per real press, none for repeats', async () => {
  const t = await startHelper();
  try {
    assert.equal(await sim(t, CAPS, true), 'swallow'); assert.equal(await sim(t, CAPS, true), 'swallow'); assert.equal(await sim(t, CAPS, true), 'swallow');
    assert.equal(await sim(t, CAPS, false), 'swallow');
    await sleep(120); assert.equal(t.toggles.length, 1, 'repeats are not presses');
    assert.equal(await sim(t, CAPS, true), 'swallow'); assert.equal(await sim(t, CAPS, false), 'swallow');
    await sleep(120); assert.equal(t.toggles.length, 2);
    assert.equal((await dump(t)).tsw, '0', 'nothing left pending');
  } finally { done(t); }
});

test('TOGGLE 0 (switch off / paused / quit): CapsLock passes both ways at once, no event', async () => {
  const t = await startHelper();
  try {
    t.setToggleKey(0); await sleep(50);
    assert.equal(await sim(t, CAPS, true), 'pass'); assert.equal(await sim(t, CAPS, false), 'pass');
    await sleep(100); assert.equal(t.toggles.length, 0);
  } finally { done(t); }
});

test('switched off while CapsLock is physically held: the rest of that press (repeats, up) is still swallowed, then normal', async () => {
  const t = await startHelper();
  try {
    assert.equal(await sim(t, CAPS, true), 'swallow');
    t.setToggleKey(0); await sleep(50);
    assert.equal(await sim(t, CAPS, true), 'swallow', 'repeat of a swallowed press');
    assert.equal(await sim(t, CAPS, false), 'swallow', 'its up');
    assert.equal(await sim(t, CAPS, true), 'pass', 'the next press is normal');
    assert.equal(await sim(t, CAPS, false), 'pass');
  } finally { done(t); }
});

test('another toggle key (F9) is reported but never swallowed; CapsLock then is a plain key', async () => {
  const t = await startHelper({ toggle: 0x78 });
  try {
    assert.equal(await sim(t, 0x78, true), 'pass'); assert.equal(await sim(t, 0x78, false), 'pass');
    assert.equal(await sim(t, CAPS, true), 'pass'); assert.equal(await sim(t, CAPS, false), 'pass');
    await sleep(100); assert.equal(t.toggles.length, 1);
  } finally { done(t); }
});

test('Ctrl+Space hold chord and CapsLock work side by side; CapsLock does not disturb the chord', async () => {
  const t = await startHelper();
  try {
    assert.equal(await sim(t, 0xA2, true), 'pass'); assert.equal(await sim(t, 0x20, true), 'swallow'); await sleep(80);
    assert.deepEqual(t.keys, ['down']);
    assert.equal(await sim(t, CAPS, true), 'swallow'); assert.equal(await sim(t, CAPS, false), 'swallow');   // toggle during the hold
    await sleep(80); assert.equal(t.toggles.length, 1); assert.deepEqual(t.keys, ['down'], 'CapsLock did not touch the chord');
    assert.equal(await sim(t, 0x20, false), 'swallow'); assert.equal(await sim(t, 0xA2, false), 'pass'); await sleep(80);
    assert.deepEqual(t.keys, ['down', 'up']);
  } finally { done(t); }
});

test('typing bursts never send a CapsLock key', async () => {
  const t = await startHelper();
  try {
    for (let i = 0; i < 100 && !t.foreground(); i++) { t.queryForeground(); await sleep(30); }
    const hwnd = t.foreground().hwnd;
    await sim(t, 0xA2, true); await sim(t, 0x20, true); await sleep(60);
    t.type('Hello', { hwnd }); t.backspace(2, { hwnd }); await sleep(250);
    const sent = t.lines.filter((l) => l[0] === 'SENT').map((l) => l.slice(1).join(' ')).join(' ');
    assert.ok(sent.length > 0); assert.ok(!/(^| )14:/.test(sent), 'no VK_CAPITAL in anything sent: ' + sent);
  } finally { done(t); }
});

/* Controller + real Win32Typer + FSM, the whole gesture matrix through the helper's real event path */
const { Controller } = require(path.join(root, 'src/main/controller.js'));
const { Store } = require(path.join(root, 'src/main/settings.js'));
const { FakeHost } = require(path.join(root, '.tests/asr/fakes.js'));

async function rig(settings = {}) {
  const t = await startHelper({ toggle: 0, hold: [] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-caps-ctl-'));
  const store = new Store(dir); if (Object.keys(settings).length) store.set(settings);
  const host = new FakeHost(); const mic = { running: false, start() { this.running = true; }, stop() { this.running = false; } };
  const c = new Controller({ getAsr: () => host, typer: t, store, mic, ownPid: 1, doneFlashMs: 10 });
  c.attach(); t.setHotkey(store.get().hotkey.vks);
  const pills = []; c.on('pill', (p) => pills.push(p.state));
  return { t, c, host, mic, pills, store };
}
const press = async (t, vk) => { await sim(t, vk, true); await sim(t, vk, false); await sleep(100); };

test('controller+helper: CapsLock press starts hands-free, next stops; Ctrl+Space hold works', async () => {
  const { t, mic, pills, host } = await rig();
  try {
    await press(t, CAPS); assert.equal(mic.running, true); assert.equal(pills.at(-1), 'handsfree');
    await press(t, CAPS); assert.equal(mic.running, false); assert.equal(pills.at(-1), 'processing'); host.emitEv('done', {});
    await sleep(60);
    await sim(t, 0xA2, true); await sim(t, 0x20, true); await sleep(300); assert.equal(mic.running, true); assert.equal(pills.at(-1), 'listening');
    await sim(t, 0x20, false); await sim(t, 0xA2, false); await sleep(100); assert.equal(mic.running, false);
  } finally { done(t); }
});

test('controller+helper PRECEDENCE: hold during a toggle session wins; its release does not stop the session; the next CapsLock does', async () => {
  const { t, mic, pills } = await rig();
  try {
    await press(t, CAPS); assert.equal(mic.running, true);
    await sim(t, 0xA2, true); await sim(t, 0x20, true); await sleep(900);                    // a long hold on top
    assert.equal(mic.running, true); assert.equal(pills.at(-1), 'handsfree', 'still the toggle session');
    await press(t, CAPS); assert.equal(mic.running, true, 'CapsLock while the hold is down is ignored (hold wins)');
    await sim(t, 0x20, false); await sim(t, 0xA2, false); await sleep(120);
    assert.equal(mic.running, true, 'hold release did NOT stop the toggle session');
    await press(t, CAPS); assert.equal(mic.running, false, 'the next CapsLock stops it');
  } finally { done(t); }
});

test('controller+helper: pausing in the tray or the switch turns CapsLock back to normal at once', async () => {
  const { t, c, mic, store } = await rig();
  try {
    assert.equal((await dump(t)).toggle, '20');
    c.setEnabled(false); await sleep(80); assert.equal((await dump(t)).toggle, '0'); assert.equal(await sim(t, CAPS, true), 'pass'); await sim(t, CAPS, false);
    c.setEnabled(true); await sleep(80); assert.equal((await dump(t)).toggle, '20');
    store.set({ toggleOn: false }); c.applySettings(); await sleep(80); assert.equal((await dump(t)).toggle, '0');
    await press(t, CAPS); assert.equal(mic.running, false);
  } finally { done(t); }
});
