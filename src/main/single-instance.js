'use strict';
/* One Parakeet Flow at a time, and the NEWEST start wins.
   Electron's single-instance lock normally lets the oldest copy win: a second start only shows the old window,
   even when the old copy is an out-of-date build. Here a second start tells the running copy to quit
   (second-instance data carries `kind: HANDOVER`), waits until the lock is free, then relaunches itself.
   An older Parakeet Flow that sends no data keeps today's behaviour: the running copy just shows its window.
   If the running copy does not leave in time, the new start gives up and exits (old wins, as before). */

const HANDOVER = 'parakeet-flow:handover';
const DEFAULTS = { attempts: 40, delayMs: 250 };   // 10 s in total

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Data sent with every lock request so the running copy knows this is a newer start. */
function handoverData() { return { kind: HANDOVER, pid: process.pid, at: Date.now() }; }

/** Called by the START THAT FAILED to get the lock. Resolves true when the old copy has gone and the lock is ours,
    false when it never left. Never throws: a broken lock call counts as "did not leave". */
async function waitForTakeover({ app, attempts = DEFAULTS.attempts, delayMs = DEFAULTS.delayMs, wait = sleep, log = () => {} } = {}) {
  if (!app || typeof app.requestSingleInstanceLock !== 'function') return false;
  for (let i = 1; i <= attempts; i++) {
    try { await wait(delayMs); } catch (e) { return false; }
    let got = false;
    try { got = !!app.requestSingleInstanceLock(handoverData()); }
    catch (e) { log(`single-instance: lock call failed: ${e && e.message}`); return false; }
    if (got) { log(`single-instance: old copy left after ${i} checks`); return true; }
  }
  log(`single-instance: old copy did not leave within ${attempts * delayMs} ms`);
  return false;
}

/** The 'second-instance' handler of the RUNNING copy. Newer start (handover data) -> quit; anything else -> show the window. */
function onSecondInstance({ show, quit, log = () => {} } = {}) {
  return (_event, _argv, _cwd, data) => {
    const handover = !!data && typeof data === 'object' && data.kind === HANDOVER;
    try {
      if (handover) { log('single-instance: a newer start asked this copy to quit'); if (typeof quit === 'function') quit(); }
      else if (typeof show === 'function') show();
    } catch (e) { log(`single-instance: handler failed: ${e && e.message}`); }
    return handover ? 'quit' : 'show';
  };
}

/** The start that won the lock after waiting: give the lock back and start a clean process that boots normally. */
function relaunchAsNewest({ app, log = () => {} } = {}) {
  try {
    app.releaseSingleInstanceLock();
    app.relaunch();
    app.exit(0);
    return true;
  } catch (e) { log(`single-instance: relaunch failed: ${e && e.message}`); return false; }
}

module.exports = { HANDOVER, DEFAULTS, handoverData, waitForTakeover, onSecondInstance, relaunchAsNewest };
