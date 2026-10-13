'use strict';
/* Whole typing path with Ctrl+Space held: DictationSession (scripted ASR, partials that get corrected) -> LiveTyper ->
   real Win32Typer + real helper process, physical keys simulated, output captured and replayed with Windows semantics.
   The same script into the in-memory sink is the reference: both must end with identical text, and Ctrl must end held.
   The real-window run (own textarea, real SendInput) is `electron .tests/ctrlspace/real-ctrl-space.js`: manual, visible ~6 s. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { startHelper, sim, replayOs, sleep, root } = require('./util');
const { DictationSession } = require(path.join(root, 'src/core/session.js'));
const { MemoryTyper } = require(path.join(root, 'src/typer/typer.js'));
const { FakeHost } = require(path.join(root, '.tests/asr/fakes.js'));

function script(host, s) {
  s.start();
  host.emitEv('partial', { segId: 1, text: 'turn the whole thing' });
  host.emitEv('partial', { segId: 1, text: 'turn the hole thing' });         // a correction in the middle: backspaces 6
  host.emitEv('partial', { segId: 1, text: 'turn the hole thing off' });
  host.emitEv('final', { segId: 1, text: 'Turn the hole thing off.', reason: 'pause' });   // final rewrites too
  s.release(); host.emitEv('done', {});
}

test('hold Ctrl+Space, speak with corrections: Ctrl is released around every burst, text equals the reference, Ctrl ends held', async () => {
  const ref = new MemoryTyper({ pid: 77 }); const rh = new FakeHost();
  script(rh, new DictationSession({ asr: rh, typer: ref, ownPid: 1, settings: { deny: [] } }));

  const t = await startHelper();
  try {
    for (let i = 0; i < 100 && !t.foreground(); i++) { t.queryForeground(); await sleep(30); }
    await sim(t, 0xA2, true); await sim(t, 0x20, true); await sleep(80);
    assert.deepEqual(t.keys, ['down'], 'the hotkey poller saw the chord');
    const host = new FakeHost();
    const s = new DictationSession({ asr: host, typer: t, ownPid: 1, settings: { deny: [] } });
    script(host, s);
    await sleep(500);
    const sentLines = t.lines.filter((l) => l[0] === 'SENT').map((l) => l.slice(1).join(' '));
    assert.ok(sentLines.length >= 4, 'typed, corrected, corrected, final: ' + sentLines.length + ' bursts');
    for (const l of sentLines) assert.match(l, /^A2:U .* A2:D$/, 'every burst is wrapped');
    const os = replayOs(sentLines, '', ['A2']);
    assert.equal(os.text, ref.text, 'same text as the in-memory sink');
    assert.equal(os.text, 'Turn the hole thing off.');
    assert.equal(os.ctrlDownAtEnd, true, 'the user is still holding Ctrl');
    assert.equal(os.shortcutsFired, 0);
    assert.equal(os.ctrlEvents.length, sentLines.length * 2, 'one matched up/down pair per burst');
    await sim(t, 0x20, false); await sim(t, 0xA2, false); await sleep(120);
    assert.deepEqual(t.keys, ['down', 'up']);
  } finally { t.close2(); }
});
