'use strict';
/* L2: each function alone. Matcher (boundaries, casing, longest match, protected spans, punctuation, apostrophes, Dutch,
   overlaps, catastrophic cases, performance), import parser, pack validation. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const M = require(path.join(root, 'src/slang/matcher.js'));
const P = require(path.join(root, 'src/slang/pack.js'));
const I = require(path.join(root, 'src/slang/import.js'));
const { COMMON } = require(path.join(root, 'src/slang/common.js'));

const mk = (terms, o) => M.compile(P.toForms([P.normalizePack({ terms }, { id: 't' }).pack]), o);
const raw = (terms, text, o) => mk(terms, o).apply(text);
/* most tests put "so " in front so the matched word is mid-sentence (the first word of a text is a sentence start) */
const ap = (terms, text, o) => raw(terms, 'so ' + text, o).slice(3);

/* ---------- matcher ---------- */
test('matcher: whole words only, never inside a longer word', () => {
  const t = [{ term: 'rizz', variants: ['riz'] }];
  assert.equal(ap(t, 'riz'), 'rizz');
  assert.equal(ap(t, 'the riz is real'), 'the rizz is real');
  assert.equal(ap(t, 'rizzy'), 'rizzy');
  assert.equal(ap(t, 'prizzle riz'), 'prizzle rizz');
  assert.equal(ap(t, 'ariz riza riz2 2riz'), 'ariz riza riz2 2riz');
});

test('matcher: casing rules smart / exact / lower / upper / title', () => {
  const ap = raw;
  const r = [{ term: 'rizz', variants: ['riz'] }];
  assert.equal(ap(r, 'Riz is back'), 'Rizz is back', 'sentence start keeps the capital');
  assert.equal(ap(r, 'he has Riz'), 'he has rizz', 'mid sentence: the term spelling');
  assert.equal(ap(r, 'He said. Riz now'), 'He said. Rizz now', 'after a full stop is a sentence start');
  assert.equal(ap(r, 'WITH RIZ'), 'WITH RIZZ', 'shouting stays shouting');
  assert.equal(ap([{ term: 'TikTok', variants: ['tick tock'] }], 'on tiktok and tick tock'), 'on TikTok and TikTok', 'a capital inside the term = exact');
  assert.equal(ap([{ term: 'gg', variants: ['gee gee'], casing: 'upper' }], 'gee gee, gg'), 'GG, GG');
  assert.equal(ap([{ term: 'Skibidi Toilet', variants: ['skibbidy toilet'], casing: 'lower' }], 'Skibbidy toilet'), 'skibidi toilet');
  assert.equal(ap([{ term: 'rocket league', casing: 'title' }], 'i play rocket league'), 'i play Rocket League');
  assert.equal(ap([{ term: 'mid' }], 'that was Mid ok'), 'that was mid ok', 'the model capitalises words it does not know; the term spelling wins mid-sentence');
  assert.equal(ap([{ term: 'mid' }], 'Mid is it'), 'Mid is it', 'but not at the start of a sentence');
  assert.equal(ap([{ term: 'mid', casing: 'keep' }], 'that was Mid ok'), 'that was Mid ok', 'keep: a word that already is the term keeps its case');
  assert.equal(ap([{ term: 'mid', variants: ['med'], casing: 'keep' }], 'that was Med ok'), 'that was mid ok', 'keep still rewrites a variant');
  assert.equal(ap([{ term: 'mid', casing: 'lower' }], 'Mid is it'), 'mid is it', 'lower even at the start');
});

test('matcher: matchCase terms only fire on their exact spelling', () => {
  const t = [{ term: 'GOAT', variants: ['G.O.A.T.'], casing: 'exact', matchCase: true }];
  assert.equal(ap(t, 'the goat on the farm'), 'the goat on the farm', 'the animal is left alone');
  assert.equal(ap(t, 'the GOAT'), 'the GOAT');
  assert.equal(ap(t, 'Messi is the G.O.A.T. ok'), 'Messi is the GOAT. ok');
});

test('matcher: leftmost longest match first', () => {
  const t = [{ term: 'cap', variants: ['kap'] }, { term: 'no cap', variants: ['no kap', 'no cab'] }, { term: 'no cap fr', variants: ['no kap fr'] }];
  assert.equal(ap(t, 'no kap'), 'no cap');
  assert.equal(ap(t, 'no kap fr man'), 'no cap fr man');
  assert.equal(ap(t, 'kap and no cab'), 'cap and no cap');
});

