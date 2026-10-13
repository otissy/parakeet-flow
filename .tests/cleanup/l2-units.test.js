'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const G = require(path.join(root, 'src/llm/guard.js'));
const { LlmService, cleanupMessages } = require(path.join(root, 'src/llm/cleanup.js'));
const { LlmTimeout } = require(path.join(root, 'src/llm/llm-host.js'));
const store = require(path.join(root, 'src/llm/llm-store.js'));

const ORIG = 'can you send me the report i think its important';

/* ---------- the guard ---------- */
test('guard accepts a faithful fix (punctuation, casing, apostrophe), with or without quotes and newlines', () => {
  for (const out of ["Can you send me the report? I think it's important.", "\n\nCan you send me the report? I think it's important.", '"Can you send me the report? I think it\'s important."', 'Can you send me\nthe report? I think it\'s important.']) {
    const v = G.acceptCleanup(ORIG, out); assert.equal(v.ok, true, out + ' -> ' + v.reason);
  }
});

test('guard rejects garbage', () => {
  for (const out of ['', '   ', '<think>\n\n</think>Can you send me the report', 'Can you send me the report <|im_end|>', '```\ncan you send me the report\n```', 'Can you send me the report 发送报告',
    'Here is the corrected text: Can you send me the report? I think it is important.', null, undefined]) {
    assert.equal(G.acceptCleanup(ORIG, out).ok, false, JSON.stringify(out));
  }
});

test('guard rejects divergent output: an answer, an addition, a truncation, a rewrite, another language', () => {
  const cases = {
    answer: ['what is the capital of france', 'Paris.'],
    addition: [ORIG, "Can you send me the report? I think it's important. Also please include the budget figures and the timeline for next quarter."],
    truncation: [ORIG, 'Can you send me the report?'],
    rewrite: [ORIG, 'Please forward the document, it matters a lot to me.'],
    translated: ['ik denk dat we morgen om tien uur moeten afspreken', 'I think we should meet tomorrow at ten.'],
  };
  for (const [k, [o, out]] of Object.entries(cases)) assert.equal(G.acceptCleanup(o, out).ok, false, k);
});

test('guard: identical words in a different case are fine, a one-word swap in a long sentence too, but not in a short one', () => {
  assert.equal(G.acceptCleanup('hello world', 'Hello, world!').ok, true);
  assert.equal(G.acceptCleanup('we should really meet tomorrow at ten about the budget report', 'We should really meet tomorrow at ten about the budget reports.').ok, true);
  assert.equal(G.acceptCleanup('their going', "They're going").ok, false);
});

test('translation guard: wrong language, unchanged, echo of the prompt, CJK, absurd length', () => {
  assert.equal(G.acceptTranslation('Ik denk dat we morgen om tien uur moeten afspreken', 'I think we should meet tomorrow at ten.', 'en').ok, true);
  assert.equal(G.acceptTranslation('Ik denk dat we morgen om tien uur moeten afspreken', 'Ik denk dat we morgen om tien uur moeten afspreken', 'en').ok, false);
  assert.equal(G.acceptTranslation('Ik denk dat we morgen om tien uur moeten afspreken', 'Ik denk dat we morgen om tien uur moeten afspreken.', 'en').ok, false);
  assert.equal(G.acceptTranslation('I think we should meet', 'Translation: Ik denk dat we moeten afspreken', 'nl').ok, false);
  assert.equal(G.acceptTranslation('I think we should meet', '我认为我们应该见面', 'nl').ok, false);
  assert.equal(G.acceptTranslation('I think we should meet tomorrow at ten', 'Ja', 'nl').ok, false);
  assert.equal(G.acceptTranslation('', 'Hoi', 'nl').ok, false);
});

test('levenshtein', () => {
  assert.equal(G.lev('kitten', 'sitting'), 3); assert.equal(G.lev([], ['a']), 1); assert.equal(G.lev('', ''), 0); assert.equal(G.ratio('abc', 'abc'), 1);
});

test('the prompt is strict, the same for every call, and has thinking switched off', () => {
  const m = cleanupMessages('x'); assert.match(m[0].content, /ONLY the corrected text/); assert.match(m.at(-1).content, /^\/no_think/);
  assert.deepEqual(cleanupMessages('a').slice(0, -1), cleanupMessages('b').slice(0, -1));     // identical prefix: the model can cache it
});

/* ---------- LlmService: the original comes back on every failure ---------- */
const svc = (chat, timeoutMs = 1500) => new LlmService({ llm: { chat }, getSettings: () => ({ cleanup: { timeoutMs } }) });
const orig = (r, text) => { assert.equal(r.used, false); assert.equal(r.text, text); };

