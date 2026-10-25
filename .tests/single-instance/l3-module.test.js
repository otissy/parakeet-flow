'use strict';
// Two or three fake processes sharing one lock, wired exactly like main.js wires them.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const si = require(path.join(__dirname, '..', '..', 'src', 'main', 'single-instance.js'));
const { makeLockWorld, noWait } = require('./helpers.js');

function boot(world, name, opts) {
  // the same sequence as main.js: ask for the lock with handover data; the holder wires the handler
  const app = world.makeApp(name, opts);
  const state = { shown: 0, name, app, takeoverResult: null, relaunched: false, holds: false };
  const lock = app.requestSingleInstanceLock(si.handoverData());
  if (lock) {
    app.on('second-instance', si.onSecondInstance({ show: () => state.shown++, quit: () => app.quit() }));
    state.holds = true;
  } else {
    state.pending = si.waitForTakeover({ app, attempts: 5, delayMs: 1, wait: noWait })
      .then((won) => { state.takeoverResult = won; if (won) state.relaunched = si.relaunchAsNewest({ app }); else app.quit(); });
  }
  return state;
}

test('the NEWEST start wins: the old copy quits, the new one takes over and relaunches clean', async () => {
  const w = makeLockWorld();
  const oldCopy = boot(w, 'old');
  assert.ok(oldCopy.holds);
  const fresh = boot(w, 'new');
  await fresh.pending;
  assert.strictEqual(oldCopy.app.quitCalls, 1, 'the running copy was asked to quit');
  assert.strictEqual(oldCopy.shown, 0, 'and did NOT just show its window');
  assert.strictEqual(fresh.takeoverResult, true);
  assert.strictEqual(fresh.app.released, 1);
  assert.strictEqual(fresh.app.relaunched, 1);
  assert.strictEqual(fresh.app.exited, 0);
  assert.strictEqual(w.holder, null, 'the lock is free for the relaunched process');
});

test('a running copy that will not quit: the new start gives up and exits, the old one stays', async () => {
  const w = makeLockWorld();
  const stubborn = w.makeApp('stubborn', { quitsOnRequest: false });
  stubborn.requestSingleInstanceLock(si.handoverData());
  stubborn.on('second-instance', si.onSecondInstance({ show() {}, quit: () => stubborn.quit() }));
  const fresh = boot(w, 'new');
  await fresh.pending;
  assert.strictEqual(fresh.takeoverResult, false);
  assert.strictEqual(fresh.app.quitCalls, 1);
  assert.strictEqual(fresh.app.relaunched, 0);
  assert.strictEqual(w.holder, stubborn);
});

test('an OLDER build (sends no data) starting against a new copy only shows the window', () => {
  const w = makeLockWorld();
  const running = boot(w, 'running');
  const olderBuild = w.makeApp('older');
  assert.strictEqual(olderBuild.requestSingleInstanceLock(), false);   // no handover data, like 0.2.3
  assert.strictEqual(running.shown, 1);
  assert.strictEqual(running.app.quitCalls, 0);
});

test('three quick starts: the first copy is told to quit, nobody crashes, at most the latest ones relaunch', async () => {
  const w = makeLockWorld();
  const a = boot(w, 'a');
  const b = boot(w, 'b');
  const c = boot(w, 'c');
  await Promise.all([b.pending, c.pending]);
  assert.ok(a.app.quitCalls >= 1);
  const winners = w.apps.filter((x) => x.relaunched === 1);
  assert.ok(winners.length >= 1 && winners.length <= 2, `winners: ${winners.length}`);
  assert.ok(w.apps.every((x) => x.exited === null || x.exited === 0));
});

test('a broken lock call in the waiting start ends it cleanly (no throw, no relaunch loop)', async () => {
  const w = makeLockWorld();
  boot(w, 'old');
  const broken = w.makeApp('broken', { throwOnLock: true });
  const won = await si.waitForTakeover({ app: broken, attempts: 3, wait: noWait });
  assert.strictEqual(won, false);
  assert.strictEqual(broken.relaunched, 0);
});
