'use strict';
/* Automatic install of a downloaded update, with a fake autoUpdater and a fake clock: only at a quiet moment, never while dictating,
   in a meeting or reading aloud, only when the PC itself has been unused for a while, and only with the setting on. Plus What's new. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const root = path.join(__dirname, '..', '..');
const U = require(path.join(root, 'src/main/updater.js'));
const W = require(path.join(root, 'src/main/whatsnew.js'));
const { DEFAULTS, normalize } = require(path.join(root, 'src/main/settings.js'));

function rig(o = {}) {
  const au = Object.assign(new EventEmitter(), { feeds: [], checks: 0, quits: 0, setFeedURL(x) { this.feeds.push(x); }, checkForUpdates() { this.checks++; }, quitAndInstall() { this.quits++; } });
  const timers = [], logs = [];
  const r = { au, timers, logs, busy: false, auto: true, installAuto: true, idle: 9999, clock: 1000000, marks: 0, quit: 0 };
  r.u = new U.Updater({
    installed: true, version: '0.2.65',
    getAutoUpdater: () => au, isAuto: () => r.auto, isInstallAuto: () => r.installAuto, isBusy: () => r.busy, systemIdleSec: () => r.idle, markRelaunch: () => { r.marks++; },
    log: (l, m) => logs.push(l + ' ' + m), beforeQuit: () => { r.quit++; }, now: () => r.clock,
    setTimer: (f, ms) => { const t = { f, ms }; timers.push(t); return t; }, clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  /** run the next planned timer after advancing the clock by its delay */
  r.tick = () => { const t = timers.shift(); assert.ok(t, 'a timer is planned'); r.clock += t.ms; t.f(); return t.ms; };
  r.download = () => { r.u._check(); au.emit('update-available'); au.emit('update-downloaded'); };
  return r;
}
const advance = (r, minutes) => { for (let i = 0; i < minutes; i++) { r.clock += 0; } };
void advance;

test('a downloaded update waits for a quiet moment: 2 minutes of nothing busy AND 3 minutes without keyboard or mouse, then it restarts once', () => {
  const r = rig({});
  r.download();
  assert.equal(r.u.status().state, 'ready');
  assert.equal(r.timers.length, 1);
  assert.equal(r.timers[0].ms, U.QUIET_CHECK_MS);
  r.tick();                                        // first look: quiet starts now
  assert.equal(r.au.quits, 0);
  r.tick();                                        // 1 min
  assert.equal(r.au.quits, 0, 'one minute of quiet is not enough');
  r.tick();                                        // 2 min
  assert.equal(r.au.quits, 1, 'two minutes of quiet and an unused PC: installed');
  assert.equal(r.marks, 1, 'the next start is told to stay in the tray');
  assert.equal(r.quit, 1);
  assert.match(r.logs.join('\n'), /installing the downloaded update at a quiet moment/);
});

test('never while dictating or in a meeting or reading aloud (isBusy): the quiet clock starts over every time', () => {
  const r = rig({});
  r.download();
  r.tick(); r.tick();                              // 1 min quiet
  r.busy = true; r.tick();                         // busy: reset
  r.busy = false; r.tick(); r.tick();              // 1 min of quiet again, not 2
  assert.equal(r.au.quits, 0, 'busy in the middle reset the count');
  r.busy = true;
  for (let i = 0; i < 30; i++) r.tick();
  assert.equal(r.au.quits, 0, 'half an hour of dictating: no restart, ever');
  r.busy = false; r.tick(); r.tick(); r.tick();
  assert.equal(r.au.quits, 1, 'then quiet for 2 minutes: installed');
});

test('the PC must have been idle (no key, no mouse) for 3 minutes: a user typing elsewhere is never interrupted', () => {
  const r = rig({});
  r.download();
  r.idle = 5;
  for (let i = 0; i < 20; i++) r.tick();
  assert.equal(r.au.quits, 0, 'someone is at the keyboard');
  r.idle = 179; r.tick(); assert.equal(r.au.quits, 0);
  r.idle = 180; r.tick(); assert.equal(r.au.quits, 1);
});

test('the setting off: a downloaded update is not installed automatically; switching it on (or off) while waiting is honoured', () => {
  const r = rig({});
  r.installAuto = false;
  r.download();
  assert.equal(r.timers.length, 0, 'no timer when the setting is off');
  r.u.settingsChanged();
  assert.equal(r.timers.length, 0);
  r.installAuto = true; r.u.settingsChanged();
  assert.equal(r.timers.length, 1, 'switched on: it starts looking for a quiet moment');
  r.u.settingsChanged(); assert.equal(r.timers.length, 1, 'not planned twice');
  r.installAuto = false; r.u.settingsChanged();
  assert.equal(r.timers.length, 0, 'switched off: stops looking');
  r.installAuto = true; r.u.settingsChanged();
  r.installAuto = false;
  for (let i = 0; i < 6; i++) { if (r.timers.length) r.tick(); }
  assert.equal(r.au.quits, 0, 'a timer that was already running re-checks the setting before restarting');
});

