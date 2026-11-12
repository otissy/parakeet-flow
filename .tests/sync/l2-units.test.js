'use strict';
/* The allowlist, the conflict rule, key checks, link codes. Pure functions, no network. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { root } = require('./util');
const A = require(path.join(root, 'src/sync/allowlist.js'));
const { merge, sanitizeRemote, differs, same } = require(path.join(root, 'src/sync/merge.js'));
const { checkPublicKey, checkUrl, normalizeCode, formatCode } = require(path.join(root, 'src/sync/client.js'));
const { DEFAULTS, normalize } = require(path.join(root, 'src/main/settings.js'));

const defaults = () => normalize(JSON.parse(JSON.stringify(DEFAULTS)));
const jwt = (role) => [Buffer.from('{"alg":"HS256"}').toString('base64url'), Buffer.from(JSON.stringify({ role })).toString('base64url'), 'sig'].join('.');

function leaves(o, pre = '', out = []) {
  for (const [k, v] of Object.entries(o)) {
    const p = pre ? pre + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(p === 'hotkey' || p === 'toggleKey' || p === 'notes.noteHotkey' || p === 'readAloud.hotkey' || p === 'slang.packs')) leaves(v, p, out); else out.push(p);
  }
  return out;
}

test('every setting is classified: a new setting fails here until someone decides whether it may sync', () => {
  const known = new Set([...A.SETTING_PATHS, ...Object.keys(A.LOCAL_ONLY), 'dictionary', 'slang.packs']);
  const unknown = leaves(defaults()).filter((p) => !known.has(p));
  assert.deepStrictEqual(unknown, []);
});

test('nothing is on both lists, and device or personal settings are not on the allowlist', () => {
  for (const p of A.SETTING_PATHS) assert.ok(!(p in A.LOCAL_ONLY), p);
  for (const p of ['micId', 'keepMicOpen', 'provider', 'threads', 'cleanup.threads', 'userName', 'historyEnabled', 'launchAtLogin', 'snippets', 'notes.notion.targetId', 'notes.export.folder', 'mcp.shareHistory', 'sync.enabled', 'whisper.gain']) {
    assert.ok(!A.SETTING_PATHS.includes(p), p);
    assert.equal(A.isAllowedKey(p), false, p);
  }
  for (const p of ['notes', 'notes.notion', 'secrets', 'history', 'word', 'pack:', 'pack:../x', 'pack:__proto__', '__proto__', 'constructor']) assert.equal(A.isAllowedKey(p), false, p);
});

const CANARY = 'CANARY7f3a';
function seededSettings() {
  const s = defaults();
  Object.assign(s, { micId: CANARY + 'mic', userName: CANARY + 'name', snippets: [{ trigger: 't', expansion: CANARY + 'snippet' }], deny: [CANARY + 'deny'], provider: 'cuda', threads: 7 });
  s.notes.notion.targetId = CANARY + 'notion'; s.notes.notion.titleProperty = CANARY + 'title'; s.notes.export.folder = 'C:\\' + CANARY + 'folder';
  s.whisper.gain = 7; s.cleanup.threads = 4;
  s.history = [{ text: CANARY + 'dictated' }]; s.secret = CANARY + 'secret'; s.token = CANARY + 'token';
  s.tone.apps = [{ match: 'discord', profile: 'casual' }];
  return s;
}

test('canaries in forbidden fields never reach the upload payload, and it holds allowlisted keys only', () => {
  const terms = [{ term: 'rizz', bias: 75, variants: ['riz'], secret: CANARY + 'termfield', file: CANARY + 'file', warnings: [CANARY + 'warn'] }];
  const flat = A.flatten(seededSettings(), terms);
  const keys = Object.fromEntries(Object.entries(flat).map(([k, v]) => [k, { v, t: 1, by: 'me' }]));
  keys.micId = { v: CANARY + 'smuggled', t: 1, by: 'me' };                 // even an entry that got into the state somehow
  keys['notes.notion.targetId'] = { v: CANARY + 'smuggled', t: 1, by: 'me' };
  keys['word:evil'] = { v: { term: 'evil', note: CANARY + 'smuggled' }, t: 1, by: 'me' };
  const doc = A.buildPayload(keys);
  const text = JSON.stringify(doc);
  assert.ok(!text.includes(CANARY), 'a canary reached the payload: ' + text.slice(text.indexOf(CANARY) - 60, text.indexOf(CANARY) + 40));
  for (const k of Object.keys(doc.keys)) assert.ok(A.isAllowedKey(k), k);
  assert.deepStrictEqual(Object.keys(doc).sort(), ['keys', 'schema']);
  assert.equal(doc.keys['word:rizz'].v.bias, 75, 'the word keeps its bias percent');
  assert.deepStrictEqual(doc.keys['tone.apps'].v, [{ match: 'discord', profile: 'casual' }], 'allowlisted values do go');
});

test('settingsPatch only touches the changed settings, and an unknown key changes nothing', () => {
  const s = defaults();
  const p = A.settingsPatch(s, { 'tone.enabled': false, 'pack:en-slang': false, 'dict:foo': { from: 'foo', to: 'bar' }, micId: 'x', 'notes.notion.targetId': 'y', 'word:hi': { term: 'hi' } });
  assert.deepStrictEqual(Object.keys(p).sort(), ['dictionary', 'slang', 'tone']);
  assert.equal(p.tone.enabled, false); assert.equal(p.slang.packs['en-slang'], false); assert.deepStrictEqual(p.dictionary, [{ from: 'foo', to: 'bar' }]);
  assert.deepStrictEqual(A.settingsPatch(s, { micId: 'x', userName: 'y' }), {});
  const after = normalize({ ...s, ...A.settingsPatch(s, { 'notes.triggers': ['a'] }) });
  assert.deepStrictEqual(after.notes.notion, s.notes.notion, 'a nested write keeps its siblings');
});

/* ---------- conflict rule ---------- */
const e = (v, t, by = 'a') => ({ v, t, by });

