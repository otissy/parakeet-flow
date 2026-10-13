'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');

test('helper compiles with the TOGGLE command and the swallow state present', () => {
  const { buildHelper } = require(path.join(root, 'src/typer/win32-typer.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-caps-l1-'));
  assert.ok(fs.existsSync(buildHelper(dir)));
  fs.rmSync(dir, { recursive: true, force: true });
  const cs = fs.readFileSync(path.join(root, 'src/typer/helper/PfHelper.cs'), 'utf8');
  for (const c of ['"TOGGLE"', 'toggleSw', 'togglePending']) assert.ok(cs.includes(c), c);
  assert.ok(!/Key\(\s*0x14/.test(cs) && !/GetKeyState\(/.test(cs), 'the helper never sends CapsLock and never reads the caps state');
});

test('modules load alone', () => {
  for (const f of ['src/core/hotkey-fsm.js', 'src/main/settings.js', 'src/main/controller.js', 'src/renderer/lib.js', 'src/typer/win32-typer.js'])
    assert.ok(Object.keys(require(path.join(root, f))).length > 0, f);
});

test('renderer app.js parses', () => {
  new Function(fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8'));
});
