'use strict';
/* ACCEPTANCE: real-time-paced synthesised utterances through worker(VAD+ASR) -> DictationSession -> LiveTyper -> MemoryTyper.
   Prints onset-to-first-char, release-to-final, RTF, CPU. Metrics also go to $PF_METRICS (json) when set. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const U = require('./util');
const { AsrHost } = require(path.join(root, 'src/asr/asr-host.js'));
const { DictationSession } = require(path.join(root, 'src/core/session.js'));
const { MemoryTyper, replay, cp } = require(path.join(root, 'src/typer/typer.js'));

const ok = U.modelsPresent() && U.ensureFixtures();
const skip = ok ? false : 'models or fixtures missing (UNVERIFIED)';
const metrics = [];
let host;

test('worker starts and loads the model', { skip }, async () => {
  host = new AsrHost({ modelDir: U.MODEL_DIR, vadPath: U.VAD, numThreads: Number(process.env.PF_THREADS || 4), provider: process.env.PF_PROVIDER || 'cpu' });
  const t = Date.now();
  await host.ready();
  metrics.push({ loadMs: Date.now() - t });
});

async function runUtterance(name, liveMode = 'aggressive') {
  const a = U.readWav(path.join(U.FIX, name + '.wav'));
  const typer = new MemoryTyper({ pid: 4242 });
  const violations = [];
  const bs0 = typer.backspace.bind(typer);
  const ev = [];
  const s = new DictationSession({ asr: host, typer, settings: { liveMode, cap: 40, flushMs: 1500 }, ownPid: 1 });
  typer.backspace = (n, o) => {                       // immutability probe: a backspace may only reach into the live segment
    const live = s.live.cur ? cp(s.live.cur.typed).length : 0;
    if (n > live) violations.push({ n, live });
    return bs0(n, o);
  };
  let result; const done = new Promise((r) => s.on('result', (x) => { result = x; r(); }));
  s.on('partial', () => ev.push({ e: 'partial', at: Date.now() }));
  s.on('final', () => ev.push({ e: 'final', at: Date.now() }));
  const cpu0 = process.cpuUsage(); const w0 = Date.now();
  const decodeMs = [];
  const onP = (m) => decodeMs.push(m.decodeMs || 0);
  host.on('partial', onP); host.on('final', onP);
  s.start();
  const t0 = await U.feedRealtime(a, (c) => s.pushAudio(c));
  const tRelease = Date.now();
  s.release();
  await Promise.race([done, U.sleep(8000)]);
  const tDone = Date.now();
  host.off('partial', onP); host.off('final', onP);
  const cpu = process.cpuUsage(cpu0); const wall = Date.now() - w0;
  assert.ok(result, 'session produced a result');
  const audioSec = a.length / 16000;
  const firstOp = typer.log.find((o) => o.op === 'type');
  const m = {
    name, liveMode, audioSec: +audioSec.toFixed(1),
    onsetToFirstCharMs: firstOp ? Math.round(firstOp.at - (t0 + U.onsetSec(a) * 1000)) : null,
    releaseToDoneMs: tDone - tRelease,
    lastFinalAfterReleaseMs: (ev.filter((e) => e.e === 'final').at(-1)?.at ?? tRelease) - tRelease,
    rtf: +(decodeMs.reduce((x, y) => x + y, 0) / 1000 / audioSec).toFixed(3),
    cpuPctOfMachine: +(((cpu.user + cpu.system) / 1000) / wall / os.cpus().length * 100).toFixed(1),
    partials: ev.filter((e) => e.e === 'partial').length, finals: ev.filter((e) => e.e === 'final').length,
    corrections: result.stats.corrections, maxLiveBackspace: result.stats.maxBackspace, maxFinalBackspace: result.stats.maxFinalBackspace, deferred: result.stats.deferred,
    ops: typer.log.length,
  };
  metrics.push(m);
  return { typer, result, ev, m, violations, tRelease, firstOp };
}

for (const name of ['en1', 'nl1', 'en-pause']) {
  test(`acceptance (${name}): partials before final, replay == final text, cap, flush, immutability`, { skip }, async () => {
    const r = await runUtterance(name);
    const firstFinal = r.ev.find((e) => e.e === 'final');
    const firstPartial = r.ev.find((e) => e.e === 'partial');
    assert.ok(firstPartial && firstFinal && firstPartial.at < firstFinal.at, 'a partial arrives before the first final');
    assert.ok(r.firstOp && r.firstOp.at < firstFinal.at, 'first character typed before the first final');
    assert.equal(replay(r.typer.log), r.result.text, 'keystroke log replays to exactly the final text');
    assert.ok(r.result.text.length > 20);
    assert.ok(r.result.stats.maxBackspace <= 40, 'no live correction over the cap');
    assert.equal(r.violations.length, 0, 'finalised segments are never backspaced');
    assert.ok(r.typer.log.every((o) => o.at <= r.tRelease + 1500), 'nothing typed after the flush window');
    assert.equal(r.result.stats.typedAfterFlush, 0);
    if (name === 'en-pause') assert.ok(r.m.finals >= 2, 'pause produced a second segment');
  });
}

test('stable mode also replays to the final text', { skip }, async () => {
  const r = await runUtterance('en1', 'stable');
  assert.equal(replay(r.typer.log), r.result.text);
  assert.ok(r.m.corrections <= 3, 'stable mode rarely needs corrections: ' + r.m.corrections);
});

test('report', { skip }, async () => {
  await host.close();
  const line = JSON.stringify(metrics, null, 1);
  console.log('# METRICS ' + line.replace(/\n/g, '\n# '));
  if (process.env.PF_METRICS) fs.writeFileSync(process.env.PF_METRICS, line);
});