test('per key, the newer write wins, in both directions, and one key does not drag another along', () => {
  const m = merge({ local: { x: e(1, 100), y: e(1, 300) }, remote: { x: e(2, 200, 'b'), y: e(2, 200, 'b') } });
  assert.equal(m.merged.x.v, 2); assert.equal(m.merged.y.v, 1);
  assert.deepStrictEqual(Object.keys(m.toApply), ['x']);
});

test('equal times are settled by install id: both PCs pick the same winner', () => {
  const a = merge({ local: { k: e('A', 5, 'a') }, remote: { k: e('B', 5, 'b') } }).merged.k.v;
  const b = merge({ local: { k: e('B', 5, 'b') }, remote: { k: e('A', 5, 'a') } }).merged.k.v;
  assert.equal(a, b);
});

test('both sides changed: a visible conflict that carries the losing value; one side changed: no conflict', () => {
  const both = merge({ local: { k: e('mine', 100) }, remote: { k: e('theirs', 200, 'b') }, synced: { k: 50 } });
  assert.equal(both.conflicts.length, 1);
  assert.equal(both.conflicts[0].lost, 'mine'); assert.equal(both.conflicts[0].kept, 'other');
  const oneSide = merge({ local: { k: e('mine', 50) }, remote: { k: e('theirs', 200, 'b') }, synced: { k: 50 } });
  assert.equal(oneSide.conflicts.length, 0); assert.equal(oneSide.merged.k.v, 'theirs');
});

test('a default (t=0) loses to any customization and is never a conflict', () => {
  const m = merge({ local: { k: e('default', 0) }, remote: { k: e('custom', 9, 'b') } });
  assert.equal(m.merged.k.v, 'custom'); assert.equal(m.conflicts.length, 0);
  const n = merge({ local: { k: e('custom', 9) }, remote: { k: e('default', 0, 'b') } });
  assert.equal(n.merged.k.v, 'custom'); assert.deepStrictEqual(n.toApply, {});
});

