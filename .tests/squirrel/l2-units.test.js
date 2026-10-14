'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const root = path.join(__dirname, '..', '..');
const sq = require(path.join(root, 'src/main/squirrel.js'));
const { outputDir } = require(path.join(root, 'scripts/build-installer.js'));
const icon = require(path.join(root, 'scripts/make-icon.js'));
const EXE = 'C:/x/parakeet-flow/app-1.0.0/Parakeet Flow.exe';

test('squirrelEvent names every flag and ignores normal starts', () => {
  for (const f of sq.FLAGS) assert.equal(sq.squirrelEvent(['x', '--squirrel-' + f]), f);
  assert.equal(sq.squirrelEvent(['--squirrel-install=0.2.0']), 'install');
  for (const a of [[], ['--hidden'], ['--squirrel-bogus'], ['--user-data=C:/x'], null, undefined]) assert.equal(sq.squirrelEvent(a), null);
});
test('only first run is a normal start', () => {
  for (const f of ['install', 'updated', 'uninstall', 'obsolete']) assert.equal(sq.mustExit(['--squirrel-' + f]), true, f);
  assert.equal(sq.mustExit(['--squirrel-firstrun']), false);
  assert.equal(sq.mustExit([]), false);
});
test('Update.exe arguments: Start-menu shortcut only, removal on uninstall, nothing else', () => {
  assert.deepEqual(sq.updateArgs('install', EXE), ['--createShortcut=Parakeet Flow.exe', '--shortcut-locations=StartMenu']);
  assert.deepEqual(sq.updateArgs('updated', EXE), sq.updateArgs('install', EXE));
  assert.match(sq.updateArgs('uninstall', EXE)[0], /^--removeShortcut=/);
  for (const e of ['obsolete', 'firstrun', null]) assert.equal(sq.updateArgs(e, EXE), null);
  for (const e of ['install', 'updated', 'uninstall']) assert.ok(!/startup|login/i.test(sq.updateArgs(e, EXE).join(' ')));
});
test('handle: calls Update.exe, always finishes, never throws', async () => {
  let calls = [];
  const fake = (ev) => (up, args) => { calls.push([up, args]); const c = new EventEmitter(); setImmediate(() => c.emit(ev, 0)); return c; };
  await new Promise((r) => sq.handle('install', { execPath: EXE, spawn: fake('exit'), exists: () => true }, r));
  assert.equal(path.basename(calls[0][0]), 'Update.exe');
  assert.equal(path.basename(path.dirname(calls[0][0])), 'parakeet-flow');
  await new Promise((r) => sq.handle('install', { execPath: EXE, spawn: fake('error'), exists: () => true }, r));
  await new Promise((r) => sq.handle('install', { execPath: EXE, spawn: () => { throw new Error('boom'); }, exists: () => true }, r));
  calls = [];
  await new Promise((r) => sq.handle('install', { execPath: EXE, spawn: fake('exit'), exists: () => false }, r));   // dev run, no Update.exe
  await new Promise((r) => sq.handle('obsolete', { execPath: EXE, spawn: fake('exit'), exists: () => true }, r));
  assert.equal(calls.length, 0);
});
test('uninstall only asks Squirrel to remove the shortcut: nothing spawned beyond Update.exe', async () => {
  const calls = [];
  const fake = (up) => { calls.push(up); const c = new EventEmitter(); setImmediate(() => c.emit('exit', 0)); return c; };
  await new Promise((r) => sq.handle('uninstall', { execPath: EXE, spawn: fake, exists: () => true }, r));
  assert.equal(calls.length, 1); assert.equal(path.basename(calls[0]), 'Update.exe');
});
test('user data is always the parakeet-flow folder under AppData', () => {
  assert.equal(sq.userDataDir('R'), path.join('R', 'parakeet-flow'));
});
test('output folder is fresh and versioned, never reused', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-b-'));
  const o = outputDir(d, '0.2.0');
  assert.equal(o, path.join(d, '0.2.0'));
  fs.mkdirSync(o);
  assert.throws(() => outputDir(d, '0.2.0'), /already exists/);
  assert.equal(outputDir(d, '0.2.0', 'b c!'), path.join(d, '0.2.0-bc'));
  assert.throws(() => outputDir(d, '0.2'), /x\.y\.z/);
  assert.throws(() => outputDir(d, '1.0.0-beta'), /x\.y\.z/);
  fs.rmSync(d, { recursive: true, force: true });
});
test('icon.ico: valid directory, every size present, committed file matches generator', () => {
  const b = icon.build();
  const f = fs.readFileSync(path.join(root, 'assets', 'icon.ico'));
  assert.ok(f.equals(b.ico), 'assets/icon.ico is stale: run npm run icon');
  assert.equal(f.readUInt16LE(0), 0); assert.equal(f.readUInt16LE(2), 1);
  const n = f.readUInt16LE(4); assert.equal(n, icon.SIZES.length);
  for (let i = 0; i < n; i++) {
    const e = 6 + 16 * i, size = f[e] || 256, len = f.readUInt32LE(e + 8), off = f.readUInt32LE(e + 12);
    assert.equal(size, icon.SIZES[i]); assert.ok(off + len <= f.length);
    if (size >= 128) assert.equal(f.slice(off, off + 8).toString('hex'), '89504e470d0a1a0a'); else assert.equal(f.readUInt32LE(off), 40);
  }
  const px = icon.render(32); let lit = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 200) lit++;
  assert.ok(lit > 400 && lit < 1024, 'rounded square, not blank or full: ' + lit);
});
