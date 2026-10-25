'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const si = require(path.join(__dirname, '..', '..', 'src', 'main', 'single-instance.js'));
const { noWait } = require('./helpers.js');

test('handoverData carries the handover kind and this pid', () => {
  const d = si.handoverData();
  assert.strictEqual(d.kind, si.HANDOVER);
  assert.strictEqual(d.pid, process.pid);
  assert.ok(d.at > 0);
});

test('onSecondInstance: handover data quits and never shows', () => {
  let shown = 0, quit = 0;
  const h = si.onSecondInstance({ show: () => shown++, quit: () => quit++ });
  assert.strictEqual(h({}, [], '', si.handoverData()), 'quit');
  assert.deepStrictEqual([shown, quit], [0, 1]);
});

test('onSecondInstance: no data (an older start) and foreign data only show the window', () => {
  let shown = 0, quit = 0;
  const h = si.onSecondInstance({ show: () => shown++, quit: () => quit++ });
  const inputs = [undefined, null, 'x', 5, {}, { kind: 'something-else' }, []];
  for (const data of inputs) assert.strictEqual(h({}, [], '', data), 'show');
  assert.deepStrictEqual([shown, quit], [inputs.length, 0]);
});

test('onSecondInstance: a throwing quit or show is logged, not thrown', () => {
  const logs = [];
  const h = si.onSecondInstance({ show: () => { throw new Error('boom show'); }, quit: () => { throw new Error('boom quit'); }, log: (t) => logs.push(t) });
  assert.doesNotThrow(() => h({}, [], '', si.handoverData()));
  assert.doesNotThrow(() => h({}, [], '', undefined));
  assert.strictEqual(logs.filter((l) => /handler failed/.test(l)).length, 2);
});

test('onSecondInstance: missing callbacks do not crash', () => {
  const h = si.onSecondInstance();
  assert.doesNotThrow(() => { h({}, [], '', si.handoverData()); h({}, [], '', null); });
});

test('waitForTakeover: false at once for a missing or broken app', async () => {
  assert.strictEqual(await si.waitForTakeover(), false);
  assert.strictEqual(await si.waitForTakeover({ app: {} }), false);
  assert.strictEqual(await si.waitForTakeover({ app: { requestSingleInstanceLock: 5 } }), false);
});

test('waitForTakeover: true as soon as the lock frees, counting the checks', async () => {
  let n = 0;
  const logs = [];
  const app = { requestSingleInstanceLock: () => ++n >= 3 };
  assert.strictEqual(await si.waitForTakeover({ app, attempts: 10, delayMs: 1, wait: noWait, log: (t) => logs.push(t) }), true);
  assert.strictEqual(n, 3);
  assert.match(logs.join('|'), /left after 3 checks/);
});

test('waitForTakeover: gives up after exactly `attempts` checks', async () => {
  let n = 0;
  const app = { requestSingleInstanceLock: () => { n++; return false; } };
  assert.strictEqual(await si.waitForTakeover({ app, attempts: 4, delayMs: 1, wait: noWait }), false);
  assert.strictEqual(n, 4);
});

test('waitForTakeover: zero attempts and a throwing lock call both end in false, never a throw', async () => {
  const app0 = { requestSingleInstanceLock: () => true };
  assert.strictEqual(await si.waitForTakeover({ app: app0, attempts: 0, wait: noWait }), false);
  const logs = [];
  const bad = { requestSingleInstanceLock: () => { throw new Error('nope'); } };
  assert.strictEqual(await si.waitForTakeover({ app: bad, attempts: 3, wait: noWait, log: (t) => logs.push(t) }), false);
  assert.match(logs.join('|'), /lock call failed: nope/);
});

test('waitForTakeover: a failing wait() ends in false', async () => {
  const app = { requestSingleInstanceLock: () => true };
  assert.strictEqual(await si.waitForTakeover({ app, attempts: 3, wait: () => Promise.reject(new Error('timer')) }), false);
});

test('relaunchAsNewest: releases, relaunches and exits in that order; failures return false', () => {
  const order = [];
  const app = { releaseSingleInstanceLock: () => order.push('release'), relaunch: () => order.push('relaunch'), exit: (c) => order.push('exit' + c) };
  assert.strictEqual(si.relaunchAsNewest({ app }), true);
  assert.deepStrictEqual(order, ['release', 'relaunch', 'exit0']);
  const logs = [];
  const broken = { releaseSingleInstanceLock() { throw new Error('x'); } };
  assert.strictEqual(si.relaunchAsNewest({ app: broken, log: (t) => logs.push(t) }), false);
  assert.strictEqual(si.relaunchAsNewest(), false);
  assert.match(logs.join('|'), /relaunch failed: x/);
});
