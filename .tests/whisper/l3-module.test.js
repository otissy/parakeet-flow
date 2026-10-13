'use strict';
/* Whisper mode through the Controller: gain on the mic stream, VAD threshold set before the session starts, a visible flag. */
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

function rig(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-wh-'));
  const store = new Store(dir); if (Object.keys(settings).length) store.set(settings);
  const host = new FakeHost(); const order = [];
  host.setVad = (t) => order.push('vad ' + t);
  const start = host.start.bind(host); host.start = () => { order.push('start'); return start(); };
  const typer = new EvTyper({ pid: 77 }); const mic = new FakeMic();
  const c = new Controller({ getAsr: () => host, typer, store, mic, ownPid: 1 }); c.attach();
  return { c, host, typer, mic, order, store };
}

test('whisper on: threshold is set BEFORE the session starts, mic audio is amplified (and clipped), the flag is on', () => {
  const { c, typer, mic, order } = rig({ whisper: { enabled: true, gain: 4, vadThreshold: 0.2 } });
  assert.equal(c.flags().whisper, true);
  typer.key(true);
  assert.deepEqual(order, ['vad 0.2', 'start']);
  let seen = null; const asr = c.session.asr; asr.pushAudio = (f) => { seen = f; };
  mic.cb(Float32Array.from([0.1, -0.1, 0.4]));
  assert.deepEqual(Array.from(seen).map((x) => +x.toFixed(2)), [0.4, -0.4, 1]);
});

test('whisper off: normal threshold, audio untouched, flag off', () => {
  const r = rig();
  assert.equal(r.c.flags().whisper, false);
  r.typer.key(true); assert.deepEqual(r.order, ['vad 0.5', 'start']);
  let seen = null; r.c.session.asr.pushAudio = (f) => { seen = f; };
  const chunk = Float32Array.from([0.1, -0.2]); r.mic.cb(chunk);
  assert.equal(seen, chunk, 'the very same samples');
});

test('whisper switched on then off: the next session is back to the normal threshold and untouched audio', async () => {
  const r = rig({ whisper: { enabled: true, gain: 4, vadThreshold: 0.2 } });
  r.typer.key(true); r.typer.key(false);                        // a lone tap: session cancelled
  r.store.set({ whisper: { enabled: false, gain: 4, vadThreshold: 0.2 } }); r.c.applySettings();
  r.order.length = 0;
  await new Promise((x) => setTimeout(x, 450));
  r.typer.key(true);
  assert.deepEqual(r.order, ['vad 0.5', 'start']);
  let seen = null; r.c.session.asr.pushAudio = (f) => { seen = f; };
  const chunk = Float32Array.from([0.3]); r.mic.cb(chunk); assert.equal(seen, chunk);
});

test('flags: translate and cleanup show up for the pill too; applySettings announces them', () => {
  const { c, store } = rig();
  const seen = []; c.on('flags', (f) => seen.push(f));
  store.set({ translate: { enabled: true, target: 'swap' }, cleanup: { enabled: true, timeoutMs: 1500, threads: 2, idleMin: 5 }, whisper: { enabled: true, gain: 3, vadThreshold: 0.3 } });
  c.applySettings();
  assert.deepEqual(seen.at(-1), { whisper: true, translate: 'swap', cleanup: true });
});