test('matcher: protected spans are never touched', () => {
  const t = [{ term: 'rizz', variants: ['riz'] }, { term: 'no cap', variants: ['no kap'] }];
  const m = mk(t);
  for (const s of ['see https://twitch.tv/riz?x=riz now', 'mail riz@example.com ok', 'open C:\\Users\\riz\\Desktop\\riz.txt please', 'run /usr/local/riz now',
    'use `no kap` here', 'a ```\nno kap\n``` block', 'go to www.riz.gg today', 'cd ~/riz/no', 'file riz.json is', 'ask @riz and #riz', 'riz_bot and my_riz', 'obj.riz.name']) {
    assert.equal(m.apply(s), s, 'unchanged: ' + s);
  }
  assert.equal(m.apply('see https://x.tv/a and riz'), 'see https://x.tv/a and rizz', 'text next to a URL is still fixed');
  assert.equal(m.apply('use `no kap` and no kap'), 'use `no kap` and no cap');
});

test('matcher: punctuation around and inside matches', () => {
  const t = [{ term: 'no cap', variants: ['no kap'] }, { term: 'rizz', variants: ['riz'] }];
  assert.equal(ap(t, '"riz," he said.'), '"rizz," he said.');
  assert.equal(ap(t, '(no kap!)'), '(no cap!)');
  assert.equal(ap(t, 'no-kap'), 'no cap', 'a hyphen between words counts as a space');
  assert.equal(ap(t, 'no  kap'), 'no cap', 'double spaces too');
  assert.equal(ap(t, 'no, kap'), 'no, kap', 'a comma between the words does not');
  assert.equal(ap(t, 'riz.'), 'rizz.');
  assert.equal(ap(t, 'riz... riz'), 'rizz... Rizz', 'the word after a full stop starts a sentence');
});

test('matcher: apostrophes (possessives, contractions, curly quotes)', () => {
  const t = [{ term: 'rizz', variants: ['riz'] }];
  assert.equal(ap(t, "riz's best"), "rizz's best", 'possessive survives');
  assert.equal(ap(t, 'riz\u2019s best'), 'rizz\u2019s best', 'curly apostrophe survives');
  assert.equal(ap(t, "don't riz"), "don't rizz");
  assert.equal(ap([{ term: "dm'en", variants: ['dm en'] }], "ik ga dm'en en dm en"), "ik ga dm'en en dm'en");
});

test('matcher: Dutch characters and non-ASCII', () => {
  const ap = raw;
  const t = [{ term: 'gozer', variants: ['gozzer'] }, { term: 'caf\u00e9', variants: ['cafe'] }, { term: 'Zo\u00eb', variants: ['zoe'] }];
  assert.equal(ap(t, 'die gozzer in het cafe met zoe'), 'die gozer in het caf\u00e9 met Zo\u00eb');
  assert.equal(ap(t, 'gozz\u00e8re'), 'gozz\u00e8re', 'a longer word with an accent is not a match');
  assert.equal(ap(t, 'CAFE'), 'CAF\u00c9');
  assert.equal(ap([{ term: 'wallah', variants: ['wollah'] }], 'Wollah, lekker bezig'), 'Wallah, lekker bezig');
});

test('matcher: overlapping and chained variants', () => {
  const t = [{ term: 'skibidi', variants: ['skibbidy', 'skibity'] }, { term: 'skibidi toilet', variants: ['skibbidy toilet'] }, { term: 'toilet' }];
  assert.equal(ap(t, 'skibbidy toilet and skibity'), 'skibidi toilet and skibidi');
  // a rewrite is never rewritten again
  const chain = [{ term: 'bravo', variants: ['alfa'] }, { term: 'charlie', variants: ['bravo'] }];
  assert.equal(ap(chain, 'alfa'), 'bravo', 'one pass only');
  assert.equal(ap(chain, 'alfa bravo'), 'bravo bravo', 'the first entry owns "bravo"; no second pass');
});

