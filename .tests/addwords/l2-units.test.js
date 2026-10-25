'use strict';
/* L2: each function alone. Bias conversion (both directions, clamping, rounding, legacy scores, bad input), the strict
   input parser, the quick-add text helpers, hotwords.build per-word lines, the log line, settleRestart, normTerm bias. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const B = require(path.join(root, 'src/slang/bias.js'));
const L = require(path.join(root, 'src/renderer/lib.js'));
const H = require(path.join(root, 'src/slang/hotwords.js'));
const P = require(path.join(root, 'src/slang/pack.js'));

test('bias: the documented anchor points', () => {
  assert.equal(B.scoreToPercent(3), 100); assert.equal(B.scoreToPercent(1.5), 50); assert.equal(B.scoreToPercent(1), 33); assert.equal(B.scoreToPercent(2), 67);
  assert.equal(B.percentToScore(100), 3); assert.equal(B.percentToScore(50), 1.5); assert.equal(B.percentToScore(1), 0.03); assert.equal(B.percentToScore(51), 1.53);
  assert.equal(B.DEFAULT_PCT, 50); assert.equal(B.DEFAULT_SCORE, 1.5);
});

test('bias: every whole percent survives percent -> score -> percent exactly', () => {
  for (let p = 1; p <= 100; p++) {
    const s = B.percentToScore(p);
    assert.equal(B.scoreToPercent(s), p, `p=${p} s=${s}`);
    assert.ok(s >= 0.03 && s <= 3);
    assert.equal(String(s).length <= 4, true, `no float noise in ${s}`);
  }
});

test('bias: rounding and clamping both ways', () => {
  assert.equal(B.scoreToPercent(1.515), 51, 'rounds to the nearest percent (50.5 -> 51)');
  assert.equal(B.scoreToPercent(1.4999), 50);
  assert.equal(B.scoreToPercent(99), 100); assert.equal(B.scoreToPercent(-4), 1); assert.equal(B.scoreToPercent(0), 1);
  assert.equal(B.percentToScore(250), 3); assert.equal(B.percentToScore(0), 0.03); assert.equal(B.percentToScore(-10), 0.03);
  assert.equal(B.percentToScore(49.6), 1.5, 'a fractional percent is rounded first');
  assert.equal(B.normPercent('70%'), 70); assert.equal(B.normPercent(' 70 % '), 70); assert.equal(B.normPercent('100.4'), 100); assert.equal(B.normPercent(0), 1);
});

test('bias: legacy stored scores (0.1..3) still load and show as their percentage', () => {
  assert.equal(B.normScore(0.1), 0.1); assert.equal(B.scoreToPercent(0.1), 3);
  assert.equal(B.normScore(2.4), 2.4); assert.equal(B.scoreToPercent(2.4), 80);
  assert.equal(B.normScore(1.5), 1.5);
  assert.equal(B.normScore(9), 3); assert.equal(B.normScore(0), 0.03); assert.equal(B.normScore('2'), 2);
});

test('bias: bad input never throws and falls back to the default (or null for "use the global")', () => {
  for (const bad of [NaN, Infinity, -Infinity, null, undefined, 'abc', '', '1e999', {}, [], true, '5x', '--5']) {
    assert.equal(B.scoreToPercent(bad), 50, String(bad));
    assert.equal(B.percentToScore(bad), 1.5, String(bad));
    assert.equal(B.normScore(bad), 1.5, String(bad));
    assert.equal(B.normPercent(bad), null, String(bad));
  }
});

test('bias: strict input parser for typed values', () => {
  assert.deepEqual(B.parsePercentInput(''), { pct: null }); assert.deepEqual(B.parsePercentInput('   '), { pct: null });
  assert.deepEqual(B.parsePercentInput('70'), { pct: 70 }); assert.deepEqual(B.parsePercentInput('70%'), { pct: 70 }); assert.deepEqual(B.parsePercentInput(33.4), { pct: 33 });
  assert.match(B.parsePercentInput('0').error, /1% to 100%/); assert.match(B.parsePercentInput('101').error, /1% to 100%/); assert.match(B.parsePercentInput('-5').error, /1% to 100%/);
  assert.match(B.parsePercentInput('lots').error, /number/); assert.match(B.parsePercentInput('🔥').error, /number/);
});

test('cleanPick: trims punctuation and whitespace, keeps inner punctuation, caps the length', () => {
  assert.equal(L.cleanPick('  riz, '), 'riz'); assert.equal(L.cleanPick('(no cap).'), 'no cap'); assert.equal(L.cleanPick("don't"), "don't");
  assert.equal(L.cleanPick('no\n\tcap'), 'no cap'); assert.equal(L.cleanPick('...!!'), ''); assert.equal(L.cleanPick(null), '');
  assert.equal(L.cleanPick('x'.repeat(500)).length, 200); assert.equal(L.cleanPick('‮evil‬'), 'evil');
});

test('wordsOf: distinct words in order, inner apostrophe and hyphen kept, capped', () => {
  assert.deepEqual(L.wordsOf("No cap, no CAP it's riz-ler... 2v2!"), ['No', 'cap', "it's", 'riz-ler', '2v2']);
  assert.deepEqual(L.wordsOf(''), []);
  assert.equal(L.wordsOf(Array.from({ length: 100 }, (_, i) => 'w' + i).join(' ')).length, 40);
});

function tokens() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-aw-tok-')); fs.writeFileSync(path.join(d, 'tokens.txt'), '<blk> 0\n<unk> 1\n▁a 2\n▁b 3\n'); return d; }

test('hotwords.build: global words plain, per-word bias as "word :score", markers skipped, dedupe keeps the first', () => {
  const d = tokens();
  const o = H.build({ tokensFile: path.join(d, 'tokens.txt'), dir: path.join(d, 'h'), score: 2.1,
    terms: ['Rizz', { term: 'no cap', bias: 80 }, { term: 'rizz', bias: 10 }, { term: 'GOAT', bias: null }, ':evil', 'a #b', 'x', { term: 'sus', bias: 'junk' }] });
  const lines = fs.readFileSync(o.hotwordsFile, 'utf8').trim().split('\n');
  assert.deepEqual(lines, ['rizz', 'no cap :2.4', 'goat', 'sus']);
  assert.equal(o.hotwordsScore, 2.1); assert.equal(o.percent, 70); assert.equal(o.count, 4); assert.equal(o.perWord, 1);
  assert.equal(H.build({ tokensFile: path.join(d, 'tokens.txt'), dir: path.join(d, 'h2'), terms: ['rizz'], score: 'x' }).hotwordsScore, 1.5);
  assert.equal(H.build({ tokensFile: path.join(d, 'tokens.txt'), dir: path.join(d, 'h3'), terms: [] }), null);
  fs.rmSync(d, { recursive: true, force: true });
});

test('hotwords.logLine prints the percentage and counts, never a term', () => {
  const line = H.logLine({ count: 12, percent: 70, perWord: 2, hotwordsScore: 2.1 });
  assert.equal(line, 'hotwords on terms=12 bias=70% own-bias=2');
  assert.ok(!/score=/.test(line));
  assert.equal(H.logLine({ count: 3, percent: 50, perWord: 0 }), 'hotwords on terms=3 bias=50%');
});

test('termsOf carries a term\'s own bias', () => {
  assert.deepEqual(H.termsOf([{ terms: [{ term: 'rizz' }, { term: 'gg', bias: 90 }] }]), ['rizz', { term: 'gg', bias: 90 }]);
});

test('settleRestart: many edits = one restart after they settle; nothing while biasing is off', () => {
  let now = 0, queue = [];
  const timers = { setTimeout: (fn, ms) => { const t = { fn, at: now + ms }; queue.push(t); return t; }, clearTimeout: (t) => { queue = queue.filter((x) => x !== t); } };
  const tick = (ms) => { now += ms; for (const t of queue.filter((x) => x.at <= now)) { queue = queue.filter((x) => x !== t); t.fn(); } };
  let on = true, restarts = 0;
  const ch = H.settleRestart({ shouldRestart: () => on, restart: () => restarts++, ms: 2500, timers });
  ch(); tick(1000); ch(); tick(1000); ch(); tick(2000);
  assert.equal(restarts, 0, 'still settling'); assert.equal(ch.pending(), true);
  tick(600); assert.equal(restarts, 1); assert.equal(ch.pending(), false);
  on = false; assert.equal(ch(), false); tick(5000); assert.equal(restarts, 1);
});

test('normTerm: bias is kept as a whole percent, clamped; junk is dropped with a warning; absent stays absent', () => {
  assert.equal(P.normTerm({ term: 'rizz', bias: 80 }).term.bias, 80);
  assert.equal(P.normTerm({ term: 'rizz', bias: '79.6' }).term.bias, 80);
  assert.equal(P.normTerm({ term: 'rizz', bias: 400 }).term.bias, 100);
  const j = P.normTerm({ term: 'rizz', bias: 'loud' });
  assert.equal('bias' in j.term, false); assert.match(j.warnings.join(' '), /bias is not a number/);
  assert.equal('bias' in P.normTerm({ term: 'rizz' }).term, false);
  assert.equal('bias' in P.normTerm({ term: 'rizz', bias: { x: 1 } }).term, false);
});
