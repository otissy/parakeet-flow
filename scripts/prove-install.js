'use strict';
/* Proof run for the Squirrel installer: install silently (per user), run the installed app hidden, uninstall, and
   compare "what Windows knows about us" before and after: Run keys, scheduled tasks, Startup folder, uninstall
   entry, Start-menu and Desktop shortcuts, install folder, and that the AppData parakeet-flow folder (models,
   settings, notes) is untouched.
   Usage: node scripts/prove-install.js "<path to Setup.exe>" [--out=<proof folder>] [--hook=<js run inside the first-run app>]
   Squirrel starts the app once right after a silent install (--squirrel-firstrun); PF_OFFSCREEN keeps its windows
   off the visible desktop. It refuses to run when an install already exists in %LOCALAPPDATA%/parakeet-flow. */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NAME = 'parakeet-flow';
const LOCAL = process.env.LOCALAPPDATA, ROAM = process.env.APPDATA;
const INSTALL = path.join(LOCAL, NAME);
const PROGRAMS = path.join(ROAM, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (exe, args) => { const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true }); return (r.stdout || '') + (r.stderr || ''); };

function walk(dir, pat, out = [], depth = 0) {
  if (depth > 3 || !fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (pat.test(e.name)) out.push(p);
    if (e.isDirectory()) walk(p, pat, out, depth + 1);
  }
  return out;
}
const lines = (s) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const list = (d) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : null);

function snapshot() {
  const runKeys = {};
  for (const k of ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run']) {
    runKeys[k] = lines(run('reg.exe', ['query', k])).filter((l) => l !== k);
  }
  const tasks = lines(run('schtasks.exe', ['/query', '/fo', 'csv', '/nh'])).map((l) => l.split('","')[0].replace(/^"/, ''));
  const uninstall = lines(run('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'])).filter((l) => /parakeet/i.test(l));
  const shortcuts = [...walk(PROGRAMS, /parakeet.*\.lnk$/i), ...walk(path.join(os.homedir(), 'Desktop'), /parakeet.*\.lnk$/i)];
  return {
    runKeys, taskCount: tasks.length, parakeetTasks: tasks.filter((t) => /parakeet/i.test(t)),
    startup: list(path.join(PROGRAMS, 'Startup')), uninstallEntries: uninstall, shortcuts, installFolder: fs.existsSync(INSTALL),
    appdataFiles: list(path.join(ROAM, NAME)), models: list(path.join(ROAM, NAME, 'models')),
  };
}
const procs = () => lines(run('tasklist.exe', ['/fo', 'csv', '/nh'])).filter((l) => /parakeet flow\.exe/i.test(l)).map((l) => Number(l.split('","')[1]));
const killAll = () => { for (const pid of procs()) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }); };   // only the installed app's processes

