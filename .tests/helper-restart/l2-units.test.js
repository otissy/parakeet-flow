'use strict';
/* The helper owns the global keybinds. If it dies by itself the app must start a new one and give it the
   keybinds back (the 0.2.4 report: "the keybind is gone"). A helper in test mode (SIM only, no real keys). */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..', '..');
const { Win32Typer } = require(path.join(root, 'src/typer/win32-typer.js'));
const BIN = path.join(os.tmpdir(), 'pf-restart-bin');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (em, ev, ms = 8000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout waiting for ' + ev)), ms); em.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const kill = (pid) => spawnSync('taskkill', ['/F', '/PID', String(pid)]);
async function dump(t) { t.lines = []; t.raw('DUMP'); for (let i = 0; i < 100; i++) { const l = t.lines.find((x) => x[0] === 'DUMP'); if (l) return l.join(' '); await sleep(30); } throw new Error('no DUMP reply'); }
function make(opts = {}) { const t = new Win32Typer(Object.assign({ binDir: BIN, test: true, restart: true, restartDelayMs: 50 }, opts)); t.lines = []; t.on('line', (a) => t.lines.push(a)); return t; }

test('a helper that dies by itself is replaced, and the hotkey, toggle key and claim come back', async () => {
  const t = make();
  try {
    await t.ready;
    t.setHotkey([0x11, 0x20]); t.setClaim(true); t.setToggleKey(0x14);
    const first = t.proc.pid;
    kill(first);
    await once(t, 'exit');
    await once(t, 'restarted');
    assert.notStrictEqual(t.proc.pid, first, 'a new process');
    assert.ok(alive(t.proc.pid));
    const d = await dump(t);
    assert.match(d, /hook=1/, d);
    assert.match(d, /claim=1/, d);
    assert.match(d, /toggle=20/, d);
    assert.strictEqual(t.restarts, 1);
  } finally { t.close(); }
});

test('close() is final: no helper comes back afterwards', async () => {
  const t = make();
  await t.ready;
  const pid = t.proc.pid;
  t.close();
  await sleep(500);
  assert.strictEqual(alive(pid), false);
  assert.strictEqual(t.restarts, 0);
  await sleep(300);
  assert.strictEqual(t.restarts, 0);
});

test('restart is off by default in test mode: a killed test helper stays dead', async () => {
  const t = make({ restart: undefined });
  try {
    await t.ready;
    const pid = t.proc.pid;
    kill(pid);
    await once(t, 'exit');
    await sleep(400);
    assert.strictEqual(t.restarts, 0);
  } finally { t.close(); }
});

test('a helper that keeps dying is given up on after 8 quick deaths instead of looping forever', async () => {
  const t = make({ restartDelayMs: 10 });
  try {
    await t.ready;
    let gaveUp = false; t.on('giveup', () => { gaveUp = true; });
    for (let i = 0; i < 12 && !gaveUp; i++) {
      kill(t.proc.pid);
      await Promise.race([once(t, 'restarted', 6000).catch(() => {}), once(t, 'giveup', 6000).catch(() => {})]);
    }
    assert.ok(gaveUp, 'gave up');
    assert.ok(t.restarts <= 8, 'restarts: ' + t.restarts);
  } finally { t.close(); }
});
