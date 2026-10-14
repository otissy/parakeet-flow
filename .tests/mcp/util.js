'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');

const root = path.join(__dirname, '..', '..');
const mreq = createRequire(path.join(root, 'mcp', 'server.js'));       // resolves the SDK from mcp/node_modules
const { Client } = mreq('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = mreq('@modelcontextprotocol/sdk/inMemory.js');
const { StdioClientTransport } = mreq('@modelcontextprotocol/sdk/client/stdio.js');
const { createServer } = require(path.join(root, 'mcp', 'server.js'));
const { Outbox } = require(path.join(root, 'src', 'notes', 'outbox.js'));
const { writeStatus } = require(path.join(root, 'src', 'notes', 'mcp-status.js'));

/** keeps test folders out of %TEMP% (other jobs sweep it) */
function tmpDir(label = 'mcp') {
  const base = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'pf-mcp-tests');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, label + '-'));
}

/** server + client joined by the SDK's in-memory transport */
async function connect({ dataDir = tmpDir(), now, pollMs = 40 } = {}) {
  const logs = [];
  const { server, outbox, close } = createServer({ dataDir, log: (l) => logs.push(l), now, pollMs });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await server.connect(b); await client.connect(a);
  return { client, server, outbox, dataDir, logs, close: async () => { await client.close(); await close(); } };
}
const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content && r.content[0] && r.content[0].text;
  let json = null; try { json = JSON.parse(text); } catch (_) { /* an error text */ }
  return { r, text, json, isError: !!r.isError };
};

module.exports = { root, tmpDir, connect, call, mreq, Client, StdioClientTransport, createServer, Outbox, writeStatus,
  serverPath: path.join(root, 'mcp', 'server.js') };
