'use strict';
/* Outbox + NotionSync + SecretStore + settings working together, against a local mock of the Notion API. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { Outbox } = require(path.join(root, 'src/notes/outbox.js'));
const { NotionSync } = require(path.join(root, 'src/notes/notion.js'));
const { startMock } = require('./mock-notion.js');

const TOKEN = 'ntn_MODULETOKEN0123456789abcdefghijklmnopqrstu';
async function rig({ handler, cfg = {}, token = TOKEN } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-notes3-'));
  const clock = { t: 1700000000000 };
  const outbox = new Outbox(path.join(dir, 'notes.jsonl'), { now: () => clock.t });
  const m = await startMock(handler);
  const config = { enabled: true, targetType: 'database', targetId: 'db123', titleProperty: 'Name', ...cfg };
  const state = { token };
  const sync = new NotionSync({ outbox, base: m.base, now: () => clock.t, getConfig: () => config, getToken: () => state.token });
  return { dir, clock, outbox, m, config, state, sync, file: path.join(dir, 'notes.jsonl') };
}

test('happy path: a new note is POSTed once and marked synced with the page id', async () => {
  const r = await rig();
  try {
    const n = r.outbox.add('Buy oat milk', { sync: 'pending' });
    await r.sync.submit(n.id);
    assert.equal(r.m.reqs.length, 1); assert.equal(r.m.reqs[0].json.properties.Name.title[0].text.content, 'Buy oat milk');
    assert.equal(r.outbox.get(n.id).sync, 'synced'); assert.equal(r.outbox.get(n.id).pageId, 'page-1');
    await r.sync.runDue(); assert.equal(r.m.reqs.length, 1, 'a synced note is never sent again');
  } finally { await r.m.close(); }
});

test('failure stays in the outbox and retries with backoff; nothing is sent before the retry time', async () => {
  let mode = 'down';
  const r = await rig({ handler: () => (mode === 'down' ? { status: 500, code: 'internal_server_error', message: 'try later' } : {}) });
  try {
    const n = r.outbox.add('Call the bank', { sync: 'pending' });
    await r.sync.submit(n.id);
    let x = r.outbox.get(n.id); assert.equal(x.sync, 'failed'); assert.equal(x.attempts, 1); assert.equal(x.nextAt, r.clock.t + 30000); assert.match(x.error, /500/);
    r.clock.t += 10000; await r.sync.runDue(); assert.equal(r.m.reqs.length, 1, 'too early');
    r.clock.t += 21000; await r.sync.runDue();                                   // 31 s: second attempt, fails again
    x = r.outbox.get(n.id); assert.equal(r.m.reqs.length, 2); assert.equal(x.attempts, 2); assert.equal(x.nextAt, r.clock.t + 60000, 'backoff doubles');
    mode = 'up'; r.clock.t += 61000; await r.sync.runDue();
    assert.equal(r.outbox.get(n.id).sync, 'synced'); assert.equal(r.m.reqs.length, 3);
    assert.ok(fs.readFileSync(r.file, 'utf8').includes('"sync":"synced"'), 'persisted');
  } finally { await r.m.close(); }
});

test('429: Retry-After is respected; 401 keeps the note and shows the error; a dead server is a failure too', async () => {
  const seq = [{ status: 429, headers: { 'retry-after': '600' }, code: 'rate_limited' }, { status: 401, code: 'unauthorized', message: 'API token is invalid.' }];
  let i = 0; const r = await rig({ handler: () => seq[i++] });
  try {
    const a = r.outbox.add('one', { sync: 'pending' }); await r.sync.submit(a.id);
    assert.ok(r.outbox.get(a.id).nextAt >= r.clock.t + 600000);
    const b = r.outbox.add('two', { sync: 'pending' }); await r.sync.submit(b.id);
    assert.match(r.outbox.get(b.id).error, /401 unauthorized/); assert.equal(r.outbox.get(b.id).sync, 'failed');
  } finally { await r.m.close(); }
  const d = await rig(); await d.m.close();                                   // server gone
  const n = d.outbox.add('x', { sync: 'pending' }); await d.sync.submit(n.id);
  assert.equal(d.outbox.get(n.id).sync, 'failed'); assert.match(d.outbox.get(n.id).error, /network/);
});

test('one failing note does not block the next; they go out oldest first', async () => {
  let n = 0; const r = await rig({ handler: () => (++n === 1 ? { status: 500 } : {}) });
  try {
    const a = r.outbox.add('first', { sync: 'pending' }); r.clock.t += 1; const b = r.outbox.add('second', { sync: 'pending' }); r.clock.t += 1; const c = r.outbox.add('third', { sync: 'pending' });
    await r.sync.runDue();
    assert.deepEqual(r.m.reqs.map((q) => q.json.properties.Name.title[0].text.content), ['first', 'second', 'third']);
    assert.deepEqual([a, b, c].map((x) => r.outbox.get(x.id).sync), ['failed', 'synced', 'synced']);
  } finally { await r.m.close(); }
});

test('Resend: tries again right now, even before the backoff time', async () => {
  let ok = false; const r = await rig({ handler: () => (ok ? {} : { status: 503 }) });
  try {
    const a = r.outbox.add('later', { sync: 'pending' }); await r.sync.submit(a.id);
    assert.equal(r.outbox.get(a.id).sync, 'failed');
    ok = true; const res = await r.sync.resend(a.id);
    assert.equal(res.ok, true); assert.equal(r.outbox.get(a.id).sync, 'synced'); assert.equal(r.m.reqs.length, 2);
  } finally { await r.m.close(); }
});

test('sync not configured (off, no token, no target): notes stay local and nothing is sent; once configured, Resend sends them', async () => {
  const r = await rig({ cfg: { enabled: false } });
  try {
    const a = r.outbox.add('kept locally'); await r.sync.submit(a.id); await r.sync.runDue();
    assert.equal(r.m.reqs.length, 0); assert.equal(r.outbox.get(a.id).sync, 'local');
    r.config.enabled = true; r.state.token = ''; assert.equal(r.sync.ready(), false); await r.sync.runDue(); assert.equal(r.m.reqs.length, 0);
    r.state.token = TOKEN; r.config.targetId = ''; assert.equal(r.sync.ready(), false);
    r.config.targetId = 'db123'; assert.equal(r.sync.ready(), true);
    assert.equal(await r.sync.runDue(), 0, 'local notes are not swept up automatically');
    await r.sync.resend(a.id); assert.equal(r.outbox.get(a.id).sync, 'synced');
  } finally { await r.m.close(); }
});

test('the token is only ever in the Authorization header: not in the outbox file, the errors or the page body', async () => {
  const r = await rig({ handler: (q, k) => (k === 1 ? { status: 400, message: 'bad ' + TOKEN } : {}) });
  try {
    const a = r.outbox.add('secretless note', { sync: 'pending' }); await r.sync.submit(a.id);
    await r.sync.resend(a.id);
    const disk = fs.readFileSync(r.file, 'utf8');
    assert.ok(!disk.includes('MODULETOKEN') && !disk.includes(TOKEN));
    for (const q of r.m.reqs) { assert.ok(!q.body.includes('MODULETOKEN')); assert.equal(q.headers.authorization, 'Bearer ' + TOKEN); }
  } finally { await r.m.close(); }
});

test('runDue is re-entrancy safe: two overlapping sweeps send each note once', async () => {
  const r = await rig({ handler: () => ({}) });
  try {
    r.outbox.add('a', { sync: 'pending' }); r.outbox.add('b', { sync: 'pending' });
    await Promise.all([r.sync.runDue(), r.sync.runDue(), r.sync.runDue()]);
    assert.equal(r.m.reqs.length, 2);
  } finally { await r.m.close(); }
});

test('page target: the child-page payload reaches the API', async () => {
  const r = await rig({ cfg: { targetType: 'page', targetId: 'pg9' } });
  try { const a = r.outbox.add('into a page', { sync: 'pending' }); await r.sync.submit(a.id); assert.deepEqual(r.m.reqs[0].json.parent, { page_id: 'pg9' }); assert.ok(r.m.reqs[0].json.properties.title); }
  finally { await r.m.close(); }
});
