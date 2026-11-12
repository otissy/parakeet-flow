'use strict';
/* The read-aloud flow with fakes: selection -> pieces -> voice -> player. Hotkey toggling, Esc/stop, gating while dictating or in a meeting,
   failure messages, streaming order, the lookahead limit, and that a stop in the middle of anything leaves nothing running. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { ReadAloud, LOOKAHEAD_SEC, FAIL_NOTE } = require(path.join(__dirname, '..', '..', 'src/readaloud/service.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function rig(o = {}) {
  const r = { states: [], played: [], ended: [], stops: 0, cancels: 0, spoken: [], busy: '', ready: true, settings: { readAloud: { enabled: true, voice: 'bm_george', speed: 1.1, hotkey: { vks: [17, 18, 82], label: 'Ctrl+Alt+R' } } }, selection: { ok: true, text: 'First sentence. Second sentence. Third one here.' }, copies: 0, logs: [] };
  r.tts = {
    speak: async (text, { sid, speed, onSamples }) => {
      r.spoken.push({ text, sid, speed });
      if (o.speakError) throw new Error('engine broke');
      if (o.gate) await o.gate(text);
      onSamples(new Float32Array(24000 * (o.secPerPiece || 1)), 24000);
      return { ms: 5, samples: 24000, cancelled: false };
    },
    cancel: () => { r.cancels++; },
  };
  r.player = { chunk: (gen, f32, rate) => r.played.push({ gen, sec: f32.length / rate }), end: (gen) => { r.ended.push(gen); if (o.autoFinish !== false) setTimeout(() => svc.playerFinished(gen), 5); }, stop: () => { r.stops++; } };
  const svc = new ReadAloud({ getSettings: () => r.settings, copySelection: async () => { r.copies++; if (o.copyDelay) await sleep(o.copyDelay); return r.selection; }, tts: r.tts, player: r.player, busy: () => r.busy, voiceReady: () => r.ready, log: (l, m) => r.logs.push(l + ' ' + m), poll: (ms) => sleep(Math.min(ms, 5)) });
  svc.on('state', (s) => r.states.push(s.state + (s.note ? ':' + s.note : '')));
  r.svc = svc;
  return r;
}

test('the hotkey reads the selection: pieces are voiced in order with the chosen voice and speed, audio goes to the player, then idle', async () => {
  const r = rig();
  const res = await r.svc.trigger();
  assert.deepEqual(res, { ok: true });
  assert.equal(r.copies, 1);
  assert.deepEqual(r.spoken.map((s) => s.sid), r.spoken.map(() => 26), 'bm_george is speaker 26');
  assert.ok(r.spoken.every((s) => s.speed === 1.1));
  assert.equal(r.spoken.map((s) => s.text).join(' '), 'First sentence. Second sentence. Third one here.');
  assert.ok(r.played.length >= 1 && r.played.every((p) => p.gen === r.played[0].gen));
  assert.deepEqual(r.ended, [r.played[0].gen]);
  assert.deepEqual(r.states.filter((x, i, a) => a.indexOf(x) === i), ['preparing', 'reading', 'idle']);
  assert.equal(r.svc.state, 'idle');
  assert.match(r.logs.join('\n'), /read aloud: \d+ chars, \d+ pieces, voice bm_george, speed 1.1/);
  assert.ok(!r.logs.join('\n').includes('First sentence'), 'the text itself is never logged');
});

test('long text is chunked and streamed: the first audio is played before the last piece is synthesized', async () => {
  const text = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here for the test of streaming.`).join(' ');
  let firstAudioAt = -1; let spokenAtFirstAudio = 0;
  const r = rig({ secPerPiece: 0.5 });
  r.selection = { ok: true, text };
  const origChunk = r.player.chunk;
  r.player.chunk = (g, f, rate) => { if (firstAudioAt < 0) { firstAudioAt = Date.now(); spokenAtFirstAudio = r.spoken.length; } origChunk(g, f, rate); };
  await r.svc.trigger();
  assert.ok(r.spoken.length > 4, 'many pieces: ' + r.spoken.length);
  assert.equal(spokenAtFirstAudio, 1, 'playback started after the FIRST piece, not after all of them');
  assert.equal(r.played.length, r.spoken.length);
});

test('the same hotkey while reading stops it; Esc (stop) too; the voice is cancelled, the player cleared, nothing more is sent', async () => {
  let release;
  const r = rig({ gate: () => new Promise((res) => { release = res; }) });
  const p = r.svc.trigger();
  await sleep(30);
  assert.equal(r.svc.state, 'preparing');
  assert.deepEqual(await r.svc.trigger(), { ok: true, stopped: true }, 'second press = stop');
  assert.equal(r.svc.state, 'idle');
  assert.equal(r.cancels, 1); assert.equal(r.stops, 1);
  release();
  const res = await p;
  assert.deepEqual(res, { ok: false, reason: 'stopped' });
  assert.equal(r.played.length, 0, 'audio that finished after the stop is dropped');
  assert.equal(r.ended.length, 0);
  assert.equal(r.svc.stop(), false, 'stop when idle does nothing');
});

test('stop while the selection is still being copied: nothing is read afterwards', async () => {
  const r = rig({ copyDelay: 60 });
  const p = r.svc.trigger();
  await sleep(10);
  assert.equal(r.svc.stop(), true);
  assert.deepEqual(await p, { ok: false, reason: 'stopped' });
  assert.equal(r.spoken.length, 0);
});

test('a new reading right after a stop is not disturbed by the old one finishing late', async () => {
  const gates = [];
  const r = rig({ gate: () => new Promise((res) => gates.push(res)) });
  const first = r.svc.trigger(); await sleep(20);
  r.svc.stop();
  r.selection = { ok: true, text: 'Second reading.' };
  const second = r.svc.trigger(); await sleep(20);
  gates.forEach((g) => g());
  assert.deepEqual(await first, { ok: false, reason: 'stopped' });
  assert.deepEqual(await second, { ok: true });
  assert.equal(r.played.length, 1, 'only the second reading was played');
});

test('off: the hotkey does nothing; no voice downloaded: says so; nothing selected and each capture failure say what happened', async () => {
  const r = rig();
  r.settings.readAloud.enabled = false;
  assert.deepEqual(await r.svc.trigger(), { ok: false, reason: 'off' });
  assert.equal(r.copies, 0, 'a disabled feature never presses Ctrl+C');
  r.settings.readAloud.enabled = true; r.ready = false;
  assert.deepEqual(await r.svc.trigger(), { ok: false, reason: 'no-voice' });
  assert.match(r.states.at(-1), /Voice not downloaded/); assert.equal(r.copies, 0);
  r.ready = true;
  for (const reason of ['none', 'clipboard-not-restorable', 'keys-held', 'timeout', 'helper-gone', 'clipboard-busy']) {
    r.states.length = 0; r.selection = { ok: false, reason };
    assert.deepEqual(await r.svc.trigger(), { ok: false, reason });
    assert.equal(r.states.at(-1), 'error:' + FAIL_NOTE[reason]);
    assert.equal(r.svc.state, 'idle');
  }
  assert.equal(r.spoken.length, 0);
});

test('never while dictating or in a meeting: the busy reason is shown, no selection is copied, no audio starts', async () => {
  const r = rig();
  r.busy = 'Finish dictating first';
  assert.deepEqual(await r.svc.trigger(), { ok: false, reason: 'busy' });
  assert.equal(r.states.at(-1), 'error:Finish dictating first');
  assert.equal(r.copies, 0); assert.equal(r.spoken.length, 0);
  r.busy = 'A meeting is being recorded or processed';
  assert.deepEqual(await r.svc.sample(), { ok: false, reason: 'busy' });
  r.busy = '';
  assert.deepEqual(await r.svc.trigger(), { ok: true });
});

test('empty or punctuation-only selection says "Nothing to read"; an engine failure is reported, the player is stopped and the state returns to idle', async () => {
  const r = rig();
  r.selection = { ok: true, text: '  ...  ' };
  assert.deepEqual(await r.svc.trigger(), { ok: false, reason: 'empty' });
  assert.equal(r.states.at(-1), 'error:Nothing to read');
  const f = rig({ speakError: true });
  assert.deepEqual(await f.svc.trigger(), { ok: false, reason: 'failed' });
  assert.match(f.states.at(-1), /^error:Could not read aloud: engine broke/);
  assert.equal(f.stops, 1); assert.equal(f.svc.state, 'idle');
});

test('the voice never runs more than the lookahead ahead of what has played', async () => {
  const text = Array.from({ length: 12 }, (_, i) => `Piece ${i} of the long reading goes here and is long enough to be its own piece of speech for this test run okay.`).join(' ');
  const r = rig({ secPerPiece: 6, autoFinish: false });
  r.selection = { ok: true, text };
  const done = r.svc.trigger();
  await sleep(80);
  const sent1 = r.played.reduce((s, p) => s + p.sec, 0);
  assert.ok(sent1 <= LOOKAHEAD_SEC + 6, `waits for playback instead of racing ahead: ${sent1} s queued, no progress reported`);
  const before = r.spoken.length;
  const gen = r.played[0].gen;
  r.svc.progress(gen, sent1);                     // the player says everything so far has played
  await sleep(80);
  assert.ok(r.spoken.length > before, 'more is synthesized once playback has caught up');
  for (let i = 0; i < 40 && r.svc.state !== 'idle'; i++) { r.svc.progress(gen, r.played.reduce((s, p) => s + p.sec, 0)); await sleep(15); if (r.ended.length) r.svc.playerFinished(gen); }
  await done;
  assert.equal(r.svc.state, 'idle');
});

test('the sample line works with the switch off and uses the chosen voice', async () => {
  const r = rig();
  r.settings.readAloud.enabled = false; r.settings.readAloud.voice = 'af_bella';
  assert.deepEqual(await r.svc.sample(), { ok: true });
  assert.equal(r.spoken[0].sid, 2); assert.equal(r.copies, 0, 'a sample never touches the clipboard');
});

test('a very long selection says it only reads the first part', async () => {
  const r = rig();
  r.selection = { ok: true, text: 'word '.repeat(40000) };
  r.tts.speak = async (t, { onSamples }) => { onSamples(new Float32Array(2400), 24000); return { ms: 1, samples: 2400 }; };
  const p = r.svc.trigger();
  await sleep(20);
  assert.ok(r.states.some((s) => /first part/.test(s)));
  r.svc.stop(); await p;
});
