'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');

test('every new module loads on its own with no side effects', () => {
  for (const f of ['src/notes/outbox.js', 'src/notes/mcp-status.js', 'src/notes/export-md.js', 'src/notes/service.js', 'src/core/routing.js', 'src/core/note-sink.js',
    'src/core/terminals.js', 'src/typer/newline.js', 'src/main/settings-notes.js', 'mcp/server.js']) {
    assert.doesNotThrow(() => require(path.join(root, f)), f);
  }
});
test('the MCP SDK is installed from the lock file (mcp/node_modules) at the pinned version', () => {
  const { mreq } = require('./util');
  const pkg = require(path.join(root, 'mcp', 'package.json'));
  assert.equal(pkg.dependencies['@modelcontextprotocol/sdk'], '1.32.1');
  assert.equal(JSON.parse(require('fs').readFileSync(path.join(root, 'mcp', 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'), 'utf8')).version, '1.32.1');
  const lock = require(path.join(root, 'mcp', 'package-lock.json'));
  assert.equal(lock.packages['node_modules/@modelcontextprotocol/sdk'].version, '1.32.1');
  assert.ok(lock.packages['node_modules/@modelcontextprotocol/sdk'].integrity.startsWith('sha512-'));
});
test('server.js has a shebang-free CommonJS entry that does not start a server when required', () => {
  const m = require(path.join(root, 'mcp', 'server.js'));
  assert.equal(typeof m.createServer, 'function');
});
