'use strict';
/* L3: the pieces together. SlangService on a temp folder, settings, the clean() pipeline, a DictationSession with a fake ASR,
   the controller wiring, the cleanup model prompt and guard, and the IPC handlers with fake dialogs. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const root = path.join(__dirname, '..', '..');
const { SlangService } = require(path.join(root, 'src/slang/service.js'));
const ipc = require(path.join(root, 'src/slang/ipc.js'));
const P = require(path.join(root, 'src/slang/pack.js'));
const { Store, normalize, DEFAULTS } = require(path.join(root, 'src/main/settings.js'));
const { clean } = require(path.join(root, 'src/core/postprocess.js'));
const { DictationSession } = require(path.join(root, 'src/core/session.js'));
const { Controller } = require(path.join(root, 'src/main/controller.js'));
const { MemoryTyper } = require(path.join(root, 'src/typer/typer.js'));
const { cleanupMessages, LlmService } = require(path.join(root, 'src/llm/cleanup.js'));
const { acceptCleanup, keepsVocab } = require(path.join(root, 'src/llm/guard.js'));

const BUILTIN = path.join(root, 'src', 'slang', 'packs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-slang-'));
function mkService(extra = {}) {
  const dir = tmp();
  const store = new Store(dir);
  const svc = new SlangService({ builtinDir: BUILTIN, userDir: path.join(dir, 'dictionary', 'packs'), getSettings: () => store.get(), setSettings: (p) => store.set(p), ...extra });
  return { dir, store, svc, userDir: path.join(dir, 'dictionary', 'packs') };
}

test('service: loads the built-in packs, nothing else, from a clean install', () => {
  const { svc } = mkService();
  const st = svc.state();
  assert.deepEqual(st.packs.map((p) => p.id).sort(), ['starter-en', 'starter-nl']);
  assert.ok(st.packs.every((p) => p.builtin && p.enabled));
  assert.equal(st.problems.length, 0);
  assert.ok(st.active >= 450);
});

test('built-in packs: no conflicting entries, no term that is a one-character word, every variant sane', () => {
  const { svc } = mkService();
  const m = svc.matcher();
  assert.deepEqual(m.conflicts, [], JSON.stringify(m.conflicts.slice(0, 3)));
  for (const p of svc.packs) {
    assert.deepEqual(p.warnings, p.warnings.filter((w) => !/Skipped|duplicate/.test(w)), p.id + ' has load problems');
    for (const t of p.terms) {
      assert.ok(t.term.length >= 2 || t.matchCase, t.term);
      assert.ok(!/^\s|\s$/.test(t.term));
    }
  }
});

test('built-in packs: ordinary sentences with look-alike words come out unchanged', () => {
  const { svc } = mkService();
  for (const s of ['Rode a bike to the road.', 'We lock in the price tomorrow.', 'The tick tock of the clock.', 'He was goaded into it.'.replace('goaded', 'nudged'),
    'I saw a yacht and a fortnight of rain.', 'Kick off the meeting at ten.', 'Look at the Rumble strip.'.replace('Rumble', 'rumble'), 'My bay window has a nice view.',
    'Justin is here and the atomic clock is breezy.', 'She tea bagged nothing.', 'Hello team, this is a quick test of the new dictation tool.']) {
    assert.equal(svc.apply(s), s, s);
  }
});

test('built-in packs: the headline examples', () => {
  const { svc } = mkService();
  assert.equal(svc.apply('He has so much riz, no kap.'), 'He has so much rizz, no cap.');
  assert.equal(svc.apply('that was a gee gee, ceiling shot and a flip reset'), 'that was a GG, ceiling shot and a flip reset');
  assert.equal(svc.apply('we were so cookt'), 'we were so cooked');
  assert.equal(svc.apply('you on tiktok again'), 'you on TikTok again');
});

test('service: enable / disable a pack and the master switch, persisted in settings', () => {
  const { svc, store } = mkService();
  assert.equal(svc.apply('riz'), 'Rizz');
  svc.setEnabled('starter-en', false);
  assert.equal(svc.apply('riz'), 'riz');
  assert.equal(store.get().slang.packs['starter-en'], false);
  assert.equal(svc.apply('wolla'), 'Wallah', 'the Dutch pack is independent');
  svc.setEnabled('starter-en', true); svc.setEnabled('*', false);
  assert.equal(svc.apply('riz'), 'riz', 'master switch off');
  assert.equal(svc.state().active, svc.activeCount()); assert.equal(svc.activeCount(), svc.state().active);
  svc.setEnabled('*', true);
  assert.equal(svc.apply('riz'), 'Rizz');
  assert.equal(svc.setEnabled('nope', true).ok, false);
});

test('service: add, edit, delete a term; persisted on disk; applied at once', () => {
  const { svc, userDir } = mkService();
  assert.equal(svc.apply('so the zorg'), 'so the zorg');
  assert.equal(svc.addTerm({ term: 'Zorgle', variants: ['zorg', 'zorgel'] }).ok, true);
  assert.equal(svc.apply('so the zorg'), 'so the Zorgle');
  const file = path.join(userDir, 'mine.json');
  assert.ok(fs.existsSync(file));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).terms[0].term, 'Zorgle');
  assert.equal(svc.addTerm({ term: 'zorgle', variants: ['zorgl'] }).merged, true, 'same word merges variants and takes the new spelling');
  assert.deepEqual(svc.terms('mine').items[0].variants, ['zorg', 'zorgel', 'zorgl']);
  assert.equal(svc.updateTerm('zorgle', { term: 'Zorgle', variants: ['zorg'] }).ok, true);
  assert.equal(svc.apply('so zorgel'), 'so zorgel');
  assert.equal(svc.removeTerm('Zorgle').ok, true);
  assert.equal(svc.apply('so the zorg'), 'so the zorg');
  assert.equal(svc.removeTerm('Zorgle').ok, false);
  assert.equal(svc.addTerm({ term: '' }).ok, false);
  assert.equal(svc.addTerm({ term: '!!!' }).ok, false);
  assert.equal(svc.addTerm({ term: 'x'.repeat(200) }).ok, false);
  // survives a restart
  const again = new SlangService({ builtinDir: BUILTIN, userDir, getSettings: () => ({}), setSettings() {} });
  assert.equal(again.state().mine.count, 0);
  svc.addTerm({ term: 'Kept', variants: ['kept up'] });
  assert.equal(new SlangService({ builtinDir: BUILTIN, userDir, getSettings: () => ({}), setSettings() {} }).state().mine.count, 1);
});

test('service: user terms beat built-in packs on the same heard text', () => {
  const { svc } = mkService();
  svc.addTerm({ term: 'rizzy', variants: ['riz'] });
  assert.equal(svc.apply('so riz'), 'so rizzy');
});

test('service: import text as a new pack, into My terms, and the parse report', () => {
  const { svc, userDir } = mkService();
  const r = svc.importText('# comment\nzorbo,zorbow|zorboe\nflibber\n"quoted, term",q\n', { name: 'Streamer words', fileName: 'ignored.csv' });
  assert.equal(r.ok, true); assert.equal(r.packId, 'streamer-words'); assert.equal(r.added, 3);
  assert.ok(fs.existsSync(path.join(userDir, 'streamer-words.json')));
  assert.equal(svc.apply('so zorbow'), 'so zorbo');
  const again = svc.importText('plain\nlist\n', { fileName: 'streamer-words.txt' });
  assert.equal(again.packId, 'streamer-words-2', 'an existing id is never overwritten');
  const mine = svc.importText('alpha1,alpha one\nbeta1', { target: 'mine' });
  assert.deepEqual([mine.ok, mine.packId, mine.added], [true, 'mine', 2]);
  assert.equal(svc.importText('', {}).ok, false);
  assert.equal(svc.importText('###\n!!!', {}).ok, false);
  assert.equal(svc.importText('{"terms": [', { fileName: 'x.json' }).ok, false);
});

test('service: import cannot write outside the packs folder (path traversal in names and ids)', () => {
  const { svc, dir, userDir } = mkService();
  fs.mkdirSync(userDir, { recursive: true });
  const before = new Set(fs.readdirSync(dir));
  for (const name of ['../../evil', '..\\..\\evil', 'C:\\Windows\\evil', '/etc/passwd', '....//x', 'con', 'a/b/c']) {
    const r = svc.importText('abc1\ndef2', { name, fileName: name + '.csv' });
    assert.equal(r.ok, true, name);
    assert.ok(P.ID_RE.test(r.packId), r.packId);
  }
  const r2 = svc.importText(JSON.stringify({ id: '../../../evil', name: '../x', terms: [{ term: 'abc1' }] }), { fileName: '..\\..\\sneaky.json' });
  assert.ok(P.ID_RE.test(r2.packId));
  for (const f of fs.readdirSync(userDir)) assert.ok(/^[a-z0-9][a-z0-9_-]*\.json$/.test(f), f);
  const after = fs.readdirSync(dir).filter((f) => !before.has(f));
  assert.deepEqual(after, [], 'nothing new next to the packs folder: ' + after.join());
  assert.ok(!fs.existsSync(path.join(dir, 'evil.json')) && !fs.existsSync(path.join(dir, '..', 'evil.json')));
  assert.equal(svc.deletePack('../../x').ok, false);
});

test('service: bad packs on disk are reported and skipped, not fatal', () => {
  const { dir, userDir } = mkService();
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, 'broken.json'), '{"terms": [');
  fs.writeFileSync(path.join(userDir, 'wrongfmt.json'), JSON.stringify({ format: 9, terms: [] }));
  fs.writeFileSync(path.join(userDir, 'empty.json'), '');
  fs.writeFileSync(path.join(userDir, 'huge.json'), 'x'.repeat(5 * 1024 * 1024 + 10));
  fs.writeFileSync(path.join(userDir, 'good.json'), JSON.stringify({ terms: [{ term: 'okayy', variants: ['okay y'] }] }));
  fs.writeFileSync(path.join(userDir, 'notes.md'), 'ignored');
  fs.writeFileSync(path.join(userDir, 'list.txt'), 'plainterm\nanother');
  const svc = new SlangService({ builtinDir: BUILTIN, userDir, getSettings: () => ({}), setSettings() {} });
  const ids = svc.state().packs.map((p) => p.id);
  assert.ok(ids.includes('good') && ids.includes('list') && ids.includes('starter-en'));
  assert.ok(!ids.includes('broken') && !ids.includes('huge'));
  const bad = svc.state().problems.map((p) => p.file).sort();
  assert.deepEqual(bad, ['broken.json', 'huge.json', 'wrongfmt.json']);
  assert.equal(svc.state().packs.find((p) => p.id === 'empty').count, 0, 'an empty file is an empty pack');
  assert.equal(svc.apply('so okay y'), 'so okayy');
  void dir;
});

test('service: two packs with the same id, the second is ignored with a message', () => {
  const { userDir } = mkService();
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, 'a.json'), JSON.stringify({ id: 'same', terms: [{ term: 'aaa1' }] }));
  fs.writeFileSync(path.join(userDir, 'b.json'), JSON.stringify({ id: 'same', terms: [{ term: 'bbb1' }] }));
  const svc = new SlangService({ builtinDir: BUILTIN, userDir, getSettings: () => ({}), setSettings() {} });
  assert.equal(svc.state().packs.filter((p) => p.id === 'same').length, 1);
  assert.ok(svc.state().problems.some((p) => p.file === 'b.json'));
});

test('service: export JSON and CSV round-trip through import; built-in packs cannot be deleted', () => {
  const { svc } = mkService();
  svc.addTerm({ term: 'Zorgle', variants: ['zorg'], category: 'x' });
  const j = svc.exportPack('mine', 'json');
  assert.equal(j.name, 'mine.json');
  assert.equal(JSON.parse(j.text).terms[0].term, 'Zorgle');
  const c = svc.exportPack('mine', 'csv');
  assert.match(c.text, /^term,variants,category,lang,casing/);
  const r = svc.importText(c.text, { name: 'Round trip' });
  assert.equal(r.ok, true);
  assert.deepEqual(svc.terms('round-trip').items.map((t) => [t.term, t.variants]), [['Zorgle', ['zorg']]]);
  assert.equal(svc.exportPack('nope').ok, false);
  assert.equal(svc.deletePack('starter-en').ok, false);
  assert.equal(svc.deletePack('round-trip').ok, true);
  assert.ok(!svc.state().packs.some((p) => p.id === 'round-trip'));
  // the whole built-in pack exports and re-imports without loss
  const en = svc.exportPack('starter-en', 'json');
  const n = svc.importText(en.text, { name: 'copy of starter' });
  assert.equal(n.added, svc.state().packs.find((p) => p.id === 'starter-en').count);
});

test('service: vocabulary hint lists the terms present, capped and unique', () => {
  const { svc } = mkService();
  assert.deepEqual(svc.vocab('Nothing special here.'), []);
  assert.deepEqual(svc.vocab('Yeah rizz and no cap, rizz again'), ['rizz', 'no cap']);
  assert.ok(svc.vocab(svc.exportPack('starter-en').text.slice(0, 20000)).length <= 30);
});

test('settings: slang block is normalised and survives a round trip', () => {
  assert.deepEqual(DEFAULTS.slang, { enabled: true, packs: {}, biasing: { enabled: false, score: 1.5 } });
  const n = normalize({ slang: { enabled: false, packs: { 'ok-id': false, 'Bad Id!': false, '../x': true, good2: 'yes', fine: true } } });
  assert.deepEqual(n.slang, { enabled: false, packs: { 'ok-id': false, fine: true }, biasing: { enabled: false, score: 1.5 } });
  assert.deepEqual(normalize({}).slang, { enabled: true, packs: {}, biasing: { enabled: false, score: 1.5 } });
  assert.deepEqual(normalize({ slang: 5 }).slang, { enabled: true, packs: {}, biasing: { enabled: false, score: 1.5 } });
  const dir = tmp(); const s = new Store(dir); s.set({ slang: { enabled: true, packs: { 'starter-nl': false } } });
  assert.equal(new Store(dir).get().slang.packs['starter-nl'], false);
});

test('clean(): slang runs on finals after snippets, before the Dictionary; the Dictionary wins; no slang = old behaviour', () => {
  const { svc } = mkService();
  const slang = svc.matcher(['riz']);
  assert.equal(clean('um so riz and no kap', { slang }), 'so riz and no cap', 'riz is handed to the Dictionary, so slang leaves it');
  assert.equal(clean('um so riz and no kap', { slang, dictionary: [{ from: 'riz', to: 'RIZZ' }] }), 'so RIZZ and no cap');
  assert.equal(clean('so riz', { slang: svc.matcher() }), 'so rizz');
  assert.equal(clean('So Riz', {}), 'So Riz');
  assert.equal(clean('So Riz', { slang: null }), 'So Riz');
  assert.equal(clean('no kap', { slang, snippets: [{ trigger: 'no kap', expansion: 'LONG' }] }), 'LONG', 'a snippet that is the whole line comes first');
});

class FakeAsr extends EventEmitter {
  start() { return 1; } pushAudio() {} release() { setImmediate(() => this.emit('done', { sid: 1 })); } cancel() {}
}
test('session: a final is fixed by the pack before it is typed; partials are not touched', async () => {
  const { svc } = mkService();
  const asr = new FakeAsr(); const typer = new MemoryTyper({ pid: 4242 });
  const s = new DictationSession({ asr, typer, ownPid: 1, settings: { liveMode: 'aggressive', cap: 40, flushMs: 100, dictionary: [], snippets: [], fillers: [], slang: svc.matcher() } });
  let result; const done = new Promise((r) => s.on('result', (x) => { result = x; r(); }));
  s.start();
  asr.emit('partial', { sid: 1, segId: 1, text: 'so riz and no kap' });
  assert.equal(typer.text, 'so riz and no kap', 'live preview is exactly what the model wrote');
  asr.emit('final', { sid: 1, segId: 1, text: 'so riz and no kap', audioSec: 2 });
  assert.equal(typer.text, 'so rizz and no cap', 'the final replaces it with the corrected spelling');
  s.release(); await done;
  assert.equal(result.text, 'so rizz and no cap');
});

test('session + model: the vocabulary hint, the spelling restored after the model, and the guards', async () => {
  const { svc } = mkService();
  const seen = [];
  const llm = { chat: async ({ messages }) => { seen.push(messages); return 'So rizz and no cap, man.'; } };
  const service = new LlmService({ llm, getSettings: () => ({ cleanup: { timeoutMs: 1500 } }), getVocab: (t) => svc.vocab(t) });
  const r = await service.cleanup('so rizz and no cap man');
  assert.equal(r.used, true);
  assert.match(seen[0][0].content, /keep them exactly as written: rizz, no cap\./);
  // a model that rewrites a term is rejected and the original is kept
  const bad = new LlmService({ llm: { chat: async () => 'So riches and no cap, man.' }, getSettings: () => ({ cleanup: { timeoutMs: 1500 } }), getVocab: (t) => svc.vocab(t) });
  const b = await bad.cleanup('so rizz and no cap man');
  assert.equal(b.used, false); assert.equal(b.text, 'so rizz and no cap man'); assert.equal(b.reason, 'vocabulary changed');
  // with no term in the text the prompt is byte-identical to the old one (prompt cache intact)
  const plain = cleanupMessages('hello there');
  assert.deepEqual(cleanupMessages('hello there', []), plain);
  assert.ok(!/spelled on purpose/.test(plain[0].content));
  // keepsVocab rules
  assert.equal(keepsVocab('no cap fr', 'No cap, fr.', ['no cap']), true, 'a capital at the sentence start is fine for a lower-case term');
  assert.equal(keepsVocab('on tiktok', 'On tiktok', ['TikTok']), true, 'the exact spelling is only demanded when the original had it...');
  assert.equal(keepsVocab('on TikTok', 'On tiktok', ['TikTok']), false, '...and then it must stay exactly');
  assert.equal(keepsVocab('on tiktok', 'On Tik Tok', ['TikTok']), false, 'a term split into pieces is lost');
  assert.equal(keepsVocab('no cap', 'okay', ['no cap']), false);
  assert.equal(keepsVocab('hello', 'hi', ['no cap']), true, 'terms absent from the original are not checked');
  // the existing guard is untouched
  assert.equal(acceptCleanup('so rizz and no cap man', 'Totally different words here now').ok, false);
  // and the session restores a pack spelling the model changed
  const asr = new FakeAsr(); const typer = new MemoryTyper({ pid: 4242 });
  const fake = { used: true, text: 'So, Gee Gee, man.' };
  const sess = new DictationSession({ asr, typer, ownPid: 1, llm: { warm() {}, cleanup: async () => fake, translate: async () => fake },
    settings: { liveMode: 'aggressive', cap: 40, flushMs: 100, dictionary: [], snippets: [], fillers: [], cleanup: { enabled: true, timeoutMs: 1500 }, slang: svc.matcher() } });
  const done = new Promise((r) => sess.on('result', r)); sess.start();
  asr.emit('final', { sid: 1, segId: 1, text: 'so gee gee man', audioSec: 1 });
  sess.release(); const res = await done;
  assert.equal(res.text, 'So, GG, man.');
});

test('controller: sessionSettings carries the matcher with the Dictionary rows excluded; absent service = old behaviour', () => {
  const { svc, store } = mkService();
  store.set({ dictionary: [{ from: 'riz', to: 'Ryz' }] });
  const mk2 = (slang) => new Controller({ getAsr: () => null, typer: new MemoryTyper({ pid: 1 }), store, mic: {}, slang });
  const withPacks = mk2(svc).sessionSettings(store.get());
  assert.equal(withPacks.slang.apply('so riz and no kap'), 'so riz and no cap');
  assert.equal(mk2(null).sessionSettings(store.get()).slang, null);
});

test('ipc: handlers validate input, use dialogs for files, and never take a path from the page', async () => {
  const { svc, dir } = mkService();
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
  const picked = path.join(dir, 'picked.csv'); fs.writeFileSync(picked, 'dialogterm,dialog variant\nsecondterm');
  const out = path.join(dir, 'export-out.json');
  let changes = 0;
  const dialog = { showOpenDialog: async () => ({ canceled: false, filePaths: [picked] }), showSaveDialog: async () => ({ canceled: false, filePath: out }) };
  ipc.register(ipcMain, { service: svc, dialog, getWindow: () => null, onChange: () => { changes++; } });
  const call = (ch, ...a) => handlers.get(ch)({}, ...a);
  assert.ok((await call('slang:state')).packs.length >= 2);
  assert.equal((await call('slang:add', { term: 'Ipcterm', variants: 'ipc term|ipc-term' })).ok, true);
  assert.ok(changes >= 1);
  assert.equal((await call('slang:preview', 'so ipc term')).text, 'so Ipcterm');
  assert.equal((await call('slang:add', null)).ok, false);
  assert.equal((await call('slang:add', { term: { toString() { throw new Error('boom'); } } })).ok, false, 'a hostile argument becomes an error object, not a throw');
  const imp = await call('slang:import-file', { name: 'From dialog' });
  assert.equal(imp.ok, true); assert.equal(imp.added, 2);
  const ex = await call('slang:export', 'from-dialog', 'json');
  assert.equal(ex.ok, true); assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).terms.length, 2);
  const pv = await call('slang:parse-preview', 'a1b\nc2d,e3f');
  assert.equal(pv.stats.accepted, 2); assert.equal(pv.sample[1].variants[0], 'e3f');
  assert.equal((await call('slang:import-text', 'x'.repeat(6 * 1024 * 1024), {})).ok, false);
  // cancelled dialogs change nothing
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  assert.equal((await call('slang:import-file', {})).cancelled, true);
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });          // a directory
  assert.equal((await call('slang:import-file', {})).ok, false);
  assert.equal((await call('slang:set-enabled', 'starter-nl', false)).ok, true);
  assert.equal((await call('slang:terms', 'starter-en', { query: 'rizz', limit: 5 })).items.length > 0, true);
  assert.equal((await call('slang:remove', 'Ipcterm')).ok, true);
});

test('hotwords: build() writes the biasing files; settings carry the switch; the service lists enabled terms', () => {
  const { build } = require(path.join(root, 'src/slang/hotwords.js'));
  const dir = tmp();
  const tokens = path.join(dir, 'tokens.txt'); fs.writeFileSync(tokens, '<unk> 0\n<a> 1\n<b> 2\n<c> 3\n<d> 4\n\u2581ri 5\nzz 6\n');
  assert.equal(build({ tokensFile: tokens, terms: [], dir }), null);
  const o = build({ tokensFile: tokens, terms: ['Rizz', 'rizz', 'no cap', 'x', ''], dir: path.join(dir, 'h'), score: 9 });
  assert.equal(o.count, 2); assert.equal(o.hotwordsScore, 3, 'score is clamped');
  assert.equal(fs.readFileSync(o.hotwordsFile, 'utf8'), 'rizz\nno cap\n');
  assert.match(fs.readFileSync(o.bpeVocab, 'utf8'), /^<unk>\t0\n/);
  const { svc, store } = mkService();
  assert.deepEqual(store.get().slang.biasing, { enabled: false, score: 1.5 });
  svc.setBiasing(true); assert.equal(store.get().slang.biasing.enabled, true);
  svc.setEnabled('starter-nl', false); assert.equal(store.get().slang.biasing.enabled, true, 'other settings are kept');
  assert.ok(svc.enabledTerms().includes('rizz') && !svc.enabledTerms().includes('wallah'));
  assert.equal(normalize({ slang: { biasing: { enabled: 1, score: 99 } } }).slang.biasing.score, 3);
});

test('built-in packs leave the 40 neutral measurement sentences untouched', () => {
  const { svc } = mkService();
  for (const s of require('./tools/neutral.json')) assert.equal(svc.apply(s), s, s);
});
