'use strict';
/* Against a REAL Supabase project, with the real client and service (Node's fetch, real Row Level Security). Skipped unless
   PF_SYNC_TEST_URL and PF_SYNC_TEST_KEY are set: the repo holds no database address. Creates throw-away anonymous installs; their ids
   are written to PF_SYNC_TEST_IDS (a file) so whoever runs this can remove them afterwards (docs/sync-setup.md). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { makeInstall } = require('./util');

const url = process.env.PF_SYNC_TEST_URL, key = process.env.PF_SYNC_TEST_KEY;
const opts = { skip: url && key ? false : 'set PF_SYNC_TEST_URL and PF_SYNC_TEST_KEY to run against a real project' };
const created = [];
const remember = (i) => { const id = i.sync.status().installId; if (id && !created.includes(id)) created.push(id); if (process.env.PF_SYNC_TEST_IDS) fs.writeFileSync(process.env.PF_SYNC_TEST_IDS, created.join('\n')); };
const install = async () => { const i = makeInstall({ url, key, enabled: true }); const ok = await i.sync.syncNow(); remember(i); assert.equal(ok, true, i.sync.status().lastError); i.sync.stop(); return i; };
const client = (i) => i.sync._client();
const ok = async (i) => { const r = await i.sync.syncNow(); i.sync.stop(); assert.equal(r, true, i.sync.status().lastError); };

let A, B, C, groupRowId;

test('three anonymous installs each get their own ID and their own private row', opts, async () => {
  A = await install(); B = await install(); C = await install();
  const ids = [A, B, C].map((i) => i.sync.status().installId);
  assert.equal(new Set(ids).size, 3);
  for (const id of ids) assert.match(id, /^[0-9a-f-]{36}$/);
  const rowsOfC = await client(C).rest('GET', 'customization?select=id,install_id,group_id');
  assert.deepStrictEqual(rowsOfC.map((r) => r.install_id), [ids[2]], 'C sees only its own row, nobody else\'s');
});

test('link: a code from A joins B; a code is single use and A cannot use its own', opts, async () => {
  A.slang.addTerm({ term: 'Zorptastic', bias: 75, variants: ['zorp tastic'] });
  await ok(A);
  const code = await A.sync.createCode();
  assert.equal(code.ok, true, code.error);
  assert.match(code.code, /^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  assert.match((await A.sync.join(code.code)).error, /own code/);
  const j = await B.sync.join(code.code);
  assert.equal(j.ok, true, j.error);
  B.sync.stop();
  assert.match((await C.sync.join(code.code)).error, /invalid, used or expired/);
  await ok(A); await ok(B);
  assert.equal(B.sync.status().linked, true);
  assert.deepStrictEqual(B.sync.status().members.map((m) => m.id).sort(), [A, B].map((i) => i.sync.status().installId).sort());
});

test('a word with its bias syncs from A to B, and only customization is in the row', opts, async () => {
  const t = B.slang.mineTerms().find((x) => x.term === 'Zorptastic');
  assert.ok(t, 'the word reached B');
  assert.equal(t.bias, 75);
  const rows = await client(B).rest('GET', 'customization?select=id,group_id,doc,version,updated_by&group_id=not.is.null');
  assert.equal(rows.length, 1);
  groupRowId = rows[0].id;
  for (const k of Object.keys(rows[0].doc.keys)) assert.ok(!/^(micId|userName|snippets|provider|threads|historyEnabled|deny)/.test(k), k);
  assert.ok(rows[0].version >= 1);
  assert.ok([A, B].map((i) => i.sync.status().installId).includes(rows[0].updated_by), 'the database stamps the writer');
});

test('a third, unlinked install cannot read or change the group row, even by asking for it directly', opts, async () => {
  const c = client(C);
  assert.deepStrictEqual(await c.rest('GET', `customization?select=id&id=eq.${groupRowId}`), []);
  const patched = await c.rest('PATCH', `customization?id=eq.${groupRowId}`, { body: { doc: { schema: 1, keys: {} } }, prefer: 'return=representation' });
  assert.deepStrictEqual(patched, [], 'RLS hides the row from an update');
  const group = (await client(A).rest('GET', `customization?select=group_id&id=eq.${groupRowId}`))[0].group_id;
  await assert.rejects(c.rest('POST', 'customization', { body: { group_id: group, doc: {} }, prefer: 'return=representation' }), /row-level security|403|409|duplicate/i);
  assert.deepStrictEqual(await c.rest('GET', `group_members?select=install_id&group_id=eq.${group}`), []);
  await ok(C);
  assert.ok(!C.slang.mineTerms().some((x) => x.term === 'Zorptastic'), 'and syncing brings C nothing');
});

test('no sign-in, no access: the public key alone reads nothing and writes nothing', opts, async () => {
  const anon = { apikey: key, 'Content-Type': 'application/json' };
  const r = await fetch(`${url}/rest/v1/customization?select=id`, { headers: anon });
  assert.ok(r.status === 401 || r.status === 403, 'read: ' + r.status);
  const w = await fetch(`${url}/rest/v1/customization`, { method: 'POST', headers: anon, body: JSON.stringify({ doc: {} }) });
  assert.ok(w.status === 401 || w.status === 403, 'write: ' + w.status);
});

test('a client cannot fake the version or the writer, or delete the row', opts, async () => {
  const a = client(A);
  await assert.rejects(a.rest('PATCH', `customization?id=eq.${groupRowId}`, { body: { version: 999 } }), /permission|403|401/i);
  await assert.rejects(a.rest('PATCH', `customization?id=eq.${groupRowId}`, { body: { updated_by: B.sync.status().installId } }), /permission|403|401/i);
  await assert.rejects(a.rest('DELETE', `customization?id=eq.${groupRowId}`), /permission|403|401/i);
});

test('optimistic write: an update with an old version changes nothing', opts, async () => {
  const a = client(A);
  const [row] = await a.rest('GET', `customization?select=id,version,doc&id=eq.${groupRowId}`);
  const stale = await a.rest('PATCH', `customization?id=eq.${groupRowId}&version=eq.${row.version - 1}`, { body: { doc: { schema: 1, keys: {} } }, prefer: 'return=representation' });
  assert.deepStrictEqual(stale, []);
  const [same] = await a.rest('GET', `customization?select=version,doc&id=eq.${groupRowId}`);
  assert.equal(same.version, row.version);
  assert.ok(Object.keys(same.doc.keys).length > 0);
});

test('a document over the size limit is refused by the database', opts, async () => {
  const c = client(C);
  const big = { schema: 1, keys: { fillers: { v: 'x'.repeat(2200000), t: 1, by: 'x' } } };
  const id = C.sync.status().installId;
  await assert.rejects(c.rest('PATCH', `customization?install_id=eq.${id}`, { body: { doc: big } }), /check|400|413/i);
});

test('unlink: B keeps its words, loses access to the group row, and later edits do not reach it', opts, async () => {
  assert.equal((await B.sync.unlink()).ok, true);
  B.sync.stop();
  assert.equal(B.sync.status().linked, false);
  assert.ok(B.slang.mineTerms().some((x) => x.term === 'Zorptastic'), 'kept locally');
  assert.deepStrictEqual(await client(B).rest('GET', `customization?select=id&id=eq.${groupRowId}`), []);
  A.slang.addTerm({ term: 'Afterwords' });
  await ok(A); await ok(B);
  assert.ok(!B.slang.mineTerms().some((x) => x.term === 'Afterwords'));
  assert.deepStrictEqual(A.sync.status().members.map((m) => m.isMe), [true], 'the group of one is gone');
});
