'use strict';
/* Win32Typer: talks to the persistent pf-helper process (see helper/PfHelper.cs).
   Same Typer interface as MemoryTyper, plus events: 'key' {down}, 'esc', 'foreground' {...},
   'refused' {id}, 'exit'. The exe is compiled from our own source on first use with the
   .NET Framework csc that ships with Windows, into <binDir>, and rebuilt when the source changes. */
const { spawn, spawnSync } = require('child_process');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { newlineMode, isConsoleTerminal } = require('./newline');

const HELPER_DIR = path.join(__dirname, 'helper');
const SRC = path.join(HELPER_DIR, 'PfHelper.cs');
// everything the exe is built from; the stamp is the hash of all of them, in this order
const INPUTS = ['PfHelper.cs', 'AssemblyInfo.cs', 'pf-helper.manifest'].map((f) => path.join(HELPER_DIR, f));
const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.ico');
// built once at packaging time (scripts/build-installer.js) and shipped inside the installer
const BUNDLED = path.join(HELPER_DIR, 'bin', 'pf-helper.exe');
const CSC = path.join(process.env.WINDIR || 'C:\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
/** SHA-256 over the helper's source files (PfHelper.cs, AssemblyInfo.cs, pf-helper.manifest) */
function sourceHash() { return sha(Buffer.concat(INPUTS.map((f) => fs.readFileSync(f)))); }

/** compile pf-helper.exe from our own source with the csc that ships with Windows; version info, manifest and icon included */
function compileHelper(exe) {
  if (!fs.existsSync(CSC)) throw new Error('csc.exe not found: ' + CSC);
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  const args = ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/win32manifest:' + INPUTS[2], ...(fs.existsSync(ICON) ? ['/win32icon:' + ICON] : []), `/out:${exe}`, INPUTS[0], INPUTS[1]];
  const r = spawnSync(CSC, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('helper build failed: ' + (r.stdout || '') + (r.stderr || ''));
  fs.writeFileSync(exe + '.src-sha256', sourceHash());
  return exe;
}

/** the helper to run: the one shipped with the app when it matches the source, else one compiled into binDir (dev) */
function buildHelper(binDir) {
  const want = sourceHash();
  const ok = (exe) => fs.existsSync(exe) && fs.existsSync(exe + '.src-sha256') && fs.readFileSync(exe + '.src-sha256', 'utf8') === want;
  if (ok(BUNDLED)) return BUNDLED;
  fs.mkdirSync(binDir, { recursive: true });
  const exe = path.join(binDir, 'pf-helper.exe');
  return ok(exe) ? exe : compileHelper(exe);
}

class Win32Typer extends EventEmitter {
  /* restart: when the helper dies by itself (not through close()), start a new one and give it back the
     hotkeys, so a crashed helper never leaves dictation without its keybind. On by default for the real
     app, off for the test-mode helper. Gives up after 8 quick deaths in a minute ('giveup'). */
  constructor({ binDir, test = false, restart = !test, restartDelayMs = 400 }) {
    super();
    this.exe = buildHelper(binDir);
    this.test = test; this.restart = restart; this.restartDelayMs = restartDelayMs;
    this.fg = null; this.nextId = 1; this.buf = ''; this.newline = 'auto'; this.pasting = new Map();
    this.cfg = {}; this.closed = false; this.deaths = []; this.restarts = 0; this.timer = null;
    this._spawn();
  }
  _spawn() {
    this.buf = '';
    const proc = spawn(this.exe, this.test ? ['--test'] : [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    this.proc = proc;
    this.ready = new Promise((res) => { this._ready = res; });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => { if (proc === this.proc) this._data(d); });
    proc.on('exit', () => {
      if (proc !== this.proc) return;                    // an old helper that was already replaced
      this.emit('exit');
      if (!this.closed && this.restart) this._scheduleRestart();
    });
    proc.stdin.on('error', () => {});
  }
  _scheduleRestart() {
    const now = Date.now();
    this.deaths = this.deaths.filter((t) => now - t < 60000); this.deaths.push(now);
    if (this.deaths.length > 8) { this.emit('giveup'); return; }
    const delay = Math.min(15000, this.restartDelayMs * 2 ** (this.deaths.length - 1));
    this.timer = setTimeout(() => { this.timer = null; if (!this.closed) { this.restarts++; this._spawn(); } }, delay);
    if (this.timer.unref) this.timer.unref();
  }
  /** after a restart: put the keybinds back as they were */
  _replay() {
    const c = this.cfg;
    if (c.hotkey) this._send('HOTKEY ' + c.hotkey.join('+'));
    if (c.hotkey2) this._send('HOTKEY2 ' + c.hotkey2.join('+'));
    if (c.claim !== undefined) this._send('CLAIM ' + (c.claim ? 1 : 0));
    if (c.toggle !== undefined) this._send('TOGGLE ' + (c.toggle | 0));
    this._send('FG');
  }
  _data(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, ''); this.buf = this.buf.slice(i + 1);
      const a = line.split(' ');
      if (a[0] === 'READY') { this._ready(); if (this.restarts) { this._replay(); this.emit('restarted'); } }
      else if (a[0] === 'KEY') this.emit('key', { down: a[1] === 'down', at: Date.now() });
      else if (a[0] === 'TOGGLE') this.emit('toggle', { at: Date.now() });
      else if (a[0] === 'KEY2') this.emit('key2', { down: a[1] === 'down', at: Date.now() });
      else if (a[0] === 'ESC') this.emit('esc');
      else if (a[0] === 'FG') {
        this.fg = { hwnd: Number(a[1]), pid: Number(a[2]), proc: (a[3] || '').toLowerCase() + '.exe',
                    title: a[4] ? Buffer.from(a[4], 'base64').toString('utf8') : '', cls: a[5] || '' };
        this.emit('foreground', this.fg);
      } else if (a[0] === 'REFUSED') { this.pasting.delete(a[1]); this.emit('refused', { id: a[1] }); }
      else if (a[0] === 'PASTEFALLBACK') { const t = this.pasting.get(a[1]); this.pasting.delete(a[1]); this.emit('paste-fallback', { id: a[1] }); if (t) this.type(t.text, t.opts); }
      else if (a[0] === 'CLIP') this.emit('line', a);
      else if (a[0] === 'SENT' || a[0] === 'SIM' || a[0] === 'DUMP') this.emit('line', a);   // test-mode replies
    }
  }
  _send(s) { if (this.proc.stdin.writable) this.proc.stdin.write(s + '\n'); }
  setHotkey(vks) { this.cfg.hotkey = vks.slice(); this._send('HOTKEY ' + vks.join('+')); }
  /** the second chord (note mode): modifiers + exactly one plain key; an empty list switches it off */
  setHotkey2(vks) { this.cfg.hotkey2 = (vks || []).slice(); this._send('HOTKEY2 ' + (vks || []).join('+')); }
  /** 'auto' | 'shift-enter' | 'ctrl-j': which key a newline in typed text presses (see newline.js) */
  setNewline(mode) { this.newline = ['shift-enter', 'ctrl-j'].includes(mode) ? mode : 'auto'; }
  /** swallow the chord's non-modifier key (Ctrl+Space) while its modifiers are held; never for a lone-key hotkey */
  setClaim(on) { this.cfg.claim = !!on; this._send('CLAIM ' + (on ? 1 : 0)); }
  /** the toggle key (CapsLock = 0x14): one 'toggle' event per fresh press. CapsLock is swallowed (down, repeat, up) so Windows never flips it; 0 = off, key back to normal */
  setToggleKey(vk) { this.cfg.toggle = vk | 0; this._send('TOGGLE ' + (vk | 0)); }
  /** tests only (helper started with test:true): inject a key event; with hwnd it is refused unless that window is foreground */
  press(vk, down, hwnd) { this._send(`PRESS ${vk} ${down ? 'down' : 'up'}${hwnd ? ' ' + hwnd : ''}`); }
  /** tests only: raw helper command (SIM, CAPTURE, SIMMID, NORELEASE, DUMP) */
  raw(line) { this._send(line); }
  queryForeground() { this._send('FG'); }
  foreground() { return this.fg; }
  type(text, { hwnd } = {}) {
    if (!text) return true;
    const nl = ' ' + newlineMode(this.fg, this.newline);
    const paced = isConsoleTerminal(this.fg) || /^code/.test(String((this.fg && this.fg.proc) || '').toLowerCase()) ? ' p' : '';
    this._send(`TYPE ${this.nextId++} ${hwnd || 0} ${Buffer.from(text, 'utf16le').toString('base64')}${nl}${paced}`);
    return true;
  }
  backspace(n, { hwnd } = {}) {
    if (!(n > 0)) return true;
    this._send(`BS ${this.nextId++} ${hwnd || 0} ${n}`);
    return true;
  }
  /** insert text as ONE clipboard paste (the old clipboard is put back; src/typer/helper/PfHelper.cs PASTE). If the clipboard cannot be restored
      exactly the helper pastes nothing and says so, and the text is typed instead (burst). */
  paste(text, { hwnd, delayMs = 220, key = 'v' } = {}) {
    if (!text) return true;
    const id = String(this.nextId++);
    this.pasting.set(id, { text, opts: { hwnd } });
    this._send(`PASTE ${id} ${hwnd || 0} ${Buffer.from(text, 'utf16le').toString('base64')} ${delayMs} ${key === 'insert' ? 'i' : 'v'}`);
    setTimeout(() => this.pasting.delete(id), 10000).unref();       // never keep dictated text around
    return true;
  }
  /** the one entry point for "put this finished text into the window": method 'paste' | 'burst' */
  insert(text, { hwnd, method = 'burst' } = {}) { return method === 'paste' || method === 'paste-insert' ? this.paste(text, { hwnd, key: method === 'paste-insert' ? 'insert' : 'v' }) : this.type(text, { hwnd }); }
  /** one Enter press (only for the opt-in "press Enter after I finish"); refused unless <hwnd> is the foreground window */
  enter({ hwnd } = {}) { this._send(`ENTER ${this.nextId++} ${hwnd || 0}`); return true; }
  close() { this.closed = true; if (this.timer) { clearTimeout(this.timer); this.timer = null; } try { this._send('QUIT'); this.proc.kill(); } catch (_) { /* gone */ } }
}

module.exports = { Win32Typer, buildHelper, compileHelper, sourceHash, BUNDLED };
