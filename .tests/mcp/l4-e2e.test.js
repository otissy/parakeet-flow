'use strict';
/* the real thing: spawn mcp/server.js over stdio and speak MCP JSON-RPC to it; app and server writing at once; transcripts saved as proof */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { tmpDir, Client, StdioClientTransport, serverPath, Outbox, writeStatus, root } = require('./util');

const PROOF = process.env.PF_PROOF_DIR || tmpDir('proof');
const transcript = [];
const stamp = (dir, msg) => transcript.push({ dir, msg });

async function startStdio(dataDir) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath, `--data-dir=${dataDir}`], stderr: 'pipe', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  const origSend = transport.send.bind(transport); transport.send = (m) => { stamp('client->server', m); return origSend(m); };
  const client = new Client({ name: 'pf-test-client', version: '1.0.0' });
  client.onerror = () => {};
  await client.connect(transport);
  const origOn = transport.onmessage; transport.onmessage = (m, x) => { stamp('server->client', m); return origOn && origOn(m, x); };
  return { client, transport };
}

test('stdio end to end: initialize, tools/list, add, list, get, mark synced, status, over real JSON-RPC', async () => {
  const dir = tmpDir('stdio');
  const { client, transport } = await startStdio(dir);
  const info = client.getServerVersion(); assert.equal(info.name, 'parakeet-flow');
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ['dictation_status', 'note_get', 'note_mark_synced', 'notes_add', 'notes_list']);
  const j = async (name, args) => { const r = await client.callTool({ name, arguments: args }); return { r, j: r.isError ? null : JSON.parse(r.content[0].text) }; };
  const add = await j('notes_add', { text: 'Meeting notes: ship the MCP server ☕', tags: ['work'] });
  const id = add.j.note.id;
  assert.equal((await j('notes_list', {})).j.notes[0].id, id);
  assert.equal((await j('note_get', { id })).j.note.text, 'Meeting notes: ship the MCP server ☕');
  const m = await j('note_mark_synced', { id, destination: 'Notion: Notes', url: 'https://www.notion.so/x' });
  assert.equal(m.j.note.status, 'synced');
  assert.equal((await j('notes_list', { status: 'pending' })).j.total, 0);
  writeStatus(dir, { engine: 'ready', hotkeys: { dictation: 'Ctrl+Space', note: 'Ctrl+Shift+Space' } });
  const st = await j('dictation_status', {}); assert.equal(st.j.running, true);
  const bad = await client.callTool({ name: 'notes_list', arguments: { status: 'nope' } }); assert.equal(bad.isError, true);
  // the file the app reads is what the server wrote
  assert.equal(new Outbox(path.join(dir, 'notes.jsonl')).get(id).destination, 'Notion: Notes');
  // the server log file: counts only
  const log = fs.readFileSync(path.join(dir, 'logs', 'mcp.log'), 'utf8');
  assert.ok(/notes_add ok n=1/.test(log)); assert.ok(!log.includes('Meeting') && !log.includes(id));
  await client.close();
  fs.writeFileSync(path.join(PROOF, 'mcp-stdio-transcript.json'), JSON.stringify(transcript, null, 1));
});

test('raw JSON-RPC lines, no SDK client: the protocol itself works and stdout carries nothing but JSON-RPC', async () => {
  const dir = tmpDir('raw');
  const p = spawn(process.execPath, [serverPath, `--data-dir=${dir}`], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  let out = ''; p.stdout.on('data', (d) => { out += d; });
  const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
  const lines = () => out.split('\n').filter(Boolean);
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timeout; got ' + out.slice(0, 300)); };
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'raw', version: '0' } } });
  const init = await until(() => lines().map((l) => JSON.parse(l)).find((m) => m.id === 1));
  assert.equal(init.result.serverInfo.name, 'parakeet-flow');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'notes_add', arguments: { text: 'raw hello' } } });
  const r2 = await until(() => lines().map((l) => JSON.parse(l)).find((m) => m.id === 2));
  assert.equal(JSON.parse(r2.result.content[0].text).note.text, 'raw hello');
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'notes_add', arguments: { text: '' } } });
  const r3 = await until(() => lines().map((l) => JSON.parse(l)).find((m) => m.id === 3));
  assert.ok(r3.error || r3.result.isError, 'an empty note is refused');
  send({ jsonrpc: '2.0', id: 4, method: 'nothing/here' });
  const r4 = await until(() => lines().map((l) => JSON.parse(l)).find((m) => m.id === 4));
  assert.equal(r4.error.code, -32601);
  p.stdin.write('this is not json\n'); await new Promise((r) => setTimeout(r, 150));
  send({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
  await until(() => lines().map((l) => JSON.parse(l)).find((m) => m.id === 5));       // still alive after garbage
  for (const l of lines()) assert.doesNotThrow(() => JSON.parse(l), 'every stdout line is JSON');
  fs.writeFileSync(path.join(PROOF, 'mcp-raw-jsonrpc.txt'), lines().join('\n') + '\n');
  p.stdin.end(); await new Promise((r) => p.on('exit', r));
});

test('concurrency: the app (its own process, adding AND rewriting) and the MCP server write at once: 200 notes, none lost, none duplicated', async () => {
  const dir = tmpDir('conc');
  const { client } = await startStdio(dir);
  const app = spawn(process.execPath, [path.join(__dirname, 'app-writer.js'), dir, '100', 'app'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const appDone = new Promise((res, rej) => { app.on('exit', (c) => (c === 0 ? res() : rej(new Error('app writer exit ' + c)))); });
  const ids = [];
  const serverWork = (async () => {
    for (let i = 0; i < 100; i++) {
      const r = await client.callTool({ name: 'notes_add', arguments: { text: `srv-${i} café` } });
      assert.ok(!r.isError, 'add ' + i);
      ids.push(JSON.parse(r.content[0].text).note.id);
      if (i % 3 === 2) await client.callTool({ name: 'note_mark_synced', arguments: { id: ids[Math.floor(Math.random() * ids.length)], destination: 'Notion: Notes' } });   // rewrites too
    }
  })();
  await Promise.all([appDone, serverWork]);
  const final = new Outbox(path.join(dir, 'notes.jsonl')).notes;
  const texts = final.map((n) => n.text);
  assert.equal(final.length, 200, 'no note lost');
  assert.equal(new Set(final.map((n) => n.id)).size, 200, 'no duplicate id');
  for (let i = 0; i < 100; i++) { assert.ok(texts.includes(`app-${i} café`), 'app-' + i); assert.ok(texts.includes(`srv-${i} café`), 'srv-' + i); }
  const raw = fs.readFileSync(path.join(dir, 'notes.jsonl'), 'utf8').split('\n').filter(Boolean);
  assert.equal(raw.length, 200); for (const l of raw) JSON.parse(l);              // no torn line
  assert.ok(!fs.existsSync(path.join(dir, 'notes.jsonl.lock')), 'lock released');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'no temp file left');
  await client.close();
});

test('the server code touches only notes.jsonl and mcp-status.json', () => {
  const src = fs.readFileSync(serverPath, 'utf8') + fs.readFileSync(path.join(root, 'src/notes/outbox.js'), 'utf8') + fs.readFileSync(path.join(root, 'src/notes/mcp-status.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const files = new Set((code.match(/['"`][A-Za-z0-9_.-]+\.(?:json|jsonl|log)['"`]/g) || []).map((s) => s.slice(1, -1)));
  assert.deepEqual([...files].sort(), ['mcp-status.json', 'mcp.log', 'notes.jsonl']);
});
