'use strict';
/* The helper's release / restore of Ctrl around a correction burst, driven through the real Win32Typer + real helper
   process, with the physical key state SIMULATED (SIM) and the output CAPTURED (SENT): no key is pressed on this machine.
   replayOs applies the captured keys the way Windows does, so a word-delete would show up in the text. */
const test = require('node:test');
const assert = require('node:assert');
const { startHelper, sim, dump, sent, replayOs, sleep } = require('./util');

async function ready() {
  const t = await startHelper();
  for (let i = 0; i < 100 && !t.foreground(); i++) { t.queryForeground(); await sleep(30); }
  assert.ok(t.foreground() && t.foreground().hwnd, 'some foreground window to name as the target');
  t.hwnd = t.foreground().hwnd;
  return t;
}
const holdChord = async (t, ctrl = 0xA2) => { await sim(t, ctrl, true); await sim(t, 0x20, true); await sleep(80); };
const BS3 = '08:D 08:U 08:D 08:U 08:D 08:U';

test('Ctrl+Space held: a 3-key correction is wrapped in a logical Ctrl up / down and deletes exactly 3 characters', async () => {
  const t = await ready();
  try {
    await holdChord(t);
    const out = await sent(t, () => t.backspace(3, { hwnd: t.hwnd }));
    assert.deepEqual(out, ['A2:U ' + BS3 + ' A2:D']);
    const os = replayOs(out, 'hello world foo', ['A2']);       // the app starts with Ctrl logically down (user holds it)
    assert.equal(os.text, 'hello world ', 'exactly 3 characters, not a word');
    assert.equal(os.ctrlDownAtEnd, true, 'Ctrl is restored: the user still holds it');
    assert.deepEqual(os.ctrlEvents, ['A2:U', 'A2:D'], 'one matched pair');
    const two = replayOs(await sent(t, () => t.backspace(2, { hwnd: t.hwnd })), 'hello world foo', ['A2']);
    assert.equal(two.text, 'hello world f', '2 characters out of "foo", the word stays');
  } finally { t.close2(); }
});

test('control experiment: with the release switched off the same correction deletes the whole word', async () => {
  const t = await ready();
  try {
    await holdChord(t); t.raw('NORELEASE 1');
    const out = await sent(t, () => t.backspace(2, { hwnd: t.hwnd }));
    assert.deepEqual(out, ['08:D 08:U 08:D 08:U']);
    assert.equal(replayOs(out, 'hello world foo', ['A2']).text, 'hello ', 'two Ctrl+Backspaces ate "foo" and "world" where 2 characters were meant: the bug the release prevents');
  } finally { t.close2(); }
});

test('typed text with Ctrl held is not turned into shortcuts, right Ctrl works the same, no Ctrl held = no wrapping', async () => {
  const t = await ready();
  try {
    await holdChord(t, 0xA3);
    const typed = await sent(t, () => t.type('ok', { hwnd: t.hwnd }));
    assert.deepEqual(typed, ['A3:U c6F:D c6F:U c6B:D c6B:U A3:D']);
    const os = replayOs(typed, '', ['A3']);
    assert.equal(os.text, 'ok'); assert.equal(os.shortcutsFired, 0); assert.equal(os.ctrlDownAtEnd, true);
    await sim(t, 0x20, false); await sim(t, 0xA3, false); await sleep(80);
    const plain = await sent(t, () => t.backspace(1, { hwnd: t.hwnd }));
    assert.deepEqual(plain, ['08:D 08:U'], 'nothing held: the keys go out untouched');
  } finally { t.close2(); }
});

test('user lets go of Ctrl DURING the burst: the physical up is swallowed (the app already saw one), no Ctrl down is sent', async () => {
  const t = await ready();
  try {
    await holdChord(t);
    t.raw('SIMMID 162');
    const out = await sent(t, () => t.backspace(2, { hwnd: t.hwnd }));
    assert.deepEqual(out, ['A2:U 08:D 08:U 08:D 08:U']);
    const os = replayOs(out, 'abc def', ['A2']);
    assert.equal(os.text, 'abc d'); assert.equal(os.ctrlDownAtEnd, false, 'no stuck Ctrl');
    const d = await dump(t); assert.equal(d.released, '0', 'bookkeeping clean'); assert.equal(d.chord, '0', 'chord ended with the physical release');
  } finally { t.close2(); }
});

test('user lets go AFTER the restore list is fixed: the matching Ctrl up is sent straight away', async () => {
  const t = await ready();
  try {
    await holdChord(t);
    t.raw('SIMLATE 162');
    const out = await sent(t, () => t.backspace(1, { hwnd: t.hwnd }), 2);
    assert.deepEqual(out, ['A2:U 08:D 08:U A2:D', 'A2:U']);
    const os = replayOs(out, 'abc', ['A2']);
    assert.equal(os.text, 'ab'); assert.equal(os.ctrlDownAtEnd, false, 'no stuck Ctrl');
    assert.equal((await dump(t)).released, '0');
  } finally { t.close2(); }
});

test('the physical Ctrl release after a normal burst is matched (nothing swallowed, nothing unmatched)', async () => {
  const t = await ready();
  try {
    await holdChord(t);
    await sent(t, () => t.backspace(1, { hwnd: t.hwnd }));
    assert.equal((await dump(t)).released, '0');
    assert.equal(await sim(t, 0x20, false), 'swallow'); assert.equal(await sim(t, 0xA2, false), 'pass', 'the real up reaches the app, closing the restored down');
  } finally { t.close2(); }
});

test('typing into a window that is not the target is refused and sends nothing', async () => {
  const t = await ready();
  try {
    await holdChord(t);
    const n = t.lines.filter((l) => l[0] === 'SENT').length;
    t.backspace(2, { hwnd: t.hwnd + 12345 }); await sleep(250);
    assert.equal(t.lines.filter((l) => l[0] === 'SENT').length, n);
  } finally { t.close2(); }
});
