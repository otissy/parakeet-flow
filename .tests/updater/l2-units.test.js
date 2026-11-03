'use strict';
/* Updater logic with a fake autoUpdater and a fake clock: when it may run, when it checks, and that it never interrupts a dictation. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const root = path.join(__dirname, '..', '..');
const U = require(path.join(root, 'src/main/updater.js'));
const { DEFAULTS, normalize } = require(path.join(root, 'src/main/settings.js'));

const EXE = 'C:\\Users\\me\\AppData\\Local\\parakeet-flow\\app-0.2.61\\Parakeet Flow.exe';
const UP = 'C:\\Users\\me\\AppData\\Local\\parakeet-flow\\Update.exe';

test('only an installed Squirrel copy counts: never npm start, never win-unpacked', () => {
  const yes = (p) => p === UP;
  assert.equal(U.isInstalled({ isPackaged: true, execPath: EXE, exists: yes }), true);
  assert.equal(U.isInstalled({ isPackaged: false, execPath: EXE, exists: yes }), false, 'not packaged');
  assert.equal(U.isInstalled({ isPackaged: true, execPath: EXE, exists: () => false }), false, 'no Update.exe');
  assert.equal(U.isInstalled({ isPackaged: true, execPath: 'C:\\builds\\parakeet-flow\\0.2.61\\win-unpacked\\Parakeet Flow.exe', exists: () => true }), false, 'win-unpacked');
  assert.equal(U.isInstalled({ isPackaged: false, execPath: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe', exists: () => true }), false, 'npm start');
});

test('the feed is the latest release of the app\'s own repo', () => {
  assert.equal(U.FEED_URL, 'https://github.com/otissy/parakeet-flow/releases/latest/download');
});

test('RELEASES parsing', () => {
  const sha = 'A'.repeat(40);
  const r = U.parseReleases(`\uFEFF${sha} parakeet-flow-0.2.61-full.nupkg 167256445\r\n\n# junk\n${sha.toLowerCase()} parakeet-flow-0.2.62-delta.nupkg 12\nnot a line\n${sha} ../evil.exe 5\n`);
  assert.deepStrictEqual(r.map((x) => [x.file, x.version, x.full, x.size, x.id]), [['parakeet-flow-0.2.61-full.nupkg', '0.2.61', true, 167256445, 'parakeet-flow'], ['parakeet-flow-0.2.62-delta.nupkg', '0.2.62', false, 12, 'parakeet-flow']]);
  assert.equal(r[0].sha1, sha.toLowerCase());
  assert.deepStrictEqual(U.parseReleases(''), []);
  assert.deepStrictEqual(U.parseReleases(null), []);
});

function rig(o = {}) {
  const au = Object.assign(new EventEmitter(), { feeds: [], checks: 0, quits: 0, setFeedURL(x) { this.feeds.push(x); }, checkForUpdates() { this.checks++; if (o.throwOnCheck) throw new Error('boom'); }, quitAndInstall() { this.quits++; } });
  const timers = [], logs = [];
  const r = { au, timers, logs, busy: false, auto: true, loaded: 0, quit: 0, changes: 0 };
  r.u = new U.Updater({
    installed: o.installed !== false, firstRun: !!o.firstRun, version: '0.2.61',
    getAutoUpdater: () => { r.loaded++; return au; }, isAuto: () => r.auto, isBusy: () => r.busy, log: (l, m) => logs.push(l + ' ' + m),
    beforeQuit: () => { r.quit++; }, onChange: () => { r.changes++; },
    setTimer: (f, ms) => { const t = { f, ms }; timers.push(t); return t; }, clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  r.fire = () => { const t = timers.shift(); assert.ok(t, 'a timer is planned'); t.f(); return t.ms; };
  return r;
}

test('not installed: autoUpdater is never loaded, nothing is planned, Check now only explains', () => {
  const r = rig({ installed: false });
  r.u.start(); r.u.settingsChanged();
  assert.equal(r.timers.length, 0);
  assert.equal(r.u.checkNow().ok, false);
  assert.equal(r.u.restartToUpdate().ok, false);
  assert.equal(r.loaded, 0);
  assert.equal(r.u.status().installed, false);
});

test('installed: a check shortly after start, then every few hours, with the feed set once', () => {
  const r = rig();
  r.u.start();
  assert.equal(r.timers[0].ms, U.FIRST_CHECK_MS);
  assert.equal(r.loaded, 0, 'nothing loaded before the first check');
  r.fire();
  assert.deepStrictEqual(r.au.feeds, [{ url: U.FEED_URL }]);
  assert.equal(r.au.checks, 1);
  assert.equal(r.timers[0].ms, U.EVERY_MS);
  assert.ok(U.EVERY_MS >= 3600000 && U.EVERY_MS <= 6 * 3600000);
  r.fire();
  assert.equal(r.au.checks, 2);
  assert.equal(r.au.feeds.length, 1);
});

test('the first run after an install waits longer: Squirrel still holds its lock', () => {
  const r = rig({ firstRun: true });
  r.u.start();
  assert.equal(r.timers[0].ms, U.FIRST_RUN_CHECK_MS);
});

test('setting off: no automatic check, Check now still works; on again: checks resume', () => {
  const r = rig();
  r.auto = false;
  r.u.start();
  assert.equal(r.timers.length, 0);
  assert.equal(r.u.checkNow().ok, true);
  assert.equal(r.au.checks, 1);
  r.auto = true;
  r.u.settingsChanged();
  assert.equal(r.timers[0].ms, U.FIRST_CHECK_MS);
  r.auto = false;
  r.u.settingsChanged();
  assert.equal(r.timers.length, 0, 'switching off cancels the planned check');
});

test('during a dictation no check starts; it comes a minute later', () => {
  const r = rig();
  r.u.start();
  r.busy = true;
  r.fire();
  assert.equal(r.au.checks, 0);
  assert.equal(r.timers[0].ms, U.BUSY_RETRY_MS);
  r.busy = false;
  r.fire();
  assert.equal(r.au.checks, 1);
});

test('an update is never applied by surprise: no restart without the user, none during a dictation, none twice-fetched', () => {
  const r = rig();
  r.u.start(); r.fire();
  r.au.emit('update-available');
  assert.equal(r.u.status().state, 'downloading');
  assert.equal(r.u.restartToUpdate().ok, false, 'nothing to restart into yet');
  r.au.emit('update-downloaded', {}, '', '0.2.62');
  assert.equal(r.u.status().state, 'ready');
  assert.equal(r.au.quits, 0, 'downloaded: it waits');
  r.fire();
  assert.equal(r.au.checks, 1, 'no further check while one waits');
  r.busy = true;
  assert.match(r.u.restartToUpdate().error, /dictating/);
  assert.equal(r.au.quits, 0);
  r.busy = false;
  assert.equal(r.u.restartToUpdate().ok, true);
  assert.equal(r.quit, 1, 'the app is told it is quitting first, or its window close handler would block it');
  assert.equal(r.au.quits, 1);
});

test('failures are logged and silent: state back to idle, later checks still run, one bad call never throws', () => {
  const r = rig();
  r.u.start(); r.fire();
  r.au.emit('error', new Error('Could not reach github.com\nstack line 2'));
  assert.equal(r.u.status().state, 'idle');
  assert.equal(r.u.status().lastFailed, true);
  assert.deepStrictEqual(r.logs, ['error update failed: Could not reach github.com']);
  r.fire();
  assert.equal(r.au.checks, 2);
  r.au.emit('update-not-available');
  assert.equal(r.u.status().lastFailed, false);
  const t = rig({ throwOnCheck: true });
  t.u.start();
  assert.doesNotThrow(() => t.fire());
  assert.equal(t.u.checkNow().ok, false);
  assert.match(t.logs[0], /boom/);
});

test('the setting: default on, off is kept, an old settings file gets the default, it does not sync', () => {
  const d = normalize(JSON.parse(JSON.stringify(DEFAULTS)));
  assert.equal(d.updates.auto, true);
  assert.equal(normalize({}).updates.auto, true);
  assert.equal(normalize({ updates: { auto: false } }).updates.auto, false);
  const A = require(path.join(root, 'src/sync/allowlist.js'));
  assert.equal(A.isAllowedKey('updates.auto'), false);
  assert.ok('updates.auto' in A.LOCAL_ONLY);
});

test('main.js loads autoUpdater only inside the installed-only path', () => {
  const m = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
  assert.ok(!/\{[^}]*autoUpdater[^}]*\}\s*=\s*require\('electron'\)/.test(m), 'not in the top-level import');
  assert.match(m, /getAutoUpdater: \(\) => require\('electron'\)\.autoUpdater/);
  assert.match(m, /installed: isInstalled\(/);
  assert.match(m, /isPackaged: app\.isPackaged/);
});
