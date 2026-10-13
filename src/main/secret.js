'use strict';
/* SecretStore: the Notion integration token, encrypted with Electron safeStorage (Windows DPAPI) in
   <userData>/secrets.json. The token is never written in clear, never logged, never read from a .env, and the
   renderer can only ask whether one is set. If encryption is unavailable the token is refused, not stored in clear. */
const fs = require('fs');
const path = require('path');

class SecretStore {
  constructor(file, safeStorage) { this.file = file; this.ss = safeStorage; }

  available() { try { return !!(this.ss && this.ss.isEncryptionAvailable()); } catch (_) { return false; } }
  _read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (_) { return {}; } }
  _write(o) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(o)); fs.renameSync(tmp, this.file);
  }

  has(name) { return typeof this._read()[name] === 'string'; }
  set(name, value) {
    const v = String(value || '').trim();
    if (!v) return this.clear(name);
    if (!this.available()) throw new Error('Secure storage is not available on this PC; the token was not saved.');
    const o = this._read(); o[name] = this.ss.encryptString(v).toString('base64'); this._write(o);
    return true;
  }
  /** the clear token, for the Authorization header only */
  get(name) {
    const b = this._read()[name];
    if (typeof b !== 'string' || !this.available()) return '';
    try { return this.ss.decryptString(Buffer.from(b, 'base64')); } catch (_) { return ''; }
  }
  clear(name) { const o = this._read(); delete o[name]; this._write(o); return true; }
}

module.exports = { SecretStore };
