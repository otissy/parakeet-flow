'use strict';
/* Squirrel.Windows lifecycle. Update.exe starts the app with one of these flags while installing, updating and
   uninstalling; the app must exit at once on all but --squirrel-firstrun, or it would open its windows and tray
   inside the installer. Squirrel itself creates and removes the Start-menu shortcut and the uninstall entry;
   the app never writes a startup (Run) entry, a scheduled task or anything outside its own folders.
   Uninstall removes only %LOCALAPPDATA%\parakeet-flow: %APPDATA%\parakeet-flow (models, settings, notes) stays. */
const path = require('path');

const FLAGS = ['install', 'updated', 'uninstall', 'obsolete', 'firstrun'];

/** the Squirrel event named by the command line, or null for a normal start */
function squirrelEvent(argv) {
  for (const a of argv || []) {
    const m = /^--squirrel-(install|updated|uninstall|obsolete|firstrun)(?:=|$)/.exec(String(a));
    if (m) return m[1];
  }
  return null;
}
/** true when the process must exit immediately (every event except first run, which is a normal start) */
const mustExit = (argv) => { const e = squirrelEvent(argv); return !!e && e !== 'firstrun'; };

/** the one place user data lives, whatever the product name is: keeps models, settings and notes across
    reinstalls and equal to what `npm start` used */
const userDataDir = (appData) => path.join(appData, 'parakeet-flow');

/** Update.exe arguments for an event, or null. Squirrel does not make shortcuts on its own: the app asks for them
    (Start menu only, no Desktop icon) when installed or updated, and asks for them to go when uninstalled. */
function updateArgs(event, execPath) {
  const exe = path.basename(execPath);
  if (event === 'install' || event === 'updated') return ['--createShortcut=' + exe, '--shortcut-locations=StartMenu'];
  if (event === 'uninstall') return ['--removeShortcut=' + exe, '--shortcut-locations=StartMenu,Desktop'];
  return null;
}
const updateExe = (execPath) => path.resolve(path.dirname(execPath), '..', 'Update.exe');

/** run the Update.exe call for the event (if any) and call done() when it has finished; never throws */
function handle(event, { execPath, spawn, exists, log = () => {} }, done) {
  const args = updateArgs(event, execPath);
  const up = updateExe(execPath);
  log('squirrel ' + event + ' update.exe=' + (exists(up) ? 'found' : 'missing'));
  if (!args || !exists(up)) return done();
  let finished = false;
  const end = () => { if (!finished) { finished = true; done(); } };
  try {
    const c = spawn(up, args, { stdio: 'ignore', windowsHide: true });
    c.on('exit', end); c.on('error', end);
    setTimeout(end, 15000);
  } catch (_) { end(); }
}

module.exports = { squirrelEvent, mustExit, userDataDir, updateArgs, updateExe, handle, FLAGS };
