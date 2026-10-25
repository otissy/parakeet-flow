'use strict';
/* L3: the slang service, settings store and slang IPC working together on a temp user-data folder (real files).
   Add word: new, merge (any case), validation, pack targeting, undo, per-word bias into the hotwords file.
   Bias percent: set, stored as score, legacy scores, IPC restart signal. Built-in packs are never written. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..', '..');
const { Store, normalize } = require(path.join(root, 'src/main/settings.js'));
const { SlangService } = require(path.join(root, 'src/slang/service.js'));
const slangIpc = require(path.join(root, 'src/slang/ipc.js'));
const H = require(path.join(root, 'src/slang/hotwords.js'));

const BUILTIN = path.join(root, 'src/slang/packs');
const hashDir = (d) => fs.readdirSync(d).sort().map((f) => f + ':' + crypto.createHash('sha256').update(fs.readFileSync(path.join(d, f))).digest('hex')).join('|');

function rig({ settings = {}, files = {} } = {}) {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-aw-l3-'));
  const packs = path.join(ud, 'dictionary', 'packs');
  fs.mkdirSync(packs, { recursive: true });
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(settings));
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(packs, f), typeof body === 'string' ? body : JSON.stringify(body));
  const store = new Store(ud);
  const svc = new SlangService({ builtinDir: BUILTIN, userDir: packs, getSettings: () => store.get(), setSettings: (p) => store.set(p) });
  const mine = () => JSON.parse(fs.readFileSync(path.join(packs, 'mine.json'), 'utf8')).terms;
  const done = () => fs.rmSync(ud, { recursive: true, force: true });
  return { ud, packs, store, svc, mine, done };
}

test('add a new word: written to My terms, reported with the pack name and an undo token', (t) => {
  const r = rig(); t.after(r.done);
  const a = r.svc.addTerm({ term: 'rizz', variants: ['riz'] });
  assert.equal(a.ok, true); assert.equal(a.merged, false); assert.equal(a.packName, 'My terms'); assert.equal(typeof a.undo, 'number');
  assert.deepEqual(r.mine(), [{ term: 'rizz', variants: ['riz'] }]);
  assert.equal(r.svc.apply('so the riz is real'), 'so the rizz is real', 'the matcher uses it at once');
  assert.deepEqual(a.alsoIn, ['Starter: English slang, gaming, Rocket League, streaming'], 'tells the user the word is also in a built-in pack');
});

test('same word in another case merges into ONE entry: new spelling wins, variants are unioned, old bias kept', (t) => {
  const r = rig({ files: { 'mine.json': { format: 1, id: 'mine', name: 'My terms', terms: [{ term: 'zorgle', variants: ['zorg'], bias: 70 }] } } }); t.after(r.done);
  const a = r.svc.addTerm({ term: 'Zorgle', variants: ['zorgel', 'ZORG'] });
  assert.equal(a.ok, true); assert.equal(a.merged, true);
  assert.deepEqual(r.mine(), [{ term: 'Zorgle', variants: ['zorg', 'zorgel'], bias: 70 }]);
  const b = r.svc.addTerm({ term: 'ZORGLE', bias: '90' });
  assert.equal(b.merged, true); assert.equal(r.mine().length, 1); assert.equal(r.mine()[0].bias, 90);
});

test('validation: empty, control characters only, only symbols, too long, too many words, emoji, bad bias', (t) => {
  const r = rig(); t.after(r.done);
  const err = (raw) => { const x = r.svc.addTerm(raw); assert.equal(x.ok, false, JSON.stringify(raw)); return x.error; };
  assert.match(err({ term: '' }), /Empty term/);
  assert.match(err({ term: '   ' }), /Empty term/);
  assert.match(err({ term: '\u0007\u0000\u001b' }), /Empty term/);
  assert.match(err({ term: '!!! ??? ...' }), /No letters or digits/);
  assert.match(err({ term: 'a'.repeat(81) }), /longer than 80/);
  assert.match(err({ term: 'one two three four five six seven eight nine' }), /More than 8 words/);
  assert.match(err({ term: 'rizz🔥' }), /Emoji/);
  assert.match(err({ term: '🔥' }), /Emoji/);
  assert.match(err({ term: '🇳🇱' }), /Emoji/);
  assert.match(err({ term: 'rizz', variants: ['riz😂'] }), /emoji/i);
  assert.match(err({ term: 'rizz', bias: '150' }), /1% to 100%/);
  assert.match(err({ term: 'rizz', bias: 'max' }), /number/);
  assert.match(err({ term: 'x' }), /one-letter/);
  assert.equal(fs.existsSync(path.join(r.packs, 'mine.json')), false, 'nothing was written by a refused add');
  const ok = r.svc.addTerm({ term: 'ri​zz‮' });
  assert.equal(ok.ok, true); assert.equal(r.mine()[0].term, 'rizz', 'zero-width and bidi characters are stripped');
});

test('pack choice: an editable pack of yours works; built-in, .csv and missing packs are refused; packs list says which are editable', (t) => {
  const r = rig({ files: { 'clan.json': { format: 1, id: 'clan', name: 'Clan words', terms: [{ term: 'skrrt' }] }, 'list.csv': 'term\nbonk\n' } }); t.after(r.done);
  const before = hashDir(BUILTIN);
  const st = r.svc.state();
  const ed = Object.fromEntries(st.packs.map((p) => [p.id, p.editable]));
  assert.deepEqual(ed, { clan: true, list: false, 'starter-en': false, 'starter-nl': false });
  const a = r.svc.addTerm({ term: 'yoink', bias: 60 }, { packId: 'clan' });
  assert.equal(a.ok, true); assert.equal(a.packName, 'Clan words');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r.packs, 'clan.json'), 'utf8')).terms, [{ term: 'skrrt' }, { term: 'yoink', bias: 60 }]);
  assert.match(r.svc.addTerm({ term: 'yoink2' }, { packId: 'starter-en' }).error, /Built-in packs cannot be changed/);
  assert.match(r.svc.addTerm({ term: 'yoink3' }, { packId: 'list' }).error, /\.csv or \.txt/);
  assert.match(r.svc.addTerm({ term: 'yoink4' }, { packId: 'nope' }).error, /no longer exists/);
  assert.equal(fs.readFileSync(path.join(r.packs, 'list.csv'), 'utf8'), 'term\nbonk\n');
  assert.equal(hashDir(BUILTIN), before, 'built-in pack files untouched');
  r.svc.reload();
  assert.equal(r.svc.state().packs.find((p) => p.id === 'clan').count, 2, 'survives a reload');
});

test('undo: a new word is removed, a merged word gets its old entry back, only the last add, only once', (t) => {
  const r = rig({ files: { 'mine.json': { format: 1, id: 'mine', name: 'My terms', terms: [{ term: 'gyatt', variants: ['gyat'] }] } } }); t.after(r.done);
  const a = r.svc.addTerm({ term: 'rizz' });
  const u = r.svc.undoAdd(a.undo);
  assert.equal(u.ok, true); assert.deepEqual(r.mine(), [{ term: 'gyatt', variants: ['gyat'] }]);
  assert.match(r.svc.undoAdd(a.undo).error, /Nothing to undo/, 'twice is refused');
  const b = r.svc.addTerm({ term: 'Gyatt', variants: ['jayet'], bias: 40 });
  assert.deepEqual(r.mine(), [{ term: 'Gyatt', variants: ['gyat', 'jayet'], bias: 40 }]);
  const c = r.svc.addTerm({ term: 'sigma' });
  assert.match(r.svc.undoAdd(b.undo).error, /Nothing to undo/, 'an older add cannot be undone');
  r.svc.undoAdd(c.undo);
  assert.deepEqual(r.mine(), [{ term: 'Gyatt', variants: ['gyat', 'jayet'], bias: 40 }]);
  const d = r.svc.addTerm({ term: 'GYATT' });
  r.svc.undoAdd(d.undo);
  assert.deepEqual(r.mine(), [{ term: 'Gyatt', variants: ['gyat', 'jayet'], bias: 40 }], 'merge undone: spelling and bias restored');
  assert.match(r.svc.undoAdd('1').error, /Nothing to undo/);
});

test('editing a term in the list keeps its own bias', (t) => {
  const r = rig({ files: { 'mine.json': { format: 1, id: 'mine', name: 'My terms', terms: [{ term: 'rizz', bias: 85 }] } } }); t.after(r.done);
  assert.equal(r.svc.updateTerm('rizz', { term: 'rizzz', variants: ['riz'] }).ok, true);
  assert.deepEqual(r.mine(), [{ term: 'rizzz', variants: ['riz'], bias: 85 }]);
});

test('per-word bias reaches the hotwords file through enabledTerms; the global bias is the engine score', (t) => {
  const r = rig({ settings: { slang: { biasing: { enabled: true, score: 1.5 } } } }); t.after(r.done);
  r.svc.addTerm({ term: 'Zorgle', bias: 80 });
  r.svc.addTerm({ term: 'flibber' });
  assert.equal(r.svc.setBiasPercent('70').ok, true);
  const tok = path.join(r.ud, 'tokens.txt'); fs.writeFileSync(tok, '<blk> 0\n▁a 1\n');
  const o = H.build({ tokensFile: tok, terms: r.svc.enabledTerms(), dir: path.join(r.ud, 'hw'), score: r.store.get().slang.biasing.score });
  const lines = fs.readFileSync(o.hotwordsFile, 'utf8').split('\n');
  assert.ok(lines.includes('zorgle :2.4')); assert.ok(lines.includes('flibber'));
  assert.ok(lines.includes('rizz'), 'built-in pack terms use the global bias');
  assert.equal(o.hotwordsScore, 2.1); assert.equal(H.logLine(o), `hotwords on terms=${o.count} bias=70% own-bias=1`);
});

test('global bias as a percent: stored as its score, shown back as the same percent, survives a restart of the store', (t) => {
  const r = rig(); t.after(r.done);
  assert.equal(r.svc.state().biasing.percent, 50);
  assert.deepEqual(r.svc.setBiasPercent(70), { ok: true, percent: 70 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(r.ud, 'settings.json'), 'utf8')).slang.biasing.score, 2.1);
  assert.equal(new Store(r.ud).get().slang.biasing.score, 2.1);
  assert.deepEqual(r.svc.setBiasPercent('70%'), { ok: true, percent: 70, unchanged: true });
  assert.match(r.svc.setBiasPercent('0').error, /1% to 100%/); assert.match(r.svc.setBiasPercent('abc').error, /number/); assert.match(r.svc.setBiasPercent('').error, /1% to 100%/);
  assert.equal(r.svc.state().biasing.percent, 70, 'refused input changed nothing');
  r.svc.setBiasing(true);
  assert.deepEqual(r.store.get().slang.biasing, { enabled: true, score: 2.1 }, 'the switch keeps the strength');
});

test('legacy settings files: every old stored score still loads and shows as its percentage; no version bump needed', (t) => {
  for (const [score, pct] of [[1.5, 50], [1, 33], [2, 67], [3, 100], [0.1, 3], [2.4, 80]]) {
    const r = rig({ settings: { slang: { enabled: true, packs: {}, biasing: { enabled: true, score } } } });
    assert.equal(r.store.get().slang.biasing.score, score, 'loaded unchanged');
    assert.equal(r.svc.state().biasing.percent, pct, `score ${score}`);
    r.done();
  }
  assert.equal(normalize({ slang: { biasing: { score: 'junk' } } }).slang.biasing.score, 1.5);
  assert.equal(normalize({ slang: { biasing: { score: 99 } } }).slang.biasing.score, 3);
  assert.equal(normalize({ slang: { biasing: { score: 0.01 } } }).slang.biasing.score, 0.03);
  void t;
});

test('IPC: add, undo and set-bias go through the real handlers; a change signals the restart, refused or unchanged input does not', async (t) => {
  const r = rig(); t.after(r.done);
  const hs = new Map(); let changes = 0;
  slangIpc.register({ handle: (ch, fn) => hs.set(ch, fn) }, { service: r.svc, dialog: {}, onChange: () => changes++ });
  const call = (ch, ...a) => hs.get(ch)({}, ...a);
  const a = await call('slang:add', { term: 'rizz', variants: ['riz'], bias: '75' }, { packId: 'mine' });
  assert.equal(a.ok, true); assert.equal(changes, 1); assert.equal(r.mine()[0].bias, 75);
  assert.equal((await call('slang:add', { term: '' })).ok, false); assert.equal(changes, 1);
  assert.equal((await call('slang:add', { term: 'x'.repeat(100000) })).error, 'Term longer than 80 characters.', 'a huge paste is cut at the IPC edge and refused');
  assert.equal((await call('slang:undo-add', a.undo)).ok, true); assert.equal(changes, 2); assert.deepEqual(r.mine(), []);
  assert.equal((await call('slang:set-bias', 60)).ok, true); assert.equal(changes, 3);
  assert.equal((await call('slang:set-bias', '60')).unchanged, true); assert.equal(changes, 3, 'unchanged bias does not restart the engine');
  assert.equal((await call('slang:add', 'not an object')).ok, false);
  assert.equal((await call('slang:add', { term: 'ok', bias: { evil: true } })).ok, false, 'a non-number bias object is refused');
});