test('manual restart still works and is still refused while busy; Check now is unchanged', () => {
  const r = rig({});
  r.download();
  r.busy = true;
  assert.deepEqual(r.u.restartToUpdate(), { ok: false, error: 'Finish dictating first.' });
  r.busy = false;
  assert.deepEqual(r.u.restartToUpdate(), { ok: true });
  assert.equal(r.au.quits, 1);
  const r2 = rig({});
  assert.deepEqual(r2.u.checkNow(), { ok: true });
  assert.equal(r2.au.checks, 1);
});

test('stop() clears the quiet timer; a copy that is not installed never plans anything', () => {
  const r = rig({});
  r.download(); assert.equal(r.timers.length, 1);
  r.u.stop(); assert.equal(r.timers.length, 0);
  const n = new U.Updater({ installed: false, getAutoUpdater: () => { throw new Error('must not load'); }, setTimer: () => { throw new Error('no timers'); } });
  n.state = 'ready'; n._planInstall(); n.settingsChanged();
});

test('a failed restart (busy at the last moment) keeps looking instead of giving up', () => {
  const r = rig({});
  r.download();
  r.tick(); r.tick();
  const real = r.u.isBusy; let calls = 0;
  r.u.isBusy = () => (++calls === 2 ? true : real());       // quiet at the check, busy by the time restartToUpdate asks again
  r.tick();
  assert.equal(r.au.quits, 0);
  assert.equal(r.timers.length, 1, 'planned another look');
});

test('status() and settings: installAuto is reported and defaults to on', () => {
  const r = rig({});
  assert.equal(r.u.status().installAuto, true);
  r.installAuto = false; assert.equal(r.u.status().installAuto, false);
  assert.equal(DEFAULTS.updates.installAuto, true);
  assert.equal(normalize({ updates: { seen: '0.2.65' } }).updates.seen, '0.2.65');
  assert.equal(normalize({ updates: { seen: '<script>' } }).updates.seen, '', 'seen is only ever a version number');
});

test('the launcher the restart goes through is the same stable Update.exe the Start-with-Windows entry uses (0.2.65), and a restarted app comes up in the tray', () => {
  const { loginSettings } = require(path.join(root, 'src/main/login-item.js'));
  const exe = 'C:\\Users\\me\\AppData\\Local\\parakeet-flow\\app-0.2.65\\Parakeet Flow.exe';
  const s = loginSettings(true, { execPath: exe, exists: (p) => p === 'C:\\Users\\me\\AppData\\Local\\parakeet-flow\\Update.exe' });
  assert.equal(path.basename(s.path), 'Update.exe');
  assert.deepEqual(s.args, ['--processStart', 'Parakeet Flow.exe']);
  // the update itself is Squirrel's: it lands in a new app-<version> folder next to the one running, and Update.exe --processStart starts the newest
  assert.equal(U.isInstalled({ isPackaged: true, execPath: exe, exists: () => true }), true);
});

/* ---------------- What's new ---------------- */
test("what's new: shown once per version to someone who updated, never on a first install, never for an older or equal version", () => {
  const n = W.pending({ version: '0.2.66', seen: '', firstInstall: false });
  assert.ok(n && n.version === '0.2.66' && n.items.length >= 2);
  assert.equal(W.pending({ version: '0.2.66', seen: '', firstInstall: true }), null, 'a brand-new install has nothing to compare with');
  assert.equal(W.pending({ version: '0.2.66', seen: '0.2.66', firstInstall: false }), null, 'already shown');
  assert.equal(W.pending({ version: '0.2.66', seen: '0.2.70', firstInstall: false }), null, 'a downgrade shows nothing');
  assert.ok(W.pending({ version: '0.2.66', seen: '0.2.65', firstInstall: false }));
  assert.equal(W.pending({ version: '0.2.99', seen: '0.2.66', firstInstall: false }), null, 'a version without notes shows nothing');
  assert.equal(W.pending({ version: 'x', seen: '', firstInstall: false }), null);
});
test("what's new: the newest entry is the version in package.json and the top of CHANGELOG.md says the same", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  assert.ok(W.NOTES[pkg], 'notes for ' + pkg);
  const newest = Object.keys(W.NOTES).sort(W.cmp).pop();
  assert.equal(newest, pkg);
  const cl = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(cl, new RegExp('^## ' + pkg.replace(/\./g, '\\.') + '\\b', 'm'));
  assert.ok(cl.indexOf('## ' + pkg) < cl.indexOf('## 0.2.65'), 'newest first');
});
test('what\'s new: the relaunch marker is used once, only when fresh, and always removed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-wn-'));
  assert.equal(W.consumeMarker(dir), false, 'no marker');
  W.writeMarker(dir, 1000); assert.equal(W.consumeMarker(dir, 1000 + 60000), true);
  assert.equal(fs.existsSync(path.join(dir, W.MARKER)), false, 'removed');
  assert.equal(W.consumeMarker(dir, 1000 + 60000), false, 'only once');
  W.writeMarker(dir, 1000); assert.equal(W.consumeMarker(dir, 1000 + 10 * 60000), false, 'a stale marker from a restart that never happened is ignored');
  assert.equal(fs.existsSync(path.join(dir, W.MARKER)), false, 'and removed all the same');
  fs.rmSync(dir, { recursive: true, force: true });
});
