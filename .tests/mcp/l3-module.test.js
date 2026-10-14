'use strict';
/* every MCP tool through the SDK's in-memory client/server transport; malformed input; privacy */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { connect, call, writeStatus } = require('./util');

const PRIVATE_TEXT = 'PRIVATE dictated sentence 7f3a';

test('tools/list: exactly the documented tools, recent_dictation hidden while sharing is off, every tool annotated', async () => {
  const c = await connect();
  const { tools } = await c.client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['dictation_status', 'note_get', 'note_mark_synced', 'notes_add', 'notes_list']);
  for (const t of tools) { assert.ok(t.annotations && typeof t.annotations.readOnlyHint === 'boolean', t.name); assert.ok(t.inputSchema.type === 'object'); }
  await c.close();
});

test('notes_add then notes_list / note_get: pending first, text, tags and source survive (Dutch accents too)', async () => {
  const c = await connect();
  const add = await call(c.client, 'notes_add', { text: 'Bel de huisarts over mijn knie \u00e9\u00e9n keer', tags: ['Health', 'todo'] });
  assert.equal(add.isError, false); const id = add.json.note.id;
  assert.equal(add.json.note.source, 'mcp'); assert.deepEqual(add.json.note.tags, ['health', 'todo']); assert.equal(add.json.note.status, 'pending');
  const list = await call(c.client, 'notes_list', {});
  assert.equal(list.json.total, 1); assert.equal(list.json.notes[0].text, 'Bel de huisarts over mijn knie \u00e9\u00e9n keer');
  const get = await call(c.client, 'note_get', { id });
  assert.equal(get.json.note.id, id);
  assert.equal((await call(c.client, 'notes_list', { status: 'synced' })).json.total, 0);
  await c.close();
});

test('notes_list: status filter, limit, order and the total', async () => {
  const c = await connect();
  const ids = []; for (let i = 0; i < 5; i++) { ids.push((await call(c.client, 'notes_add', { text: 'n' + i })).json.note.id); await new Promise((r) => setTimeout(r, 3)); }
  await call(c.client, 'note_mark_synced', { id: ids[0], destination: 'Notion: Notes' });
  assert.equal((await call(c.client, 'notes_list', { status: 'pending' })).json.total, 4);
  assert.equal((await call(c.client, 'notes_list', { status: 'synced' })).json.total, 1);
  const all = await call(c.client, 'notes_list', { status: 'all', limit: 2 });
  assert.equal(all.json.returned, 2); assert.equal(all.json.total, 5); assert.equal(all.json.truncated, true);
  assert.equal(all.json.notes[0].text, 'n4', 'newest first by default');
  assert.equal((await call(c.client, 'notes_list', { status: 'all', order: 'oldest', limit: 1 })).json.notes[0].text, 'n0');
  await c.close();
});

test('note_mark_synced: records destination and url, is idempotent, and the APP side sees it (shared file)', async () => {
  const c = await connect();
  const id = (await call(c.client, 'notes_add', { text: 'file me' })).json.note.id;
  const m = await call(c.client, 'note_mark_synced', { id, destination: 'Notion: Notes database', url: 'https://www.notion.so/page-123' });
  assert.equal(m.json.note.status, 'synced'); assert.equal(m.json.note.destination, 'Notion: Notes database'); assert.equal(m.json.note.url, 'https://www.notion.so/page-123');
  await call(c.client, 'note_mark_synced', { id, destination: 'Notion: Notes database', url: 'https://www.notion.so/page-123' });
  const app = new (require('./util').Outbox)(path.join(c.dataDir, 'notes.jsonl'));
  assert.equal(app.get(id).sync, 'synced'); assert.equal(app.get(id).destination, 'Notion: Notes database');
  // and the other direction: the app adds a note, the server sees it without a restart
  const n = app.add('added by the app');
  assert.equal((await call(c.client, 'note_get', { id: n.id })).json.note.text, 'added by the app');
  await c.close();
});

test('the public note never carries retry bookkeeping, error strings or Notion page ids', async () => {
  const c = await connect();
  const n = c.outbox.add('x'); c.outbox.markFailed(n.id, 'HTTP 401 ERRTEXT-1'); c.outbox.markSynced(n.id, 'page-id-123');
  const j = (await call(c.client, 'note_get', { id: n.id })).json.note;
  for (const k of ['attempts', 'nextAt', 'error', 'pageId', 'sync']) assert.ok(!(k in j), k);
  assert.ok(!JSON.stringify(j).includes('ERRTEXT-1') && !JSON.stringify(j).includes('page-id-123'));
  await c.close();
});

test('dictation_status: running / engine / hotkeys / counts, and NO dictated text anywhere in it', async () => {
  const c = await connect();
  await call(c.client, 'notes_add', { text: PRIVATE_TEXT });
  let s = await call(c.client, 'dictation_status');
  assert.equal(s.json.running, false); assert.equal(s.json.engine, 'unknown');
  writeStatus(c.dataDir, { engine: 'ready', hotkeys: { dictation: 'Ctrl+Space', note: 'Ctrl+Shift+Space' }, shareHistory: false, recent: [{ ts: 1, text: PRIVATE_TEXT }] });
  s = await call(c.client, 'dictation_status');
  assert.equal(s.json.running, true); assert.equal(s.json.engine, 'ready'); assert.equal(s.json.hotkeys.note, 'Ctrl+Shift+Space');
  assert.deepEqual(s.json.notes, { pending: 1, synced: 0, total: 1 });
  assert.ok(!s.text.includes('PRIVATE') && !s.text.includes('7f3a'), 'status holds no text');
  await c.close();
});

