'use strict';
/* "Start with Windows". On Windows Electron writes HKCU\...\Run\<name> = the running exe. Installed through Squirrel, that exe lives in
   the versioned folder app-<version>, which the next update deletes: the entry then points at nothing and the app never starts after a
   reboot (seen: app-0.2.61 left in the Run key). So an installed copy registers Squirrel's stable launcher, Update.exe in the parent of
   app-<version>, with --processStart (the documented Squirrel way: it starts the newest installed version).
   The value name is the one Electron already used, the app's user model id, which Squirrel sets to com.squirrel.<id>.<exe name>:
   writing under the same name replaces the old stale entry instead of adding a second one. Only that one value is ever written or removed. */
const fs = require('fs');
const path = require('path');

const RUN_NAME = 'com.squirrel.parakeet-flow.ParakeetFlow';

/** the Update.exe of a Squirrel install, or '' (a dev run, a portable copy) */
function squirrelLauncher(execPath = process.execPath, exists = fs.existsSync) {
  const appDir = path.dirname(execPath);
  if (!/^app-/i.test(path.basename(appDir))) return '';
  const update = path.join(path.dirname(appDir), 'Update.exe');
  return exists(update) ? update : '';
}

/** the arguments for app.setLoginItemSettings */
function loginSettings(on, { execPath = process.execPath, exists = fs.existsSync } = {}) {
  const launcher = squirrelLauncher(execPath, exists);
  if (!launcher) return { openAtLogin: !!on };
  return { openAtLogin: !!on, path: launcher, args: ['--processStart', `"${path.basename(execPath)}"`], name: RUN_NAME };
}

/** apply the setting. startup=true: re-apply what the settings say (repairs an entry an update left behind). Returns what it did */
function applyLoginItem(app, on, { startup = false, env = process.env, execPath = process.execPath, exists = fs.existsSync } = {}) {
  if (env.PF_NO_LOGIN_ITEM) return 'disabled';
  const s = loginSettings(on, { execPath, exists });
  if (startup && !on && !s.name) return 'skipped';       // a dev run with the setting off: nothing of ours to clean up
  app.setLoginItemSettings(s);
  return on ? 'set' : 'removed';
}

module.exports = { applyLoginItem, loginSettings, squirrelLauncher, RUN_NAME };
