'use strict';
/* Auto-update through Squirrel.Windows (Electron's autoUpdater), from the latest GitHub release. Only an installed copy does anything:
   from `npm start` or win-unpacked this file never loads autoUpdater and never contacts anything. A check is one web request made by
   Update.exe; a new version is downloaded and unpacked in the background into a new app-<version> folder and is what the shortcut starts
   next time, so "install on next quit" needs nothing more. A restart happens when the user asks, or (setting "Install updates
   automatically", on by default) by itself at a quiet moment: nothing busy (no dictation, no meeting recording or processing, no reading
   aloud) for QUIET_NEEDED_MS in a row and no keyboard or mouse use for IDLE_NEEDED_SEC. Never during any of those.
   Failures are logged (no dictated text exists here to log) and never pop up. */
const path = require('path');
const { updateExe } = require('./squirrel');

const FEED_URL = 'https://github.com/otissy/parakeet-flow/releases/latest/download';
const FIRST_CHECK_MS = 60 * 1000;
const FIRST_RUN_CHECK_MS = 10 * 60 * 1000;      // Squirrel holds its lock for a while right after an install
const EVERY_MS = 4 * 60 * 60 * 1000;
const BUSY_RETRY_MS = 60 * 1000;
const QUIET_CHECK_MS = 60 * 1000;               // how often a downloaded update looks for a quiet moment
const QUIET_NEEDED_MS = 2 * 60 * 1000;          // nothing busy for this long in a row
const IDLE_NEEDED_SEC = 3 * 60;                 // and the PC itself unused (no key, no mouse) for this long

/** installed by Squirrel = packaged, inside app-<version>, with Update.exe one folder up. win-unpacked and `npm start` are neither */
function isInstalled({ isPackaged, execPath, exists }) {
  return !!isPackaged && /^app-\d/.test(path.basename(path.dirname(execPath))) && !!exists(updateExe(execPath));
}

