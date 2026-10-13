'use strict';
/* ACCEPTANCE (the existing asr harness: real worker with VAD + Parakeet, real-time audio): ONE real recognition stream is
   teed into two sessions side by side, the code of the last commit before the new features (185c72c) and today's code
   with every new feature off. Each types into its own MemoryTyper; every keystroke must match, partial for partial. */
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const U = require('../asr/util');
const { loadOld, BASE } = require('./old-code.js');
const { AsrHost } = require(path.join(root, 'src/asr/asr-host.js'));
const { DictationSession } = require(path.join(root, 'src/core/session.js'));
const { MemoryTyper } = require(path.join(root, 'src/typer/typer.js'));

const OLD = loadOld();
const skip = U.modelsPresent() && U.ensureFixtures() && OLD ? false : `models, fixtures or git history for ${BASE} missing (UNVERIFIED)`;
const proof = process.env.PF_PROOF_DIR || path.join(root, '..', 'pf-proof');

/** both sessions think they own the ASR host; the real host is driven by the test */
class Tee extends EventEmitter {
  start() { return 1; } pushAudio() {} release() {} cancel() {}
}

for (const [name, liveMode] of [['en-pause', 'aggressive'], ['en1', 'aggressive'], ['nl1', 'stable'], ['short', 'aggressive']]) {
  test(`real speech ${name} (${liveMode}): live partial typing identical, old code vs new code with all features off`, { skip, timeout: 120000 }, async () => {
    const host = new AsrHost({ modelDir: U.MODEL_DIR, vadPath: U.VAD, numThreads: 2, provider: 'cpu' });
    await host.ready();
    const tee = new Tee();
    const mk = (Session, Typer, extra) => {
      const typer = new Typer({ pid: 4242 }); const s = new Session({ asr: tee, typer, ownPid: 1, settings: { liveMode, cap: 40, flushMs: 1500, ...extra } });
      let res = null; s.on('result', (r) => { res = r; }); return { typer, s, res: () => res };
    };
    const a = mk(OLD.DictationSession, OLD.MemoryTyper, {});
    const b = mk(DictationSession, MemoryTyper, { commands: null, tone: { enabled: false, apps: [] }, translate: { enabled: false }, cleanup: { enabled: false } });
    a.s.start(); b.s.start();
    const forward = (ev) => (e) => tee.emit(ev, { ...e, sid: 1 });
    const evs = ['partial', 'final', 'done']; const subs = evs.map((ev) => [ev, forward(ev)]);
    for (const [ev, f] of subs) host.on(ev, f);
    host.start();
    const audio = U.readWav(path.join(U.FIX, name + '.wav'));
    await U.feedRealtime(audio, (c) => host.pushAudio(c));
    a.s.release(); b.s.release(); host.release();
    for (let i = 0; i < 100 && !(a.res() && b.res()); i++) await U.sleep(50);
    for (const [ev, f] of subs) host.off(ev, f);
    assert.ok(a.res() && b.res(), 'both sessions finished');
    const ops = (t) => t.log.map((o) => ({ op: o.op, text: o.text, n: o.n }));
    assert.ok(ops(a.typer).length >= 6, 'many live keystroke ops were exercised: ' + ops(a.typer).length);
    assert.deepEqual(ops(b.typer), ops(a.typer));
    assert.equal(b.typer.text, a.typer.text);
    assert.deepEqual(b.res().stats, a.res().stats);
    fs.mkdirSync(proof, { recursive: true });
    const f = path.join(proof, 'offparity-report.json'); let all = {}; try { all = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { /* first */ }
    all[name] = { liveMode, keystrokeOps: ops(a.typer).length, corrections: a.res().stats.corrections, maxBackspace: a.res().stats.maxBackspace, identical: true, finalText: a.typer.text };
    fs.writeFileSync(f, JSON.stringify(all, null, 1));
    await host.close();
  });
}