test('matcher: catastrophic cases are refused at pack load, not at match time', () => {
  const r = P.normalizePack({ terms: [{ term: 'aura', variants: ['a'] }, { term: 'rizz', variants: ['the', 'I', 'riz'] }, { term: 'W' }, { term: 'x', matchCase: true }] }, { id: 't' });
  assert.deepEqual(r.pack.terms.map((t) => t.term + ':' + (t.variants || []).join('/')), ['aura:', 'rizz:riz', 'x:'], 'one-letter and very common variants dropped, a one-letter term needs matchCase');
  assert.ok(r.warnings.some((w) => /one character/.test(w)) && r.warnings.some((w) => /very common/.test(w)));
  assert.equal(M.compile(P.toForms([r.pack])).apply('a the I'), 'a the I');
  const keep = P.normalizePack({ terms: [{ term: 'ratio', variants: ['rationale'], allowCommon: true }, { term: 'cap', variants: ['for'], allowCommon: true }] }, { id: 't' });
  assert.deepEqual(keep.pack.terms[1].variants, ['for'], 'allowCommon lets the owner keep a common-word variant on purpose');
});

test('matcher: hostile input never throws and returns a string', () => {
  const m = mk([{ term: 'rizz', variants: ['riz'] }]);
  for (const s of ['', ' ', '\n', '`', '```', 'https://', '\\\\', '\u0000riz', 'riz'.repeat(5000), 'riz '.repeat(2000).trim(), '\ud83d\ude00 riz \ud83d\ude00', '\uff52\uff49\uff5a', 'r\u0131z']) {
    assert.equal(typeof m.apply(s), 'string');
  }
  assert.equal(m.apply('\ud83d\ude00 riz \ud83d\ude00'), '\ud83d\ude00 rizz \ud83d\ude00');
  assert.equal(m.apply(null), '');
  assert.equal(m.apply(undefined), '');
  assert.equal(m.apply(42), '42');
});

test('matcher: performance on a 5,000-term pack with a 20,000-character text', () => {
  const terms = [];
  for (let i = 0; i < 5000; i++) terms.push({ term: 'zorp' + i.toString(36) + 'x', variants: ['zorb' + i.toString(36) + 'x', 'zorp ' + i.toString(36) + ' x'] });
  const pack = P.normalizePack({ terms }, { id: 'big' }).pack;
  assert.equal(pack.terms.length, 5000);
  let t0 = process.hrtime.bigint();
  const m = M.compile(P.toForms([pack]));
  const compileMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const text = ('we met zorbaax today and zorp 7 x said zorpzzx while the cat sat on a mat ').repeat(270);
  assert.ok(text.length > 19000);
  t0 = process.hrtime.bigint();
  const out = m.apply(text);
  const applyMs = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(out.includes('zorpaax') && out.includes('zorp7x'), 'it works at this size: ' + out.slice(0, 80));
  console.log(`# 5000 terms (${m.size} forms): compile ${compileMs.toFixed(1)} ms, apply on ${text.length} chars ${applyMs.toFixed(1)} ms`);
  assert.ok(compileMs < 1500, 'compile ' + compileMs);
  assert.ok(applyMs < 250, 'apply ' + applyMs);
  t0 = process.hrtime.bigint();
  for (let i = 0; i < 1000; i++) m.apply('we met zorbaax today and zorp 7 x said hello to everyone there');
  const per = Number(process.hrtime.bigint() - t0) / 1e6 / 1000;
  console.log(`# a 12-word final: ${per.toFixed(3)} ms`);
  assert.ok(per < 1, 'a short final takes under 1 ms, took ' + per);
});

test('matcher: no catastrophic backtracking on adversarial text', () => {
  const m = mk([{ term: 'no cap', variants: ['no kap'] }]);
  const evil = ('`' + 'a'.repeat(50) + '\n').repeat(500) + 'https://' + 'a.'.repeat(5000) + ' ' + '/'.repeat(5000) + ' ' + '\\'.repeat(5000) + 'C:' + 'x\\'.repeat(3000) + '@'.repeat(5000) + ' no kap';
  const t0 = Date.now();
  m.apply(evil);
  assert.ok(Date.now() - t0 < 2000, 'took ' + (Date.now() - t0) + ' ms');
});

