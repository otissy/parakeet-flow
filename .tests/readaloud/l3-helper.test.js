'use strict';
/* The real pf-helper process in test mode: selection capture with the clipboard saved and put back exactly (including a non-text format),
   and the read-aloud chord. Physical keys are SIMULATED (SIM) and sent keys are CAPTURED (SENT): nothing is pressed on this machine.
   The clipboard IS used (as the existing paste tests do); each test sets it first and checks it after. */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { Win32Typer } = require(path.join(root, 'src/typer/win32-typer.js'));

const BIN = path.join(os.tmpdir(), 'pf-ra-bin');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s, 'utf16le').toString('base64');

async function start() {
  const t = new Win32Typer({ binDir: BIN, test: true });
  await t.ready;
  t.lines = []; t.reads = 0; t.keys = [];
  t.on('line', (a) => t.lines.push(a));
  t.on('read', () => { t.reads++; });
  t.on('key', (e) => t.keys.push(e.down ? 'down' : 'up'));
  t.raw('CAPTURE 1');                       // real keys on this PC are never tracked, sent keys are reported instead of pressed
  return t;
}
async function ask(t, cmd, kind, ms = 3000) {
  const n = t.lines.filter((l) => l[0] === kind).length;
  t.raw(cmd);
  for (let i = 0; i < ms / 10; i++) { const got = t.lines.filter((l) => l[0] === kind); if (got.length > n) return got[got.length - 1]; await sleep(10); }
  throw new Error('no ' + kind + ' reply to ' + cmd);
}
const sim = async (t, vk, down) => (await ask(t, `SIM ${vk} ${down ? 'down' : 'up'}`, 'SIM'))[1];
const clipX = async (t) => { const l = await ask(t, 'CLIPGETX', 'CLIPX'); return { text: l[1] === '-' ? null : Buffer.from(l[1], 'base64').toString('utf8'), bytes: l[2] === '-' ? null : Buffer.from(l[2], 'base64') }; };
const putX = async (t, text, bytes) => ask(t, `CLIPPUTX ${b64(text)} ${Buffer.from(bytes).toString('base64')}`, 'OK');

test('selection capture returns the selected text and puts the previous clipboard back exactly, a non-text format included', async () => {
  const t = await start();
  try {
    await putX(t, 'my previous clipboard', [1, 2, 3, 250, 0, 7]);
    t.raw('SELSIM ' + b64('the selected words, with é and 中'));
    const r = await t.copySelection();
    assert.deepEqual(r, { ok: true, text: 'the selected words, with é and 中' });
    const after = await clipX(t);
    assert.equal(after.text, 'my previous clipboard', 'the text of the old clipboard is back');
    assert.deepEqual([...after.bytes], [1, 2, 3, 250, 0, 7], 'the custom format is back, byte for byte');
  } finally { t.close(); }
});

test('an empty clipboard stays empty after a capture', async () => {
  const t = await start();
  try {
    await ask(t, 'CLIPPUTX ' + b64('x') + ' AQ==', 'OK');
    // empty it through a capture of an empty-clipboard state: put nothing, simulate, check afterwards
    t.raw('SELSIM ' + b64('picked'));
    const r = await t.copySelection();
    assert.equal(r.text, 'picked');
    assert.equal((await clipX(t)).text, 'x');
  } finally { t.close(); }
});

test('no selection: nothing is copied, the clipboard is not touched, and the reason is "none"', async () => {
  const t = await start();
  try {
    await putX(t, 'keep me', [9, 9]);
    const t0 = Date.now();
    const r = await t.copySelection();
    assert.deepEqual(r, { ok: false, reason: 'none' });
    assert.ok(Date.now() - t0 < 2500, 'gives up after the short wait');
    const sent = t.lines.filter((l) => l[0] === 'SENT').map((l) => l.slice(1).join(' '));
    assert.ok(sent.some((x) => /^11:D 43:D 43:U 11:U$/.test(x)), 'it pressed exactly Ctrl+C: ' + JSON.stringify(sent));
    const c = await clipX(t);
    assert.equal(c.text, 'keep me'); assert.deepEqual([...c.bytes], [9, 9]);
  } finally { t.close(); }
});

