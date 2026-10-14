'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { Outbox, backoffMs } = require(path.join(root, 'src/notes/outbox.js'));
const N = require(path.join(root, 'src/notes/notion.js'));
const { SecretStore } = require(path.join(root, 'src/main/secret.js'));
const { startMock } = require('./mock-notion.js');
const { normalize } = require(path.join(root, 'src/main/settings.js'));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-notes-'));
const TOKEN = 'secret_TESTTOKEN0123456789abcdefghijklmnopqrstuvw';

/* ---------- outbox ---------- */
test('outbox: one JSON line per note with timestamp, text and sync state', () => {
  const f = path.join(tmp(), 'notes.jsonl'); let t = 1700000000000;
  const o = new Outbox(f, { now: () => t, genId: (() => { let i = 0; return () => 'id' + ++i; })() });
  const a = o.add('Buy oat milk'); t += 1000; const b = o.add('  Bel de tandarts  ', { sync: 'pending' });
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { id: 'id1', ts: 1700000000000, text: 'Buy oat milk', tags: [], source: 'dictation', sync: 'local', attempts: 0, nextAt: 0 });
  assert.equal(lines[1].text, 'Bel de tandarts'); assert.equal(lines[1].sync, 'pending'); assert.equal(lines[1].ts, 1700000001000);
  assert.equal(o.add('   '), null); assert.equal(o.add(''), null);
  assert.deepEqual(o.list().map((n) => n.id), ['id2', 'id1'], 'newest first');
});

test('outbox: survives a restart and a torn last line; unicode and newlines survive', () => {
  const f = path.join(tmp(), 'notes.jsonl');
  const o = new Outbox(f); o.add('één regel\nen nog een \u{1F99C}');
  fs.appendFileSync(f, '{"id":"torn","ts":1,"te');                                   // a crash mid-write
  const again = new Outbox(f);
  assert.equal(again.notes.length, 1); assert.equal(again.notes[0].text, 'één regel\nen nog een \u{1F99C}');
});

test('outbox: failure schedules the retry with backoff 30 s, 1 min, 2 min ... capped at 1 h; Retry-After can only lengthen it', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(backoffMs), [30000, 60000, 120000, 240000, 480000]);
  assert.equal(backoffMs(20), 3600000);
  const f = path.join(tmp(), 'notes.jsonl'); let t = 1000;
  const o = new Outbox(f, { now: () => t }); const n = o.add('x', { sync: 'pending' });
  assert.equal(o.due().length, 1);
  o.markFailed(n.id, 'HTTP 500'); assert.equal(o.get(n.id).sync, 'failed'); assert.equal(o.get(n.id).nextAt, 1000 + 30000); assert.equal(o.due().length, 0);
  t = 31001; assert.equal(o.due().length, 1);
  o.markFailed(n.id, 'HTTP 429', { retryAfterMs: 600000 }); assert.equal(o.get(n.id).attempts, 2); assert.equal(o.get(n.id).nextAt, 31001 + 600000);
  o.markSynced(n.id, 'page-1'); assert.equal(o.get(n.id).sync, 'synced'); assert.equal(o.get(n.id).error, undefined); assert.equal(o.due(1e12).length, 0);
  assert.equal(new Outbox(f).get(n.id).pageId, 'page-1', 'state persisted');
});

test('outbox: resend resets the backoff and queues it now; remove deletes', () => {
  const o = new Outbox(path.join(tmp(), 'notes.jsonl'), { now: () => 5 }); const n = o.add('x'); o.markFailed(n.id, 'e'); o.markFailed(n.id, 'e');
  o.resend(n.id); assert.equal(o.get(n.id).sync, 'pending'); assert.equal(o.get(n.id).attempts, 0); assert.equal(o.due().length, 1);
  assert.equal(o.remove(n.id), true); assert.equal(o.remove(n.id), false); assert.equal(o.notes.length, 0);
});

/* ---------- the Notion payload ---------- */
test('payload: database parent with the title property, paragraph body, long text chunked', () => {
  const b = N.buildPageBody({ text: 'Buy oat milk\nand bread' }, { targetType: 'database', targetId: 'abc123', titleProperty: 'Task' });
  assert.deepEqual(b.parent, { database_id: 'abc123' });
  assert.deepEqual(b.properties, { Task: { title: [{ type: 'text', text: { content: 'Buy oat milk' } }] } });
  assert.equal(b.children[0].paragraph.rich_text[0].text.content, 'Buy oat milk\nand bread');
  const long = N.buildPageBody({ text: 'a'.repeat(4500) }, { targetId: 'x' });
  assert.equal(long.children.length, 3); assert.ok(long.children.every((c) => c.paragraph.rich_text[0].text.content.length <= 2000));
  const title = long.properties.Name.title[0].text.content; assert.ok(title.length <= 100);
});