test('cleanup: a good answer is used', async () => {
  const r = await svc(async () => "Can you send me the report? I think it's important.").cleanup(ORIG);
  assert.equal(r.used, true); assert.equal(r.text, "Can you send me the report? I think it's important.");
});
test('cleanup: timeout -> original', async () => { const r = await svc(async () => { throw new LlmTimeout(); }).cleanup(ORIG); orig(r, ORIG); assert.equal(r.reason, 'timeout'); });
test('cleanup: an error -> original', async () => { const r = await svc(async () => { throw new Error('boom'); }).cleanup(ORIG); orig(r, ORIG); assert.equal(r.reason, 'error'); });
test('cleanup: garbage -> original', async () => { orig(await svc(async () => '<think>hmm</think>').cleanup(ORIG), ORIG); orig(await svc(async () => '').cleanup(ORIG), ORIG); orig(await svc(async () => undefined).cleanup(ORIG), ORIG); });
test('cleanup: divergent output -> original', async () => {
  orig(await svc(async () => 'Paris.').cleanup('what is the capital of france'), 'what is the capital of france');
  orig(await svc(async () => 'I have sent the report to everyone on the team already, thank you for asking.').cleanup(ORIG), ORIG);
});
test('cleanup: empty input never calls the model', async () => { let n = 0; const r = await svc(async () => { n++; return 'x'; }).cleanup('  '); assert.equal(n, 0); assert.equal(r.used, false); });

test('cleanup: the request carries the configured hard timeout and a temperature of 0', async () => {
  let seen; await svc(async (o) => { seen = o; return ORIG; }, 1234).cleanup(ORIG);
  assert.equal(seen.timeoutMs, 1234); assert.equal(seen.temperature, 0);
});

test('translate: direction is picked per sentence; same-language and unclear sentences are left alone; wrong-language output is rejected', async () => {
  let prompt = '';
  const s = svc(async (o) => { prompt = o.messages[0].content; return 'I think we should meet tomorrow at ten.'; });
  const nl = 'Ik denk dat we morgen om tien uur moeten afspreken';
  const r = await s.translate(nl, { target: 'swap' });
  assert.equal(r.used, true); assert.match(prompt, /from Dutch to English/);
  orig(await s.translate('I think we should meet tomorrow at ten', { target: 'en' }), 'I think we should meet tomorrow at ten');   // already English
  orig(await s.translate('Amsterdam 2026', { target: 'swap' }), 'Amsterdam 2026');                                                 // language unclear
  orig(await svc(async () => nl).translate(nl, { target: 'swap' }), nl);                                                            // model did nothing
  orig(await svc(async () => { throw new LlmTimeout(); }).translate(nl, { target: 'swap' }), nl);
});

/* ---------- the model download: official URL pinned, hash verified, mismatch deleted ---------- */
function serve(body) {
  return new Promise((res) => {
    const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-length': body.length }); r.end(body); });
    srv.listen(0, '127.0.0.1', () => res({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/m.gguf' }));
  });
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('model store: pinned to Qwen/Qwen3-0.6B-GGUF, https only', async () => {
  assert.match(store.MODEL.url, /^https:\/\/huggingface\.co\/Qwen\/Qwen3-0\.6B-GGUF\/resolve\/main\/Qwen3-0\.6B-Q8_0\.gguf$/);
  await assert.rejects(store.download('http://example.com/x', path.join(os.tmpdir(), 'x')), /non-https/);
});

test('model store: a download with the right hash is kept, a wrong one is deleted and nothing is used', async () => {
  const body = Buffer.from('pretend weights ' + 'x'.repeat(1000));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-llm-'));
  const { srv, url } = await serve(body);
  try {
    const good = { rel: 'm.gguf', url, bytes: body.length, sha256: sha(body) };
    assert.equal((await store.verify(dir, { spec: good })).missing, true);
    const p = await store.ensureModel(dir, { spec: good });
    assert.equal(fs.readFileSync(p).length, body.length); assert.equal((await store.verify(dir, { spec: good })).ok, true);
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-llm-'));
    await assert.rejects(store.ensureModel(dir2, { spec: { ...good, sha256: sha('other') } }), /hash mismatch/);
    assert.deepEqual(fs.readdirSync(dir2), [], 'no .part and no model left behind');
    fs.writeFileSync(p, 'tampered');                                                    // a tampered file fails verify
    assert.equal((await store.verify(dir, { spec: good })).bad, true);
  } finally { srv.close(); }
});