/** the RELEASES file -> [{sha1, file, size, id, version, full}]; a line that is not a release is skipped */
function parseReleases(text) {
  const out = [];
  for (const line of String(text ?? '').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^\s*([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    const f = /^(.+?)-(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+?)?)-(full|delta)\.nupkg$/.exec(m[2]);
    if (!f) continue;
    out.push({ sha1: m[1].toLowerCase(), file: m[2], size: Number(m[3]), id: f[1], version: f[2], full: f[3] === 'full' });
  }
  return out;
}

class Updater {
  /** getAutoUpdater: called only for an installed copy. setTimer/clearTimer are replaceable for tests */
  constructor({ installed, getAutoUpdater, version = '', isAuto = () => true, isInstallAuto = () => true, isBusy = () => false, systemIdleSec = () => 0, markRelaunch = () => {}, log = () => {}, onChange = () => {}, beforeQuit = () => {}, firstRun = false, now = () => Date.now(), setTimer = (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, clearTimer = clearTimeout }) {
    Object.assign(this, { installed, getAutoUpdater, version, isAuto, isInstallAuto, isBusy, systemIdleSec, markRelaunch, log, onChange, beforeQuit, firstRun, now, setTimer, clearTimer });
    this.state = 'idle'; this.lastCheckAt = 0; this.lastError = false; this.manual = false; this.timer = null; this.au = null; this.qTimer = null; this.quietSince = 0;
  }

  _wire() {
    if (this.au || !this.installed) return this.au;
    const au = this.getAutoUpdater();
    au.setFeedURL({ url: FEED_URL });
    const set = (state) => { this.state = state; this.onChange(); };
    au.on('checking-for-update', () => set('checking'));
    au.on('update-available', () => { this.lastCheckAt = this.now(); this.lastError = false; this.log('info', 'update found, downloading in the background'); set('downloading'); });
    au.on('update-not-available', () => { this.lastCheckAt = this.now(); this.lastError = false; this.log('info', 'update check: up to date'); set('idle'); });
    au.on('update-downloaded', () => { this.lastCheckAt = this.now(); this.lastError = false; this.log('info', 'update downloaded, it installs on the next start'); set('ready'); this._planInstall(); });
    au.on('error', (e) => { this._failed(e); });
    this.au = au;
    return au;
  }
  _failed(e) {
    this.lastError = true;
    this.log('error', 'update failed: ' + String((e && e.message) || e).split(/\r?\n/)[0].slice(0, 120));
    this.state = 'idle';
    this.onChange();
  }

  /** after the app is up. Does nothing at all for a copy that is not installed */
  start() {
    if (!this.installed || !this.isAuto()) return;
    this._plan(this.firstRun ? FIRST_RUN_CHECK_MS : FIRST_CHECK_MS);
  }
  stop() { if (this.timer) this.clearTimer(this.timer); this.timer = null; if (this.qTimer) this.clearTimer(this.qTimer); this.qTimer = null; }
  _plan(ms) { this.stop(); this.timer = this.setTimer(() => { this.timer = null; this._tick(); }, ms); }
  _tick() {
    if (!this.isAuto() || this.state === 'ready') return;      // already waiting for a restart: nothing more to fetch
    if (this.isBusy()) { this._plan(BUSY_RETRY_MS); return; }
    this._check();
    this._plan(EVERY_MS);
  }
  /** the settings may have changed */
  settingsChanged() {
    if (!this.installed) return;
    if (!this.isAuto()) { if (this.timer) this.clearTimer(this.timer); this.timer = null; }
    else if (!this.timer && this.state !== 'ready') this._plan(FIRST_CHECK_MS);
    if (this.state === 'ready') { if (this.isInstallAuto()) { if (!this.qTimer) this._planInstall(); } else if (this.qTimer) { this.clearTimer(this.qTimer); this.qTimer = null; this.quietSince = 0; } }
  }

  /** a downloaded update waits for a quiet moment (setting "Install updates automatically") */
  _planInstall() {
    if (!this.installed || this.state !== 'ready' || !this.isInstallAuto()) return;
    this.quietSince = 0;
    if (this.qTimer) this.clearTimer(this.qTimer);
    this.qTimer = this.setTimer(() => { this.qTimer = null; this._quietTick(); }, QUIET_CHECK_MS);
  }
  _quietTick() {
    if (this.state !== 'ready' || !this.isInstallAuto()) return;
    const t = this.now();
    if (this.isBusy()) this.quietSince = 0;
    else if (!this.quietSince) this.quietSince = t;
    if (this.quietSince && t - this.quietSince >= QUIET_NEEDED_MS && this.systemIdleSec() >= IDLE_NEEDED_SEC) {
      this.log('info', 'installing the downloaded update at a quiet moment');
      this.markRelaunch();
      if (this.restartToUpdate().ok) return;
    }
    this.qTimer = this.setTimer(() => { this.qTimer = null; this._quietTick(); }, QUIET_CHECK_MS);
  }

  _check() {
    try { this._wire().checkForUpdates(); return true; } catch (e) { this._failed(e); return false; }
  }
  /** the Check now button */
  checkNow() {
    if (!this.installed) return { ok: false, error: 'Only the installed app checks for updates.' };
    if (this.state === 'ready') return { ok: true };
    return { ok: this._check() };
  }
  /** the tray item and the Settings button. Never during a dictation */
  restartToUpdate() {
    if (this.state !== 'ready' || !this.au) return { ok: false, error: 'No update is waiting.' };
    if (this.isBusy()) return { ok: false, error: 'Finish dictating first.' };
    this.beforeQuit();
    this.au.quitAndInstall();
    return { ok: true };
  }
  status() {
    return { version: this.version, installed: !!this.installed, auto: !!this.isAuto(), installAuto: !!this.isInstallAuto(), state: this.state, lastCheckAt: this.lastCheckAt, lastFailed: !!this.lastError };
  }
}

module.exports = { Updater, isInstalled, parseReleases, FEED_URL, FIRST_CHECK_MS, FIRST_RUN_CHECK_MS, EVERY_MS, BUSY_RETRY_MS, QUIET_CHECK_MS, QUIET_NEEDED_MS, IDLE_NEEDED_SEC };