test('matcher: exclude list hands a heard text to the user Dictionary instead', () => {
  const t = [{ term: 'rizz', variants: ['riz'] }];
  assert.equal(ap(t, 'riz', { exclude: ['riz'] }), 'riz');
  assert.equal(ap(t, 'riz', { exclude: ['RIZ'] }), 'riz', 'case-insensitive');
  assert.equal(ap(t, 'rizz riz', { exclude: ['riz'] }), 'rizz riz');
});

test('matcher: explain() reports hits and the terms found (vocabulary hint)', () => {
  const m = mk([{ term: 'rizz', variants: ['riz'] }, { term: 'no cap' }]);
  const r = m.explain('so riz, no cap, riz');
  assert.deepEqual(r.hits.map((h) => h.from + '>' + h.to), ['riz>rizz', 'riz>rizz']);
  assert.deepEqual(r.found, ['rizz', 'no cap', 'rizz']);
});

/* ---------- import parser ---------- */
test('import: one term per line, comments, blanks, duplicates', () => {
  const r = I.parseTerms('# my list\nrizz\n\n  no cap  \nRizz\nsigma male\r\nbussin\n');
  assert.deepEqual(r.terms.map((t) => t.term), ['rizz', 'no cap', 'sigma male', 'bussin']);
  assert.equal(r.stats.duplicates, 1);
});

test('import: term,variant1|variant2 and extra columns', () => {
  const r = I.parseTerms('rizz,riz|rits\nno cap,no kap|no cab,slang,en,smart\nplain');
  assert.deepEqual(r.terms[0], { term: 'rizz', variants: ['riz', 'rits'] });
  assert.deepEqual(r.terms[1], { term: 'no cap', variants: ['no kap', 'no cab'], category: 'slang', lang: 'en', casing: 'smart' });
  assert.deepEqual(r.terms[2], { term: 'plain', variants: [] });
});

test('import: CSV edge cases (quotes, embedded comma and quote, header, tabs, BOM, semicolons)', () => {
  assert.deepEqual(I.parseTerms('"no cap, fr",no kap|no cab').terms[0], { term: 'no cap, fr', variants: ['no kap', 'no cab'] });
  assert.deepEqual(I.parseTerms('"say ""hi""",x').terms[0], { term: 'say "hi"', variants: ['x'] });
  assert.deepEqual(I.parseTerms('"multi\nline",v').terms[0], { term: 'multi line', variants: ['v'] });
  const h = I.parseTerms('Term,Variants,Category\nrizz,riz,slang\n');
  assert.deepEqual(h.terms, [{ term: 'rizz', variants: ['riz'], category: 'slang' }], 'header row is not a term');
  assert.equal(I.parseTerms('word;heard\nrizz;riz\n').terms.length, 1);
  assert.deepEqual(I.parseTerms('rizz\triz|rits\nno cap\tno kap').terms.map((t) => t.variants.length), [2, 1], 'tab separated');
  assert.equal(I.parseTerms('\ufeffrizz\n').terms[0].term, 'rizz', 'BOM');
  assert.deepEqual(I.parseTerms('a"b,c').terms[0], { term: 'a"b', variants: ['c'] }, 'a stray quote inside a field is a plain character');
  assert.deepEqual(I.parseTerms('"unclosed,x\nnext').terms.map((t) => t.term), ['"unclosed', 'next'], 'an unmatched quote cannot swallow the file');
  assert.equal(I.parseTerms('rizz,\n,riz\n,\n').terms.length, 1, 'empty cells and empty rows');
  assert.equal(I.parseTerms('rizz,riz||rits| |').terms[0].variants.length, 2, 'empty variants dropped');
});

test('import: hostile and junk input', () => {
  assert.deepEqual(I.parseTerms('').terms, []);
  assert.deepEqual(I.parseTerms(null).terms, []);
  assert.deepEqual(I.parseTerms('!!!\n---\n...').terms, [], 'no letters = no term');
  const r = I.parseTerms('x'.repeat(500) + '\nok');
  assert.deepEqual(r.terms.map((t) => t.term), ['ok']);
  assert.ok(r.warnings.length);
  assert.deepEqual(I.parseTerms('ri\u0000zz\u200b\n\u202ehello\u202c').terms.map((t) => t.term), ['rizz', 'hello'], 'control and bidi characters are stripped');
  const many = I.parseTerms(Array.from({ length: 25000 }, (_, i) => 'term' + i).join('\n'), { maxTerms: 20000 });
  assert.equal(many.terms.length, 20000); assert.ok(many.warnings.some((w) => /Stopped at 20000/.test(w)));
  assert.equal(I.parseTerms('x'.repeat(6 * 1024 * 1024)).terms.length, 0, 'over 5 MB is refused');
});

