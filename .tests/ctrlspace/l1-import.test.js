'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');

test('helper source compiles with the csc that ships with Windows (hook, claim, release/restore present)', () => {
  const { buildHelper } = require(path.join(root, 'src/typer/win32-typer.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-cs-l1-'));
  assert.ok(fs.existsSync(buildHelper(dir)));
  fs.rmSync(dir, { recursive: true, force: true });
  const cs = fs.readFileSync(path.join(root, 'src/typer/helper/PfHelper.cs'), 'utf8');
  for (const c of ['WH_KEYBOARD_LL', '"CLAIM"', 'SELF', 'released', 'KEYEVENTF_EXTENDEDKEY']) assert.ok(cs.includes(c), c);
});

test('modules load alone', () => {
  for (const f of ['src/main/settings.js', 'src/main/controller.js', 'src/renderer/lib.js', 'src/typer/win32-typer.js']) assert.ok(Object.keys(require(path.join(root, f))).length > 0, f);
});
