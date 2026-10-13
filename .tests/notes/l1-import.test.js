'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');

test('notes modules load alone', () => {
  const o = require(path.join(root, 'src/notes/outbox.js'));
  assert.ok(o.Outbox && o.backoffMs);
  const n = require(path.join(root, 'src/notes/notion.js'));
  assert.equal(n.NOTION_VERSION, '2022-06-28'); assert.equal(n.API, 'https://api.notion.com');
  for (const k of ['buildPageBody', 'createPage', 'NotionSync', 'resolveBase', 'redact']) assert.ok(n[k], k);
  assert.ok(require(path.join(root, 'src/main/secret.js')).SecretStore);
});
