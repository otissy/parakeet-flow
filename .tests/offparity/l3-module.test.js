'use strict';
/* With every new feature off, live typing is the old behaviour: the same random ASR scripts go through the code of the
   last commit before the new features (185c72c) and through today's code; every keystroke and the result must match. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { loadOld, BASE } = require('./old-code.js');
const { DictationSession } = require(path.join(root, 'src/core/session.js'));
const { MemoryTyper } = require(path.join(root, 'src/typer/typer.js'));
const { FakeHost } = require(path.join(root, '.tests/asr/fakes.js'));
const { Controller } = require(path.join(root, 'src/main/controller.js'));
const { Store } = require(path.join(root, 'src/main/settings.js'));
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');

const OLD = loadOld();
const skip = OLD ? false : `git history for ${BASE} not available (UNVERIFIED)`;

function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const WORDS = 'um the meeting uh is at ten tomorrow Delete that New line note to self ik denk dat we morgen gaan Undo scratch please send the report 😀 café Anna'.split(' ');

/** one scripted session: growing / mutating partials, finals, an optional focus change, release, done */
function script(seed) {
  const r = prng(seed); const ev = []; let seg = 1;
  const nSeg = 1 + Math.floor(r() * 4);
  for (let i = 0; i < nSeg; i++) {
    const n = 2 + Math.floor(r() * 8); const w = Array.from({ length: n }, () => WORDS[Math.floor(r() * WORDS.length)]);
    for (let k = 1; k <= n; k++) {
      const part = w.slice(0, k).join(' ');
      ev.push({ e: 'partial', segId: seg, text: r() < 0.15 ? part.toUpperCase() : part });       // sometimes a mangled partial
      if (r() < 0.08) ev.push({ e: 'focus', hwnd: 9 });
    }
    ev.push({ e: 'final', segId: seg, text: w.join(' ') + (r() < 0.5 ? '.' : ''), audioSec: 1 });
    if (r() < 0.1) ev.push({ e: 'advance', ms: 3000 });
    seg++;
  }
  if (r() < 0.2) ev.push({ e: 'cancel' }); else { ev.push({ e: 'release' }); if (r() < 0.3) ev.push({ e: 'advance', ms: 2000 }); ev.push({ e: 'done' }); }
  return ev;
}

function play(Session, Typer, ev, settings) {
  const host = new FakeHost(); const typer = new Typer({ pid: 77 });
  let t = 1000;
  const s = new Session({ asr: host, typer, settings, now: () => t, ownPid: 1 });
  let result = null; s.on('result', (x) => { result = x; });
  const pills = []; s.on('partial', (e) => pills.push('p:' + e.text)); s.on('final', (e) => pills.push('f:' + e.text));
  s.start();
  for (const e of ev) {
    if (e.e === 'partial') host.emitEv('partial', { segId: e.segId, text: e.text });
    else if (e.e === 'final') host.emitEv('final', { segId: e.segId, text: e.text, audioSec: e.audioSec });
    else if (e.e === 'focus') typer.setForeground({ hwnd: e.hwnd });
    else if (e.e === 'advance') t += e.ms;
    else if (e.e === 'release') s.release();
    else if (e.e === 'cancel') s.cancel();
    else if (e.e === 'done') host.emitEv('done', {});
  }
  const strip = (r) => r && { text: r.text, halted: r.halted, stats: r.stats, cancelled: r.cancelled, speechSec: r.speechSec, words: r.words };
  return { log: typer.log.map((o) => ({ op: o.op, text: o.text, n: o.n })), text: typer.text, result: strip(result), pills };
}

const SETTINGS = [
  {}, { liveMode: 'stable' }, { trailingSpace: true }, { style: { casual: true } }, { cap: 5 },
  { fillers: ['um', 'uh'], dictionary: [{ from: 'ten', to: '10' }], snippets: [{ trigger: 'note to self', expansion: 'NTS' }] },
];

test('2400 random scripts x 6 settings: identical keystrokes, results and live display, old code vs new code with features off', { skip }, () => {
  let n = 0;
  for (const settings of SETTINGS) {
    for (let seed = 1; seed <= 400; seed++) {
      const ev = script(seed * 7 + n);
      const a = play(OLD.DictationSession, OLD.MemoryTyper, ev, settings);
      // the new code, every new feature off: exactly what Controller.sessionSettings produces when they are disabled
      const b = play(DictationSession, MemoryTyper, ev, { ...settings, commands: null, tone: { enabled: false, apps: [] }, translate: { enabled: false }, cleanup: { enabled: false } });
      assert.deepEqual(b, a, `seed ${seed} settings ${JSON.stringify(settings)}`);
      n++;
    }
  }
  assert.equal(n, 2400);
});

test('the Controller really builds "all off" settings: commands null, tone off, no model', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-off-'));
  const store = new Store(dir);
  store.set({ commands: { enabled: false, list: [] }, tone: { enabled: false, apps: [] }, notes: { enabled: false, triggers: [], notion: {} }, translate: { enabled: false }, cleanup: { enabled: false }, whisper: { enabled: false } });
  const c = new Controller({ getAsr: () => null, typer: new EventEmitter(), store, mic: {} });
  const s = c.sessionSettings(store.get());
  assert.equal(s.commands, null); assert.equal(s.tone.enabled, false); assert.equal(s.translate.enabled, false); assert.equal(s.cleanup.enabled, false);
  assert.deepEqual(c.flags(), { whisper: false, translate: '', cleanup: false });
  // and the session built from them takes the old synchronous path
  const sess = new DictationSession({ asr: new FakeHost(), typer: new MemoryTyper(), settings: s });
  assert.equal(sess.asyncMode, false); assert.equal(sess.live.prepare, null); assert.equal(sess.live.commands, null);
});

test('with features ON the same scripts do differ (the comparison is not vacuous)', { skip }, () => {
  const ev = [{ e: 'partial', segId: 1, text: 'Delete' }, { e: 'partial', segId: 1, text: 'Delete that' }, { e: 'final', segId: 1, text: 'Delete that.' }, { e: 'release' }, { e: 'done' }];
  const old = play(OLD.DictationSession, OLD.MemoryTyper, ev, {});
  const on = play(DictationSession, MemoryTyper, ev, { commands: { enabled: true, list: require(path.join(root, 'src/core/commands.js')).DEFAULT_COMMANDS, notes: { enabled: false } }, tone: { enabled: false } });
  assert.equal(old.text, 'Delete that.'); assert.equal(on.text, '');
});