test('a clipboard that cannot be given back exactly is left alone and nothing is read', async () => {
  const t = await start();
  try {
    await ask(t, 'CLIPLOSSY', 'OK');
    t.raw('SELSIM ' + b64('should not be read'));
    const r = await t.copySelection();
    assert.deepEqual(r, { ok: false, reason: 'clipboard-not-restorable' });
    assert.equal((await clipX(t)).text, 'lossy', 'the clipboard was not touched');
    t.raw('SELSIM ');      // clear the pending simulated copy so it cannot leak into the next test
  } finally { t.close(); }
});

test('Alt held (the read chord not yet released): it waits, and gives up with "keys-held" instead of sending Ctrl+Alt+C', async () => {
  const t = await start();
  try {
    await putX(t, 'orig', [5]);
    assert.equal(await sim(t, 0xA4, true), 'pass');
    t.raw('SELSIM ' + b64('x'));
    const t0 = Date.now();
    const r = await t.copySelection({ timeoutMs: 6000 });
    assert.deepEqual(r, { ok: false, reason: 'keys-held' });
    assert.ok(Date.now() - t0 >= 1200, 'it waited for the keys to be let go before giving up');
    assert.equal(t.lines.filter((l) => l[0] === 'SENT').length, 0, 'no key was sent while Alt was down');
    assert.equal((await clipX(t)).text, 'orig');
    await sim(t, 0xA4, false);
  } finally { t.close(); }
});

test('the read chord (Ctrl+Alt+R): one read per press, the R is swallowed, repeats and the up too; Ctrl+R alone passes; dictation keys unaffected', async () => {
  const t = await start();
  try {
    t.setHotkey([0x11, 0x20]); t.setClaim(true); t.setHotkey3([0x11, 0x12, 0x52]);
    await sleep(150);
    assert.equal(await sim(t, 0x52, true), 'pass', 'R alone is a normal key'); await sim(t, 0x52, false);
    await sim(t, 0xA2, true);
    assert.equal(await sim(t, 0x52, true), 'pass', 'Ctrl+R is not the chord'); await sim(t, 0x52, false);
    await sim(t, 0xA4, true);
    assert.equal(await sim(t, 0x52, true), 'swallow', 'Ctrl+Alt+R: the app never sees the R');
    assert.equal(await sim(t, 0x52, true), 'swallow', 'auto-repeat of R is swallowed');
    assert.equal(await sim(t, 0x52, false), 'swallow', 'and so is its release');
    await sleep(120);
    assert.equal(t.reads, 1, 'exactly one read event for one press');
    assert.equal(await sim(t, 0x52, true), 'swallow'); await sim(t, 0x52, false); await sleep(120);
    assert.equal(t.reads, 2, 'a second press reads again');
    await sim(t, 0xA4, false); await sim(t, 0xA2, false);
    assert.deepEqual(t.keys, [], 'the dictation chord never fired');
    // dictation still works next to it
    await sim(t, 0xA2, true); assert.equal(await sim(t, 0x20, true), 'swallow'); await sleep(120);
    assert.deepEqual(t.keys, ['down']); await sim(t, 0x20, false); await sim(t, 0xA2, false); await sleep(120);
    // switched off: R passes again
    t.setHotkey3([]); await sleep(100);
    await sim(t, 0xA2, true); await sim(t, 0xA4, true);
    assert.equal(await sim(t, 0x52, true), 'pass'); await sim(t, 0x52, false); await sim(t, 0xA4, false); await sim(t, 0xA2, false);
    await sleep(100);
    assert.equal(t.reads, 2);
  } finally { t.close(); }
});

test('a read chord without a modifier or with two plain keys is refused by the helper (nothing is registered)', async () => {
  const t = await start();
  try {
    t.setHotkey3([0x52]); await sleep(100);
    assert.equal(await sim(t, 0x52, true), 'pass'); await sim(t, 0x52, false);
    t.setHotkey3([0x11, 0x52, 0x54]); await sleep(100);
    await sim(t, 0xA2, true); assert.equal(await sim(t, 0x52, true), 'pass'); await sim(t, 0x52, false); await sim(t, 0xA2, false);
    assert.equal(t.reads, 0);
  } finally { t.close(); }
});