test('import: toCsv round trips', () => {
  const terms = [{ term: 'no cap, fr', variants: ['no kap', 'no cab'] }, { term: 'say "hi"', variants: [] }, { term: 'rizz', variants: ['riz'], heard: ['rits'], category: 'slang', lang: 'en' }];
  const back = I.parseTerms(I.toCsv(terms)).terms;
  assert.deepEqual(back.map((t) => t.term), terms.map((t) => t.term));
  assert.deepEqual(back[2].variants, ['riz', 'rits']);
  assert.equal(back[2].category, 'slang');
});

/* ---------- pack validation ---------- */
test('pack: slug never yields a path', () => {
  for (const [i, o] of [['../../evil', 'evil'], ['C:\\Windows\\x.json', 'c-windows-x'], ['  My Pack!  ', 'my-pack'], ['', 'pack'], ['....', 'pack'], ['a/b/c.csv', 'a-b-c'], ['\u00c0\u00c9\u00ce', 'aei'], ['x'.repeat(200), 'x'.repeat(48)]]) {
    const s = P.slug(i);
    assert.equal(s, o, JSON.stringify(i));
    assert.ok(P.ID_RE.test(s));
  }
});

test('pack: normalizePack coerces junk instead of throwing', () => {
  for (const bad of [null, undefined, 5, 'x', [], { terms: 'x' }, { terms: null }]) assert.equal(P.normalizePack(bad).pack, null);
  assert.equal(P.normalizePack({ format: 2, terms: [] }).pack, null);
  const r = P.normalizePack({ id: '../x', name: 5, terms: [null, 3, {}, { term: 'ok', variants: 'a b|cd' }, { term: ' OK ' }, { term: 'x'.repeat(200) }, 'plain', { term: 'big', variants: Array.from({ length: 100 }, (_, i) => 'vv' + i) }] });
  assert.ok(P.ID_RE.test(r.pack.id));
  assert.deepEqual(r.pack.terms.map((t) => t.term), ['ok', 'plain', 'big']);
  assert.deepEqual(r.pack.terms[0].variants, ['a b', 'cd']);
  assert.equal(r.pack.terms[2].variants.length, P.LIMITS.variantsPerTerm);
  assert.ok(r.warnings.length);
});

test('pack: the same spelling twice keeps the first', () => {
  const r = P.normalizePack({ terms: [{ term: 'Rizz', variants: ['riz'] }, { term: 'rizz', variants: ['ris'] }] });
  assert.equal(r.pack.terms.length, 1); assert.deepEqual(r.pack.terms[0].variants, ['riz']);
});

test('pack: parsePackText reads JSON, array JSON, CSV and plain text; bad JSON is an error, not a crash', () => {
  assert.equal(P.parsePackText('{"terms":[{"term":"a1"}]}', { fileName: 'x.json' }).pack.terms.length, 1);
  assert.equal(P.parsePackText('["rizz","aura"]', { fileName: 'x.json' }).pack.terms.length, 2);
  assert.equal(P.parsePackText('rizz,riz\naura', { fileName: 'terms.csv' }).pack.id, 'terms');
  const bad = P.parsePackText('{"terms": [', { fileName: 'x.json' });
  assert.equal(bad.pack, null); assert.match(bad.errors[0], /not valid JSON/);
  assert.equal(P.parsePackText('x'.repeat(6 * 1024 * 1024)).pack, null);
  assert.equal(P.parsePackText('{"id":"../../etc","terms":[{"term":"ab"}]}', { fileName: 'x.json' }).pack.id, 'x', 'a hostile id inside the file is replaced by the file name');
});

test('pack: common-word list covers the words that would wreck a sentence', () => {
  for (const w of ['a', 'the', 'is', 'to', 'and', 'ik', 'de', 'het', 'een', 'niet']) assert.ok(COMMON.has(w), w);
});
