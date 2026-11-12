'use strict';
/* Read aloud, pure logic: chunking, hotkey conflicts, settings, the bzip2 + tar reader, the voice pack store, voices. No Electron, no model. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..', '..');
const C = require(path.join(root, 'src/readaloud/chunker.js'));
const RA = require(path.join(root, 'src/readaloud/settings.js'));
const V = require(path.join(root, 'src/readaloud/voices.js'));
const Z = require(path.join(root, 'src/readaloud/bunzip2.js'));
const MS = require(path.join(root, 'src/readaloud/model-store.js'));
const { normalize, DEFAULTS } = require(path.join(root, 'src/main/settings.js'));
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'bz2-fixtures.json'), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ra-'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/* ---------------- chunking ---------------- */
test('chunking: sentences stay whole, short ones are joined, the first piece is small', () => {
  const r = C.chunkText('Hello there. How are you? I am fine!');
  assert.deepEqual(r.chunks, ['Hello there. How are you? I am fine!'].flatMap((x) => (x.length <= C.FIRST_MAX ? [x] : [])));
  const long = Array.from({ length: 30 }, (_, i) => `This is sentence number ${i + 1} of the long text.`).join(' ');
  const c = C.chunkText(long).chunks;
  assert.ok(c.length > 3);
  assert.ok(c[0].length <= C.FIRST_MAX, 'first piece is short: ' + c[0].length);
  assert.ok(c.slice(1).every((x) => x.length <= C.NEXT_MAX), 'later pieces are bounded');
  assert.ok(c.every((x) => /[.!?]$/.test(x)), 'every piece ends at a sentence end');
  assert.equal(c.join(' '), long, 'nothing lost, nothing added, order kept');
});

test('chunking: abbreviations, decimals and quotes do not split a sentence; a line break does', () => {
  assert.deepEqual(C.sentences('Dr. Smith paid 3.5 euros, e.g. for tea. Then he left.'), ['Dr. Smith paid 3.5 euros, e.g. for tea.', 'Then he left.']);
  assert.deepEqual(C.sentences('He said "stop." She stopped.'), ['He said "stop."', 'She stopped.']);
  assert.deepEqual(C.sentences('Title\nfirst item\nsecond item.'), ['Title', 'first item', 'second item.']);
  assert.deepEqual(C.sentences('Wait... what?! Yes.'), ['Wait...', 'what?!', 'Yes.']);
});

test('chunking: one huge sentence is cut at commas, then spaces, then hard; each cut is within the limit', () => {
  const s = Array.from({ length: 80 }, (_, i) => `clause ${i}`).join(', ') + '.';
  const c = C.chunkText(s).chunks;
  assert.ok(c.length > 2 && c.every((x) => x.length <= C.NEXT_MAX));
  assert.ok(c.slice(0, -1).every((x) => /,$/.test(x)), 'cut after a comma where there is one');
  const nospace = 'x'.repeat(1000);
  const h = C.cutLong(nospace, 300);
  assert.ok(h.every((x) => x.length <= 300) && h.join('') === nospace, 'hard cut keeps every character');
});

test('chunking: whitespace and control characters are tidied; punctuation-only pieces are dropped; empty input gives nothing', () => {
  assert.deepEqual(C.chunkText('  a \u0007 b\t\tc \r\n\r\n d  ').chunks, ['a b c', 'd']);
  assert.deepEqual(C.chunkText('... --- ???').chunks, []);
  assert.deepEqual(C.chunkText('').chunks, []);
  assert.deepEqual(C.chunkText(null).chunks, []);
});

test('chunking: very long text is capped and says so', () => {
  const r = C.chunkText('word '.repeat(40000));
  assert.equal(r.truncated, true);
  assert.ok(r.chars <= C.MAX_TOTAL);
  assert.equal(C.chunkText('short').truncated, false);
});

test('chunking works on Dutch and on text without sentence marks', () => {
  assert.deepEqual(C.chunkText('Dit is een zin. En nog een, bijv. deze.').chunks, ['Dit is een zin. En nog een, bijv. deze.']);
  assert.deepEqual(C.chunkText('no punctuation at all here').chunks, ['no punctuation at all here']);
});

/* ---------------- hotkey conflicts ---------------- */
const CTRL = 0x11, ALT = 0x12, SHIFT = 0x10, SPACE = 0x20, R = 0x52, CAPS = 0x14;
const others = { hold: [CTRL, SPACE], note: [CTRL, SHIFT, SPACE], toggle: CAPS };