test('recent_dictation: refused while sharing is off, served once the user switches it on, refused again when switched off', async () => {
  const c = await connect();
  writeStatus(c.dataDir, { engine: 'ready', shareHistory: false, recent: [{ ts: 1, text: PRIVATE_TEXT }] });
  const off = await call(c.client, 'recent_dictation', {});
  assert.equal(off.isError, true); assert.ok(!off.text.includes('PRIVATE'));
  writeStatus(c.dataDir, { engine: 'ready', shareHistory: true, recent: [{ ts: 2000, text: 'newest' }, { ts: 1000, text: 'older' }] });
  await new Promise((r) => setTimeout(r, 200));                         // the server polls the status file (40 ms here, 3 s in the app) and tells the client the list changed
  assert.ok((await c.client.listTools()).tools.some((t) => t.name === 'recent_dictation'));
  const on = await call(c.client, 'recent_dictation', { limit: 1 });
  assert.equal(on.isError, false); assert.deepEqual(on.json.entries.map((e) => e.text), ['newest']);
  writeStatus(c.dataDir, { engine: 'ready', shareHistory: false, recent: [{ ts: 2000, text: 'newest' }] });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await call(c.client, 'recent_dictation', {})).isError, true);
  assert.ok(!(await c.client.listTools()).tools.some((t) => t.name === 'recent_dictation'), 'hidden again');
  await c.close();
});

test('malformed input: every bad argument is rejected, nothing is written, the server keeps working', async () => {
  const c = await connect();
  const bad = [
    ['notes_add', {}], ['notes_add', { text: '' }], ['notes_add', { text: 5 }], ['notes_add', { text: 'x'.repeat(20001) }], ['notes_add', { text: 'ok', tags: 'a' }],
    ['notes_add', { text: 'ok', tags: Array.from({ length: 11 }, (_, i) => 't' + i) }], ['notes_add', { text: 'ok', tags: [''] }], ['notes_add', { text: '\u0000\u0001' }],
    ['notes_list', { status: 'everything' }], ['notes_list', { limit: 0 }], ['notes_list', { limit: 1000 }], ['notes_list', { limit: 1.5 }], ['notes_list', { order: 'sideways' }],
    ['note_get', {}], ['note_get', { id: '../../x' }], ['note_get', { id: 'a'.repeat(65) }], ['note_get', { id: 7 }],
    ['note_mark_synced', { id: 'abc' }], ['note_mark_synced', { id: 'abc', destination: '' }], ['note_mark_synced', { id: 'abc', destination: 'x', url: 'javascript:alert(1)' }],
    ['note_mark_synced', { id: 'abc', destination: 'x', url: 'file:///c:/x.txt' }], ['note_mark_synced', { id: 'abc', destination: 'a\nb' }], ['note_mark_synced', { id: 'abc', destination: 'x'.repeat(101) }],
    ['recent_dictation', { limit: -1 }], ['no_such_tool', {}],
  ];
  for (const [name, args] of bad) {
    let isErr = false;
    try { const r = await c.client.callTool({ name, arguments: args }); isErr = !!r.isError; } catch (e) { isErr = true; }
    assert.ok(isErr, name + ' ' + JSON.stringify(args).slice(0, 60));
  }
  assert.equal(c.outbox.notes.length, 0, 'nothing was written');
  assert.equal((await call(c.client, 'note_get', { id: 'nope' })).isError, true);
  assert.equal((await call(c.client, 'notes_add', { text: 'still works' })).isError, false);
  await c.close();
});

test('size caps: a note is capped at 20000 characters, a huge listing is cut under the reply cap', async () => {
  const c = await connect();
  for (let i = 0; i < 30; i++) c.outbox.add(String(i).padStart(3, '0') + ' ' + 'x'.repeat(19000));
  const l = await call(c.client, 'notes_list', { status: 'all', limit: 100 });
  assert.equal(l.json.truncated, true); assert.ok(l.text.length < 130000); assert.ok(l.json.returned < 30 && l.json.total === 30);
  await c.close();
});

test('privacy: the log has counts and timings only, never text, ids, tags or arguments', async () => {
  const c = await connect();
  const add = await call(c.client, 'notes_add', { text: PRIVATE_TEXT, tags: ['zebra-tag'] });
  await call(c.client, 'notes_list', {}); await call(c.client, 'note_get', { id: add.json.note.id });
  await call(c.client, 'note_mark_synced', { id: add.json.note.id, destination: 'Notion: ZEBRA-DEST', url: 'https://example.com/zebra-url' });
  try { await c.client.callTool({ name: 'notes_list', arguments: { status: 'LEAKY-ENUM' } }); } catch (_) { /* rejected */ }
  await call(c.client, 'dictation_status');
  const log = c.logs.join('\n');
  assert.ok(c.logs.length >= 5);
  for (const needle of ['PRIVATE', '7f3a', 'zebra', 'ZEBRA', 'LEAKY', add.json.note.id, 'example.com']) assert.ok(!log.includes(needle), 'log leaks ' + needle);
  assert.match(log, /notes_add ok n=1 ms=\d+/);
  await c.close();
});