test('payload: page parent uses the "title" property; empty first line gets a fallback title', () => {
  const b = N.buildPageBody({ text: '\nsecond line only' }, { targetType: 'page', targetId: 'pg1' });
  assert.deepEqual(b.parent, { page_id: 'pg1' }); assert.ok(b.properties.title); assert.equal(b.properties.title.title[0].text.content, 'Note');
});

test('base URL: always the real Notion API unless a loopback http URL is given (tests only)', () => {
  assert.equal(N.resolveBase(), 'https://api.notion.com');
  assert.equal(N.resolveBase('https://evil.example.com'), 'https://api.notion.com');
  assert.equal(N.resolveBase('http://evil.example.com:80'), 'https://api.notion.com');
  assert.equal(N.resolveBase('http://127.0.0.1:5555/x'), 'http://127.0.0.1:5555');
});

/* ---------- the request, against the mock ---------- */
test('createPage: POST /v1/pages with bearer token, Notion-Version and a JSON body', async () => {
  const m = await startMock();
  try {
    const body = N.buildPageBody({ text: 'Hello' }, { targetId: 'db1' });
    const r = await N.createPage({ token: TOKEN, body, base: m.base });
    assert.equal(r.ok, true); assert.equal(r.id, 'page-1');
    const q = m.reqs[0];
    assert.equal(q.method, 'POST'); assert.equal(q.url, '/v1/pages');
    assert.equal(q.headers.authorization, 'Bearer ' + TOKEN); assert.equal(q.headers['notion-version'], '2022-06-28'); assert.match(q.headers['content-type'], /application\/json/);
    assert.deepEqual(q.json, body);
  } finally { await m.close(); }
});

test('createPage: 429 with Retry-After, 401, 400 and a dead server all fail cleanly, and no outcome contains the token', async () => {
  const cases = [{ status: 429, headers: { 'retry-after': '90' }, code: 'rate_limited', message: 'slow down ' + TOKEN }, { status: 401, code: 'unauthorized', message: 'API token is invalid.' },
    { status: 400, code: 'validation_error', message: 'Name is not a property that exists.' }];
  let i = 0; const m = await startMock(() => cases[i++]);
  try {
    const body = N.buildPageBody({ text: 'Hello' }, { targetId: 'db1' });
    const outs = [];
    for (let k = 0; k < 3; k++) outs.push(await N.createPage({ token: TOKEN, body, base: m.base }));
    assert.deepEqual(outs.map((o) => o.status), [429, 401, 400]); assert.ok(outs.every((o) => !o.ok));
    assert.equal(outs[0].retryAfterMs, 90000);
    assert.match(outs[2].error, /validation_error/);
    assert.ok(!JSON.stringify(outs).includes(TOKEN), 'the token is redacted from error text'); assert.ok(!JSON.stringify(outs).includes('TESTTOKEN'));
  } finally { await m.close(); }
  const dead = await N.createPage({ token: TOKEN, body: {}, base: 'http://127.0.0.1:1' });
  assert.equal(dead.ok, false); assert.equal(dead.status, 0); assert.ok(!JSON.stringify(dead).includes(TOKEN));
});

/* ---------- the token store ---------- */
const fakeSS = (available = true) => ({ isEncryptionAvailable: () => available, encryptString: (s) => Buffer.from('ENC:' + Buffer.from(s).reverse().toString('hex')), decryptString: (b) => Buffer.from(b.toString().slice(4), 'hex').reverse().toString() });

test('secret store: encrypted at rest, round trip, never in clear, cleared on request', () => {
  const f = path.join(tmp(), 'secrets.json'); const s = new SecretStore(f, fakeSS());
  assert.equal(s.has('notion'), false);
  s.set('notion', TOKEN);
  assert.equal(s.has('notion'), true); assert.equal(s.get('notion'), TOKEN);
  const disk = fs.readFileSync(f, 'utf8');
  assert.ok(!disk.includes(TOKEN) && !disk.includes('TESTTOKEN'), 'not stored in clear');
  assert.ok(!disk.includes(Buffer.from(TOKEN).toString('base64')), 'not just base64 either');
  s.clear('notion'); assert.equal(s.has('notion'), false); assert.equal(s.get('notion'), '');
});

test('secret store: without OS encryption the token is refused, not stored in clear', () => {
  const f = path.join(tmp(), 'secrets.json'); const s = new SecretStore(f, fakeSS(false));
  assert.throws(() => s.set('notion', TOKEN), /not available/);
  assert.equal(fs.existsSync(f), false);
  assert.equal(new SecretStore(f, null).available(), false);
});

test('settings: the Notion section holds no token field; the id accepts a pasted link', () => {
  const s = normalize({ notes: { notion: { enabled: true, token: TOKEN, targetId: 'https://www.notion.so/Inbox-0123456789abcdef0123456789abcdef' } } });
  assert.equal(s.notes.notion.targetId, '0123456789abcdef0123456789abcdef'); assert.ok(!JSON.stringify(s).includes('TESTTOKEN'));
});