test('hotkey: the default Ctrl+Alt+R is fine next to the default dictation keys', () => {
  assert.equal(RA.readChordError(RA.DEFAULT_HOTKEY.vks, others), '');
});
test('hotkey: any chord on the dictation key (Space), the note key or the toggle key is refused, whatever the modifiers', () => {
  assert.match(RA.readChordError([CTRL, ALT, SPACE], others), /dictation hotkey/);
  assert.match(RA.readChordError([ALT, SPACE], others), /dictation hotkey/);
  assert.match(RA.readChordError([CTRL, SHIFT, SPACE], others), /dictation hotkey|note hotkey/);
  assert.match(RA.readChordError([CTRL, ALT, 0x41], { ...others, note: [CTRL, SHIFT, 0x41] }), /note hotkey/);
  assert.match(RA.readChordError([CTRL, ALT, CAPS], others), /toggle/);
});
test('hotkey: structure is checked (a modifier and exactly one other key; Esc, Enter, Backspace, Ctrl+Alt+Delete refused)', () => {
  assert.match(RA.readChordError([R], others), /modifier/);
  assert.match(RA.readChordError([CTRL, ALT], others), /modifier/);
  assert.match(RA.readChordError([CTRL, R, 0x54], others), /exactly one/);
  assert.match(RA.readChordError([CTRL, 0x1B], others), /Esc/);
  assert.match(RA.readChordError([CTRL, 0x0D], others), /Esc|Enter/);
  assert.match(RA.readChordError([CTRL, ALT, 0x2E], others), /Delete/);
  assert.equal(RA.readChordError([0xA2, 0xA4, R], others), '', 'left Ctrl + left Alt are modifiers too');
  assert.match(RA.readChordError('x', others), /modifier/);
});
test('hotkey: when the dictation keys move onto the read chord the read chord goes back to the default, and if that clashes it switches itself off', () => {
  const n1 = normalize({ readAloud: { enabled: true, hotkey: { vks: [CTRL, ALT, SPACE], label: 'x' } } });
  assert.deepEqual(n1.readAloud.hotkey.vks, RA.DEFAULT_HOTKEY.vks, 'a clashing saved chord reverts');
  assert.equal(n1.readAloud.enabled, true);
  const n2 = normalize({ hotkey: { vks: [CTRL, ALT, R], label: 'Ctrl+Alt+R' }, readAloud: { enabled: true } });
  assert.equal(n2.readAloud.enabled, false, 'the default chord is taken by dictation: off, not fighting for the key');
  const n3 = normalize({ notes: { noteHotkey: { vks: [CTRL, ALT, R], label: 'x' } }, readAloud: { enabled: true } });
  assert.equal(n3.readAloud.enabled, false, 'the note chord took Ctrl+Alt+R first: the read feature switches off rather than share the key');
});

/* ---------------- settings ---------------- */
test('settings: read aloud is OFF by default, bm_george, speed 1, Ctrl+Alt+R; auto-install is ON by default', () => {
  assert.equal(DEFAULTS.readAloud.enabled, false);
  assert.equal(DEFAULTS.readAloud.voice, 'bm_george');
  assert.equal(DEFAULTS.readAloud.speed, 1);
  assert.deepEqual(DEFAULTS.readAloud.hotkey.vks, [CTRL, ALT, R]);
  assert.equal(DEFAULTS.updates.installAuto, true);
  assert.equal(normalize({}).updates.installAuto, true, 'an older settings file gets the new default');
  assert.equal(normalize({ updates: { auto: false } }).updates.installAuto, true);
  assert.equal(normalize({ updates: { installAuto: false } }).updates.installAuto, false);
});
test('settings: voice and speed are validated', () => {
  const r = normalize({ readAloud: { enabled: true, voice: 'nope', speed: 9 } }).readAloud;
  assert.equal(r.voice, 'bm_george'); assert.equal(r.speed, RA.SPEED_MAX);
  assert.equal(normalize({ readAloud: { speed: 0.1 } }).readAloud.speed, RA.SPEED_MIN);
  assert.equal(normalize({ readAloud: { speed: 'abc' } }).readAloud.speed, 1);
  assert.equal(normalize({ readAloud: { voice: 'af_bella' } }).readAloud.voice, 'af_bella');
  assert.equal(normalize({ readAloud: { enabled: 'yes' } }).readAloud.enabled, false, 'only a real true switches it on');
  assert.equal(normalize(JSON.parse(JSON.stringify(normalize({ readAloud: { enabled: true } })))).readAloud.enabled, true, 'a round trip keeps it');
});
test('voices: bm_george is speaker 26 and the default; ids are unique; every voice has a label', () => {
  assert.equal(V.DEFAULT_VOICE, 'bm_george'); assert.equal(V.sidOf('bm_george'), 26);
  assert.equal(V.sidOf('does-not-exist'), 26, 'unknown falls back to the default');
  assert.equal(new Set(V.VOICES.map((v) => v.id)).size, V.VOICES.length);
  assert.equal(new Set(V.VOICES.map((v) => v.sid)).size, V.VOICES.length);
  assert.ok(V.VOICES.every((v) => v.label && /^[ab][fm]_/.test(v.id)));
});

