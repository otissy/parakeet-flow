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
  constructor({ binDir, test = false }) {
    super();
    this.exe = buildHelper(binDir);
    this.fg = null; this.nextId = 1; this.buf = '';
    this.proc = spawn(this.exe, test ? ['--test'] : [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    this.ready = new Promise((res) => { this._ready = res; });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => this._data(d));
    this.proc.on('exit', () => this.emit('exit'));
    this.proc.stdin.on('error', () => {});
  }
  _data(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, ''); this.buf = this.buf.slice(i + 1);
      const a = line.split(' ');
      if (a[0] === 'READY') this._ready();
      else if (a[0] === 'KEY') this.emit('key', { down: a[1] === 'down', at: Date.now() });
      else if (a[0] === 'TOGGLE') this.emit('toggle', { at: Date.now() });
      else if (a[0] === 'ESC') this.emit('esc');
      else if (a[0] === 'FG') {
        this.fg = { hwnd: Number(a[1]), pid: Number(a[2]), proc: (a[3] || '').toLowerCase() + '.exe',
                    title: a[4] ? Buffer.from(a[4], 'base64').toString('utf8') : '' };
        this.emit('foreground', this.fg);
      } else if (a[0] === 'REFUSED') this.emit('refused', { id: a[1] });
      else if (a[0] === 'SENT' || a[0] === 'SIM' || a[0] === 'DUMP') this.emit('line', a);   // test-mode replies
    }
  }
  _send(s) { if (this.proc.stdin.writable) this.proc.stdin.write(s + '\n'); }
  setHotkey(vks) { this._send('HOTKEY ' + vks.join('+')); }
  /** swallow the chord's non-modifier key (Ctrl+Space) while its modifiers are held; never for a lone-key hotkey */
  setClaim(on) { this._send('CLAIM ' + (on ? 1 : 0)); }
  /** the toggle key (CapsLock = 0x14): one 'toggle' event per fresh press. CapsLock is swallowed (down, repeat, up) so Windows never flips it; 0 = off, key back to normal */
  setToggleKey(vk) { this._send('TOGGLE ' + (vk | 0)); }
  /** tests only (helper started with test:true): inject a key event; with hwnd it is refused unless that window is foreground */
  press(vk, down, hwnd) { this._send(`PRESS ${vk} ${down ? 'down' : 'up'}${hwnd ? ' ' + hwnd : ''}`); }
  /** tests only: raw helper command (SIM, CAPTURE, SIMMID, NORELEASE, DUMP) */
  raw(line) { this._send(line); }
  queryForeground() { this._send('FG'); }
  foreground() { return this.fg; }
  type(text, { hwnd } = {}) {
    if (!text) return true;
    this._send(`TYPE ${this.nextId++} ${hwnd || 0} ${Buffer.from(text, 'utf16le').toString('base64')}`);
    return true;
  }
  backspace(n, { hwnd } = {}) {
    if (!(n > 0)) return true;
    this._send(`BS ${this.nextId++} ${hwnd || 0} ${n}`);
    return true;
  }
  close() { try { this._send('QUIT'); this.proc.kill(); } catch (_) { /* gone */ } }
}

module.exports = { Win32Typer, buildHelper, compileHelper, sourceHash, BUNDLED };