test('a deletion is a write like any other; only one side having a key loses nothing', () => {
  const del = merge({ local: { 'word:a': e({ term: 'a' }, 100) }, remote: { 'word:a': e(null, 200, 'b') } });
  assert.equal(del.merged['word:a'].v, null); assert.ok('word:a' in del.toApply);
  const old = merge({ local: { 'word:a': e({ term: 'a' }, 300) }, remote: { 'word:a': e(null, 200, 'b') } });
  assert.deepStrictEqual(old.merged['word:a'].v, { term: 'a' });
  const u = merge({ local: { only: e(1, 1) }, remote: { other: e(2, 2, 'b') } });
  assert.equal(u.merged.only.v, 1); assert.equal(u.merged.other.v, 2);
});

test('the same value with keys in another order is not a difference (jsonb sorts keys)', () => {
  assert.ok(same({ a: 1, b: [{ c: 1, d: 2 }] }, { b: [{ d: 2, c: 1 }], a: 1 }));
  assert.ok(!differs({ k: e({ a: 1, b: 2 }, 1) }, { k: e({ b: 2, a: 1 }, 1) }));
  assert.ok(differs({ k: e(1, 1) }, {}));
  assert.ok(differs({ k: e(1, 2) }, { k: e(1, 1) }));
});

test('what comes from the server is filtered too: a linked install cannot set a forbidden key or stay in the future', () => {
  const now = 1000000;
  const r = sanitizeRemote({ schema: 1, keys: {
    micId: e('x', 5), 'notes.notion.targetId': e('x', 5), 'tone.enabled': e(false, 5), 'liveMode': e('stable', now + 99999999),
    'word:a': e({ term: 'a', evil: 'x', bias: 10 }, 5), 'word:b': e('notobject', 5), trailingSpace: { v: true, t: 'soon' }, fillers: { t: 5 },
  } }, now);
  assert.deepStrictEqual(Object.keys(r).sort(), ['liveMode', 'tone.enabled', 'word:a'].sort());
  assert.equal(r.liveMode.t, now);
  assert.deepStrictEqual(r['word:a'].v, { term: 'a', bias: 10 });
  assert.deepStrictEqual(sanitizeRemote({ schema: 2, keys: { 'tone.enabled': e(1, 1) } }), {});
  assert.deepStrictEqual(sanitizeRemote(null), {});
  assert.deepStrictEqual(sanitizeRemote('garbage'), {});
});

/* ---------- keys, URLs, codes (same rules as parakeet-check) ---------- */
test('only public keys are accepted: secret and service-role keys are refused', () => {
  assert.equal(checkPublicKey('sb_publishable_abc'), '');
  assert.equal(checkPublicKey(jwt('anon')), '');
  assert.match(checkPublicKey('sb_secret_abc'), /SECRET/);
  assert.match(checkPublicKey(jwt('service_role')), /SERVICE ROLE/);
  assert.notEqual(checkPublicKey(jwt('other')), '');
  assert.notEqual(checkPublicKey('hello'), '');
  assert.notEqual(checkPublicKey(''), '');
  assert.notEqual(checkPublicKey('a.b.c'), '');
});

test('the project URL must be https, or a dev server on this PC', () => {
  assert.equal(checkUrl('https://x.supabase.co/').url, 'https://x.supabase.co');
  assert.equal(checkUrl('https://x.supabase.co/rest/v1').url, 'https://x.supabase.co');
  assert.equal(checkUrl('http://127.0.0.1:54321').url, 'http://127.0.0.1:54321');
  for (const bad of ['http://x.supabase.co', 'http://127.0.0.1.evil.com', 'http://localhost.evil.com', 'file:///c:/x', 'nonsense', '', 'https://user:pw@x.co']) assert.ok(checkUrl(bad).error, bad);
});

test('link codes: normalized, formatted, look-alikes refused', () => {
  assert.equal(normalizeCode('abc-234'), 'ABC234');
  assert.equal(normalizeCode(' ABC 234 '), 'ABC234');
  assert.equal(formatCode('ABC234'), 'ABC-234');
  for (const bad of ['ABC23', 'ABC2345', 'ABC10O', 'ABCDEI', '', null]) assert.equal(normalizeCode(bad), '', String(bad));
});