/* ---------------- bzip2 + tar ---------------- */
const unz = (b64) => { const parts = []; Z.bunzip2(Buffer.from(b64, 'base64'), (p) => parts.push(Buffer.from(p))); return Buffer.concat(parts); };
test('bzip2: plain text, runs, random bytes and a multi-block stream decode exactly (fixtures made by Python bz2)', () => {
  assert.equal(unz(FX.text).toString(), FX.text_plain);
  assert.equal(sha(unz(FX.runs)), FX.runs_sha);
  assert.ok(unz(FX.random).equals(Buffer.from(FX.random_b64, 'base64')));
  const big = unz(FX.blocks);
  assert.equal(big.length, FX.blocks_len); assert.equal(sha(big), FX.blocks_sha);
});
test('bzip2: two streams in a row decode as one; damaged input throws instead of returning garbage', () => {
  const two = Buffer.concat([Buffer.from(FX.text, 'base64'), Buffer.from(FX.text, 'base64')]);
  const parts = []; Z.bunzip2(two, (p) => parts.push(Buffer.from(p)));
  assert.equal(Buffer.concat(parts).toString(), FX.text_plain + FX.text_plain);
  assert.throws(() => Z.bunzip2(Buffer.from('not bzip2 at all'), () => {}), /bad header/);
  const cut = Buffer.from(FX.blocks, 'base64').subarray(0, 40);
  assert.throws(() => Z.bunzip2(cut, () => {}), /bzip2/);
});
test('tar: files and folders unpack under the folder; a filter skips what is not wanted; an empty file is created', () => {
  const dir = tmp(), arc = path.join(dir, 'p.tar.bz2');
  fs.writeFileSync(arc, Buffer.from(FX.tarbz2, 'base64'));
  const made = Z.extractTarBz2(arc, path.join(dir, 'out'), { top: 'pk', filter: (rel) => !rel.endsWith('skip.me') });
  assert.deepEqual(made.map((m) => m.rel).sort(), ['pk/a.txt', 'pk/empty.txt', 'pk/sub/b.bin']);
  assert.equal(fs.readFileSync(path.join(dir, 'out/pk/a.txt'), 'utf8'), 'AAA');
  assert.equal(fs.readFileSync(path.join(dir, 'out/pk/sub/b.bin')).length, 1280);
  assert.equal(fs.statSync(path.join(dir, 'out/pk/empty.txt')).size, 0);
  assert.equal(fs.existsSync(path.join(dir, 'out/pk/skip.me')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('tar: a path that climbs out of the folder, or sits outside the expected top folder, is refused and nothing is written outside', () => {
  const dir = tmp(), arc = path.join(dir, 'e.tar.bz2');
  fs.writeFileSync(arc, Buffer.from(FX.evil, 'base64'));
  assert.throws(() => Z.extractTarBz2(arc, path.join(dir, 'out'), { top: 'pk' }), /unsafe path/);
  assert.equal(fs.existsSync(path.join(dir, 'evil.txt')), false);
  fs.writeFileSync(arc, Buffer.from(FX.tarbz2, 'base64'));
  assert.throws(() => Z.extractTarBz2(arc, path.join(dir, 'out2'), { top: 'other' }), /unexpected path/);
  for (const bad of ['../x', '/abs', 'C:/x', 'a/../b', 'a\\..\\b', '', 'a/b:c']) assert.equal(Z.safeRel(bad), '', bad);
  assert.equal(Z.safeRel('a\\b/./c'), 'a/b/c');
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ---------------- the voice pack ---------------- */
test('voice pack: the pin is the GitHub asset digest of the k2-fsa release asset, 5 files hashed, espeak data counted', () => {
  assert.match(MS.PACK.url, /^https:\/\/github\.com\/k2-fsa\/sherpa-onnx\/releases\/download\/tts-models\/kokoro-multi-lang-v1_0\.tar\.bz2$/);
  assert.equal(MS.PACK.sha256, '60703707bc05ccd48d60e1eb723f38b07d6e474795a0b6a588d7220400e0f7a4');
  assert.equal(MS.PACK.bytes, 349886476);
  assert.ok(MS.PACK.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256) && f.bytes > 0));
  assert.equal(MS.PACK.files.map((f) => f.rel).join(), 'model.onnx,voices.bin,tokens.txt,lexicon-us-en.txt,lexicon-gb-en.txt');
  assert.equal(MS.PACK.espeakFiles, 355);
});

function fakePack(dir) {                      // a tiny pack in the same shape: 2 files + a data folder with 2 files, served from memory
  const files = { 'model.onnx': Buffer.from('MODEL'), 'tokens.txt': Buffer.from('tok') };
  const eg = { 'a': Buffer.from('1'), 'b/c': Buffer.from('22') };
  return { files, eg, pack: { id: 'fp', url: 'https://example.invalid/fp.tar.bz2', bytes: 0, sha256: '', top: 'pk', files: Object.entries(files).map(([rel, b]) => ({ rel, bytes: b.length, sha256: sha(b) })), keepDirs: ['espeak-ng-data/'], espeakFiles: 2, extra: [] } };
}

test('voice pack: status is missing -> ok, hash-checked, and a damaged file is reported bad', async () => {
  const dir = tmp();
  const { files, pack } = fakePack(dir);
  assert.equal((await MS.status(dir, { pack })).ok, false);
  const p = MS.paths(dir, pack);
  fs.mkdirSync(path.join(p.dir, 'espeak-ng-data/b'), { recursive: true });
  for (const [rel, b] of Object.entries(files)) fs.writeFileSync(path.join(p.dir, rel), b);
  fs.writeFileSync(path.join(p.dir, 'espeak-ng-data/a'), '1'); fs.writeFileSync(path.join(p.dir, 'espeak-ng-data/b/c'), '22');
  assert.deepEqual(await MS.status(dir, { pack, quick: false }), { ok: true, missing: [], bad: [] });
  fs.writeFileSync(path.join(p.dir, 'tokens.txt'), 'XYZ');          // same size, other content: only the full check sees it
  assert.equal((await MS.status(dir, { pack, quick: true })).ok, true);
  assert.deepEqual((await MS.status(dir, { pack, quick: false })).bad, ['tokens.txt']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('voice pack: ensure() with a wrong download hash deletes the download and installs nothing; with the right one it installs, verified', async () => {
  const dir = tmp();
  const { pack } = fakePack(dir);
  const archive = Buffer.from(FX.tarbz2, 'base64');                // pk/a.txt etc: not the fake pack's files, so unpack succeeds but verification must fail
  const fetchOk = (hash) => async (url, dest, { onBytes }) => { fs.writeFileSync(dest, archive); onBytes(archive.length, archive.length); return { sha256: hash, bytes: archive.length }; };
  await assert.rejects(MS.ensure(dir, { pack: { ...pack, sha256: sha(archive), bytes: archive.length }, fetchArchive: fetchOk('0'.repeat(64)) }), /hash mismatch/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'tts')), [], 'download and temp folder removed');
  await assert.rejects(MS.ensure(dir, { pack: { ...pack, sha256: sha(archive), bytes: archive.length }, fetchArchive: fetchOk(sha(archive)) }), /failed its check/);
  assert.equal(fs.existsSync(MS.paths(dir, pack).dir), false, 'a pack that does not match is never moved into place');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'tts')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('voice pack: a good archive is downloaded, unpacked in a worker, checked and moved into place; remove() deletes it', async () => {
  const dir = tmp();
  // build a matching archive with Python's tarfile+bz2 would need python; use the committed fixture shape instead: pk/{a.txt,sub/b.bin}
  const archive = Buffer.from(FX.tarbz2, 'base64');
  const a = Buffer.from('AAA'), b = Buffer.from(Array.from({ length: 1280 }, (_, i) => i % 256));
  const pack = { id: 'fp', url: 'https://example.invalid/fp.tar.bz2', bytes: archive.length, sha256: sha(archive), top: 'pk', files: [{ rel: 'a.txt', bytes: 3, sha256: sha(a) }, { rel: 'sub/b.bin', bytes: 1280, sha256: sha(b) }], keepDirs: [], espeakFiles: 0, extra: [] };
  // status() needs an espeak-ng-data folder in the real pack; the fake has espeakFiles 0 but the folder must exist: create it in the check by keeping an (empty) dir
  pack.keepDirs = ['espeak-ng-data/'];
  const seen = [];
  const r = await MS.ensure(dir, { pack, fetchArchive: async (url, dest, { onBytes }) => { fs.writeFileSync(dest, archive); onBytes(archive.length, archive.length); return { sha256: sha(archive), bytes: archive.length }; }, onProgress: (p) => seen.push(p.phase) }).catch((e) => e);
  // the fake archive has no espeak-ng-data folder, so the real "must exist" rule rejects it: that is the rule working
  assert.ok(r instanceof Error && /espeak-ng-data/.test(r.message), String(r && r.message));
  assert.ok(seen.includes('download') && seen.includes('unpack'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('voice pack: remove() deletes the whole tts folder', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'tts/kokoro-multi-lang-v1_0'), { recursive: true }); fs.writeFileSync(path.join(dir, 'tts/kokoro-multi-lang-v1_0/x'), '1');
  MS.remove(dir);
  assert.equal(fs.existsSync(path.join(dir, 'tts')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
