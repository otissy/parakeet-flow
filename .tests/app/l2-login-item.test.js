'use strict';
/* "Start with Windows" with a fake app: an installed copy registers the stable Squirrel launcher, not the versioned exe. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { runCommand, applyLoginItem, loginSettings, squirrelLauncher, RUN_NAME } = require('../../src/main/login-item.js');

const ROOT = 'C:\\Users\\x\\AppData\\Local\\parakeet-flow';
const EXE = path.join(ROOT, 'app-0.2.65', 'Parakeet Flow.exe');
const has = (...ok) => (p) => ok.includes(p);
const UPDATE = path.join(ROOT, 'Update.exe');
const fake = () => { const calls = []; return { calls, setLoginItemSettings: (s) => calls.push(s) }; };

test('installed: the launcher is Update.exe in the parent of app-<version>, started with --processStart', () => {
  assert.equal(squirrelLauncher(EXE, has(UPDATE)), UPDATE);
  assert.deepStrictEqual(loginSettings(true, { execPath: EXE, exists: has(UPDATE) }),
    { openAtLogin: true, path: UPDATE, args: ['--processStart', 'Parakeet Flow.exe'], name: RUN_NAME });
  assert.equal(RUN_NAME, 'com.squirrel.parakeet-flow.ParakeetFlow', 'the name of the stale entry, so it is overwritten');
  assert.ok(!loginSettings(true, { execPath: EXE, exists: has(UPDATE) }).path.includes('app-'), 'never a versioned folder');
});
test('dev or portable (no app-<version> folder, or no Update.exe): the old behaviour, no path or name', () => {
  assert.deepStrictEqual(loginSettings(true, { execPath: 'C:\\dev\\node_modules\\electron\\dist\\electron.exe', exists: () => true }), { openAtLogin: true });
  assert.deepStrictEqual(loginSettings(false, { execPath: EXE, exists: () => false }), { openAtLogin: false });
});
test('toggle on and off from Settings', () => {
  const a = fake();
  assert.equal(applyLoginItem(a, true, { env: {}, execPath: EXE, exists: has(UPDATE) }), 'set');
  assert.equal(applyLoginItem(a, false, { env: {}, execPath: EXE, exists: has(UPDATE) }), 'removed');
  assert.deepStrictEqual(a.calls.map((c) => [c.openAtLogin, c.name]), [[true, RUN_NAME], [false, RUN_NAME]]);
});
test('startup, setting on: written again (repairs an entry that points at a removed version)', () => {
  const a = fake();
  assert.equal(applyLoginItem(a, true, { startup: true, env: {}, execPath: EXE, exists: has(UPDATE) }), 'set');
  assert.equal(a.calls.length, 1);
  assert.equal(a.calls[0].path, UPDATE);
});
test('startup, setting off, installed: our own entry (and only that name) is removed', () => {
  const a = fake();
  assert.equal(applyLoginItem(a, false, { startup: true, env: {}, execPath: EXE, exists: has(UPDATE) }), 'removed');
  assert.deepStrictEqual(a.calls, [{ openAtLogin: false, path: UPDATE, args: ['--processStart', 'Parakeet Flow.exe'], name: RUN_NAME }]);
});
test('startup, setting off, dev run: nothing is touched', () => {
  const a = fake();
  assert.equal(applyLoginItem(a, false, { startup: true, env: {}, execPath: 'C:\\dev\\electron.exe', exists: () => true }), 'skipped');
  assert.deepStrictEqual(a.calls, []);
});
test('PF_NO_LOGIN_ITEM: nothing is touched, at startup or on a toggle', () => {
  const a = fake();
  for (const on of [true, false]) for (const startup of [true, false]) assert.equal(applyLoginItem(a, on, { startup, env: { PF_NO_LOGIN_ITEM: '1' }, execPath: EXE, exists: has(UPDATE) }), 'disabled');
  assert.deepStrictEqual(a.calls, []);
});
test('main.js uses it for the toggle and at startup, and writes no other login item itself', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(src, /applyLoginItem\(app, !!on\)/);
  assert.match(src, /applyLoginItem\(app, store\.get\(\)\.launchAtLogin, \{ startup: true \}\)/);
  assert.equal((src.match(/setLoginItemSettings/g) || []).length, 0);
});
test('the final Run value is exactly "<Update.exe>" --processStart "Parakeet Flow.exe" (not double-quoted), and parses back to the plain exe name', () => {
  const s = loginSettings(true, { execPath: EXE, exists: has(UPDATE) });
  const cmd = runCommand(s);
  assert.equal(cmd, '"' + UPDATE + '" --processStart "Parakeet Flow.exe"');
  assert.ok(!cmd.includes('\\"'), 'no escaped quotes: the name would reach Update.exe with quote characters in it');
  // what Update.exe sees after Windows splits the line (CommandLineToArgvW rules for this simple case)
  const argv = cmd.match(/"[^"]*"|\S+/g).map((x) => x.replace(/^"|"$/g, ''));
  assert.deepStrictEqual(argv, [UPDATE, '--processStart', 'Parakeet Flow.exe']);
  // the old, broken input shows what the rule does with embedded quotes
  assert.equal(runCommand({ path: UPDATE, args: ['--processStart', '"Parakeet Flow.exe"'] }), '"' + UPDATE + '" --processStart "\\"Parakeet Flow.exe\\""');
});
