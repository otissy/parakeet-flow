'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..', '..');

test('new modules load without side effects', () => {
  for (const f of ['src/main/squirrel.js', 'scripts/make-icon.js', 'scripts/build-installer.js', 'scripts/prove-install.js']) {
    assert.ok(require(path.join(root, f)), f);
  }
});
test('scripts parse', () => {
  for (const f of ['scripts/start.js', 'scripts/proof-hook.js']) {
    const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, f + ' ' + r.stderr);
  }
});