async function main() {
  const setup = process.argv[2];
  const arg = (n) => { const a = process.argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : ''; };
  const out = arg('out') || path.join(os.tmpdir(), 'pf-install-proof');
  const hook = arg('hook');
  if (!setup || !fs.existsSync(setup)) throw new Error('usage: node scripts/prove-install.js "<Setup.exe>"');
  if (fs.existsSync(INSTALL)) throw new Error('refusing: ' + INSTALL + ' already exists (this test would remove it)');
  if (procs().length) throw new Error('refusing: a Parakeet Flow.exe is already running');
  fs.mkdirSync(out, { recursive: true });
  const rep = { setup, started: new Date().toISOString() };
  rep.before = snapshot();

  // 1. silent per-user install; Squirrel launches the app once (first run), offscreen and with the proof hook if given
  const env = { ...process.env, PF_OFFSCREEN: '1', PF_NO_LOGIN_ITEM: '1', PF_PROOF_DIR: out, DIAG_OUT: path.join(out, 'firstrun.json') };
  delete env.ELECTRON_RUN_AS_NODE;
  if (hook) env.PF_TEST_HOOK = hook;
  const t0 = Date.now();
  const inst = spawn(setup, ['--silent'], { env, stdio: 'ignore', windowsHide: true });
  await new Promise((r) => inst.on('exit', (code) => { rep.setupExit = code; r(); }));
  rep.installMs = Date.now() - t0;
  for (let i = 0; i < 90 && !fs.existsSync(path.join(INSTALL, 'Update.exe')); i++) await sleep(1000);
  await sleep(3000);
  rep.afterInstall = snapshot();
  rep.installLayout = list(INSTALL);
  const appDir = rep.installLayout && rep.installLayout.find((f) => /^app-\d/.test(f));
  rep.appDir = appDir || null;
  rep.exe = appDir ? path.join(INSTALL, appDir, 'Parakeet Flow.exe') : null;
  rep.firstRunLaunched = procs().length > 0 || fs.existsSync(path.join(out, 'firstrun.json'));

  await sleep(1500);
  killAll();
  await sleep(1000);

  // 2. start the installed copy hidden for 10 s (own windows off-screen), then stop it
  if (rep.exe && fs.existsSync(rep.exe)) {
    const child = spawn(rep.exe, hook ? [] : ['--hidden'], { env: { ...env, PF_TEST_HOOK: hook }, stdio: 'ignore', windowsHide: true });
    await sleep(10000);
    rep.installedRunning10s = { pid: child.pid, alive: child.exitCode === null, processes: procs().length };
    const lf = path.join(ROAM, NAME, 'logs', 'app.log');
    rep.logTail = fs.existsSync(lf) ? fs.readFileSync(lf, 'utf8').trim().split('\n').slice(-2) : null;
    killAll();
    await sleep(1500);
  }

  // 3. uninstall through Squirrel's Update.exe
  const u = spawnSync(path.join(INSTALL, 'Update.exe'), ['--uninstall', '--silent'], { env, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  rep.uninstallExit = u.status;
  for (let i = 0; i < 60 && fs.existsSync(INSTALL); i++) await sleep(1000);
  await sleep(2000);
  rep.afterUninstall = snapshot();
  rep.remainingProcesses = procs().length;
  rep.installFolderLeft = list(INSTALL);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  rep.checks = {
    installedFolder: rep.afterInstall.installFolder === true,
    shortcutCreated: rep.afterInstall.shortcuts.length > 0,
    uninstallEntryCreated: rep.afterInstall.uninstallEntries.length > 0,
    noRunKeyAdded: same(rep.before.runKeys, rep.afterInstall.runKeys) && same(rep.before.runKeys, rep.afterUninstall.runKeys),
    noTaskAdded: rep.afterInstall.parakeetTasks.length === 0 && rep.afterInstall.taskCount === rep.before.taskCount,
    noStartupFolderEntry: same(rep.before.startup, rep.afterInstall.startup) && same(rep.before.startup, rep.afterUninstall.startup),
    installedAppRan10s: !!(rep.installedRunning10s && rep.installedRunning10s.alive),
    // Squirrel cannot delete the Update.exe it runs from: only its own stub may remain (no app files, no app-x content but squirrel.exe)
    uninstallRemovedApp: rep.afterUninstall.installFolder === false || (Array.isArray(rep.installFolderLeft) && rep.installFolderLeft.every((f) => ['.dead', 'Update.exe', 'app-' + (rep.appDir || '').slice(4)].includes(f)) && (list(path.join(INSTALL, rep.appDir || 'x')) || []).every((f) => f === 'squirrel.exe')),
    uninstallRemovedShortcuts: rep.afterUninstall.shortcuts.length === 0,
    uninstallRemovedRegistryEntry: rep.afterUninstall.uninstallEntries.length === 0,
    appdataUntouched: same(rep.before.models, rep.afterUninstall.models) && !!rep.afterUninstall.appdataFiles,
    noProcessLeft: rep.remainingProcesses === 0,
  };
  fs.writeFileSync(path.join(out, 'install-proof.json'), JSON.stringify(rep, null, 1));
  console.log(JSON.stringify(rep.checks, null, 1));
  return Object.values(rep.checks).every(Boolean) ? 0 : 1;
}
if (require.main === module) main().then((c) => process.exit(c), (e) => { console.error('prove-install: ' + e.message); process.exit(2); });
module.exports = { snapshot };
