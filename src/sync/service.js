'use strict';
/* Customization sync, opt-in. While settings.sync.enabled is false this file makes no network call and starts no timer: every
   path to the network goes through _client(), which refuses. Local files:
     sync-state.json       the last known customization per key with its time, the retry state, the conflict list (no tokens)
     sync-backups/*.json   a copy of the local customization, written before the first pull from a project or group
     secrets.json          "sync": URL, public key, install id and tokens, encrypted by SecretStore (never in settings.json)
   The state file doubles as the offline queue: an edit made while offline is stamped there and goes up on the next good cycle. */
const fs = require('fs');
const path = require('path');
const { SupabaseClient, checkPublicKey, checkUrl, normalizeCode, formatCode } = require('./client');
const A = require('./allowlist');
const { merge, sanitizeRemote, differs, same } = require('./merge');
const { normalize, DEFAULTS } = require('../main/settings');

const POLL_MS = 5 * 60 * 1000, DEBOUNCE_MS = 3000, START_MS = 5000, BUSY_RETRY_MS = 15000;
const LINK_POLL_MS = 20000, CODE_LIFE_MS = 10 * 60 * 1000, JOINED_POLL_FOR_MS = 2 * 60 * 1000;   // around linking the other PC's data is due soon
const BACKOFF_MS = [30000, 60000, 120000, 300000, 900000, 3600000];
const MAX_DOC_BYTES = 2097152;
const MAX_CONFLICTS = 50;
const SECRET = 'sync';

const defaultsFlat = A.flatten(normalize(JSON.parse(JSON.stringify(DEFAULTS))));
const fresh = () => ({ keys: {}, synced: {}, scope: '', backupScope: '', registered: '', scanned: false, lastSyncAt: 0, lastError: '', pulled: 0, pushed: 0, conflicts: [], backup: '', members: [] });

class SyncService {
  constructor({ dir, store, secrets, slang, version = '', log = () => {}, onApplied = () => {}, onStatus = () => {}, isBusy = () => false, fetchImpl, now = () => Date.now(), pollMs = POLL_MS, debounceMs = DEBOUNCE_MS }) {
    Object.assign(this, { dir, store, secrets, slang, version, log, onApplied, onStatus, isBusy, fetchImpl, now, pollMs, debounceMs });
    this.file = path.join(dir, 'sync-state.json');
    this.state = { ...fresh(), ...this._read() };
    this.fails = 0; this.nextRetryAt = 0; this.timer = null; this.poll = null; this.running = null; this.fastUntil = 0; this.waitForJoin = false; this.again = false; this.applying = false; this.notice = '';
  }

  _read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (_) { return {}; } }
  _save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.file);
  }
  _cred() {
    if (!this.secrets || !this.secrets.has(SECRET)) return null;
    try { return JSON.parse(this.secrets.get(SECRET)) || null; } catch (_) { return null; }
  }
  enabled() { return this.store.get().sync.enabled === true; }

  /** the ONE way to get a network client: null while sync is off or not set up */
  _client() {
    if (!this.enabled()) return null;
    const c = this._cred();
    if (!c || !c.url || !c.key) return null;
    if (this.client) return this.client;     // one client: two copies could refresh the same single-use token at once
    return this.client = new SupabaseClient({
      url: c.url, key: c.key, session: c.session || {}, ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      onSession: (s) => this.secrets.set(SECRET, JSON.stringify({ ...this._cred(), session: s })),
      onIdentityLost: () => { this.state.registered = ''; this.state.scope = ''; this.state.synced = {}; this.notice = 'The server no longer knew this install, so it got a new ID. Link it again if it was linked.'; },
    });
  }

  /* ---------- switching and setup ---------- */
  start() {
    if (!this.enabled() || !this._cred()) return;
    this._later(START_MS);
    if (!this.poll) { this.poll = setInterval(() => this.syncNow(), this.pollMs); this.poll.unref?.(); }
  }
  stop() {
    clearTimeout(this.timer); this.timer = null;
    clearInterval(this.poll); this.poll = null;
    this.fails = 0; this.nextRetryAt = 0; this.fastUntil = 0; this.waitForJoin = false;
  }
  _later(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.syncNow(); }, ms);
    this.timer.unref?.();
  }

  /** the user pasted a URL and key. Nothing is contacted here; a secret key is refused before anything is stored */
  configure({ url, key } = {}) {
    if (!this.secrets || !this.secrets.available()) return { ok: false, error: 'Secure storage is not available on this PC, so sync cannot store its keys.' };
    const u = checkUrl(url);
    if (u.error) return { ok: false, error: u.error };
    const old = this._cred();
    const keyErr = String(key ?? '').trim() || !old ? checkPublicKey(key) : '';
    if (keyErr) return { ok: false, error: keyErr };
    const sameProject = old && old.url === u.url;
    this.secrets.set(SECRET, JSON.stringify({ url: u.url, key: String(key ?? '').trim() || old.key, session: sameProject ? old.session || {} : {} }));
    this.client = null;
    if (!sameProject) {   // another project: another identity there
      Object.assign(this.state, { synced: {}, scope: '', backupScope: '', registered: '', members: [], lastError: '' });
      if (fs.existsSync(this.file)) this._save();
    }
    if (this.enabled()) this._later(0);
    this.onStatus();
    return { ok: true };
  }

  setEnabled(on) {
    if (on && !this._cred()) return { ok: false, error: 'Save the project URL and publishable key first.' };
    if (on && !this.secrets.available()) return { ok: false, error: 'Secure storage is not available on this PC.' };
    if (on) this._firstSeen = this._mtime();      // before this very write moves it
    this.store.set({ sync: { enabled: !!on } });
    if (on) { this._scan(); this._save(); this.start(); this._later(0); } else { this.stop(); this.state.lastError = ''; this._save(); }
    this.onStatus();
    return { ok: true };
  }

  /* ---------- local customization ---------- */
  _mine() { return this.slang && this.slang.mineTerms ? this.slang.mineTerms() : []; }
  _flat() { return A.flatten(this.store.get(), this._mine()); }
  _mtime() { try { return Math.floor(fs.statSync(path.join(this.dir, 'settings.json')).mtimeMs) || 1; } catch (_) { return 1; } }

  /** compare what is on this PC with the state: a changed key gets the current time, a deleted word or row a tombstone. Returns the number of changes */
  _scan() {
    const s = this.state, cur = this._flat(), now = this.now(), me = this._cred()?.session?.installId || '';
    let changed = 0;
    const firstT = s.scanned ? now : (this._firstSeen || this._mtime());
    for (const [k, v] of Object.entries(cur)) {
      const e = s.keys[k];
      if (!e) { s.keys[k] = { v, t: k in defaultsFlat && same(defaultsFlat[k], v) ? 0 : firstT, by: me }; changed++; } else if (!same(e.v, v)) { s.keys[k] = { v, t: now, by: me }; changed++; }
    }
    for (const [k, e] of Object.entries(s.keys)) {
      if (!(k in cur) && A.isDynamic(k) && e.v !== null) { s.keys[k] = { v: null, t: now, by: me }; changed++; }
    }
    s.scanned = true;
    return changed;
  }

  /** a setting or word changed on this PC */
  notifyLocalChange() {
    if (!this.enabled() || this.applying) return;
    if (this._scan()) this._save();
    if (this.nextRetryAt > this.now()) return;       // offline: it is stamped and queued; the retry will carry it
    this._later(this.debounceMs);
    this.onStatus();
  }

  /** put these values on this PC (a key with null = remove). Returns nothing; the caller rescans */
  _applyLocal(changes) {
    this.applying = true;
    try {
      const patch = A.settingsPatch(this.store.get(), changes);
      if (Object.keys(patch).length) this.store.set(patch);
      const w = A.wordChanges(changes);
      if ((w.upsert.length || w.remove.length) && this.slang && this.slang.applySyncedTerms) this.slang.applySyncedTerms(w);
    } finally { this.applying = false; }
    try { this.onApplied(); } catch (e) { this.log('error', 'sync apply hook failed'); }
  }

  _backup(scope) {
    const dir = path.join(this.dir, 'sync-backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `backup-${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify({ at: this.now(), version: this.version, scope, keys: this._flat() }, null, 1));
    this.state.backup = file;
  }

  /** put the last backup back. It counts as a new edit here, so it also wins on the linked installs */
  restoreBackup() {
    const file = this.state.backup;
    let b;
    try { b = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return { ok: false, error: 'No backup to restore.' }; }
    const keys = Object.fromEntries(Object.entries(b.keys || {}).filter(([k]) => A.isAllowedKey(k)));
    for (const k of Object.keys(this._flat())) if (A.isDynamic(k) && !(k in keys)) keys[k] = null;
    this._applyLocal(keys);
    this._scan(); this._save();
    if (this.enabled()) this._later(0);
    this.onStatus();
    return { ok: true };
  }

  /* ---------- the cycle ---------- */
  syncNow() {
    if (!this.enabled() || !this._cred()) return Promise.resolve(false);
    if (this.running) { this.again = true; return this.running; }
    this.running = this._cycle().finally(() => {
      this.running = null;
      if (this.again) { this.again = false; this._later(0); }
    });
    return this.running;
  }

  async _cycle() {
    const client = this._client();
    if (!client) return false;
    if (this.isBusy()) { this._later(BUSY_RETRY_MS); return false; }   // never in the middle of a dictation
    const t0 = this.now();
    try {
      await client.token();
      const out = await this._exchange(client);
      if (!out) { this._later(BUSY_RETRY_MS); return false; }
      Object.assign(this.state, { lastSyncAt: this.now(), lastError: '', pulled: out.pulled, pushed: out.pushed });
      this.fails = 0; this.nextRetryAt = 0;
      this._save();
      this.log('info', `sync ok keys=${Object.keys(this.state.keys).length} pulled=${out.pulled} pushed=${out.pushed} conflicts=${out.conflicts} ms=${this.now() - t0}`);
      if (this.waitForJoin && this.state.scope.startsWith('group:')) { this.waitForJoin = false; this.fastUntil = 0; }
      if (this.now() < this.fastUntil) this._later(LINK_POLL_MS);
      this.onStatus();
      return true;
    } catch (e) {
      const wait = BACKOFF_MS[Math.min(this.fails, BACKOFF_MS.length - 1)];
      this.fails++; this.nextRetryAt = this.now() + wait;
      this.state.lastError = String(e.message || 'Sync failed').slice(0, 200);
      this._save();
      this.log('error', `sync failed status=${e.status ?? 'none'} retry_ms=${wait}`);
      if (this.enabled()) this._later(wait);
      this.onStatus();
      return false;
    }
  }

  async _register(client) {
    const stamp = client.installId + '|' + this.version;
    if (this.state.registered === stamp) return;
    // name and machine stay empty on purpose: this PC's name is not customization
    await client.rest('POST', 'installs?on_conflict=id', { body: [{ id: client.installId, name: null, machine: null, version: ('parakeet-flow ' + this.version).slice(0, 40) }], prefer: 'resolution=merge-duplicates,return=minimal' });
    this.state.registered = stamp;
  }

  async _exchange(client) {
    const s = this.state, me = client.installId;
    for (const e of Object.values(s.keys)) if (!e.by) e.by = me;     // stamped before this install had its ID
    await this._register(client);
    const gm = await client.rest('GET', `group_members?select=group_id&install_id=eq.${encodeURIComponent(me)}`);
    const groupId = Array.isArray(gm) && gm[0] ? gm[0].group_id : '';
    const scope = groupId ? 'group:' + groupId : 'install:' + me;
    const owner = groupId ? { group_id: groupId } : { install_id: me };
    const filter = groupId ? `group_id=eq.${encodeURIComponent(groupId)}` : `install_id=eq.${encodeURIComponent(me)}`;
    let pulled = 0, pushed = 0, conflictCount = 0;

    for (let attempt = 0; attempt < 4; attempt++) {
      const rows = await client.rest('GET', `customization?select=id,doc,version&${filter}`);
      const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
      if (row && Number(row.doc?.schema) > 1) throw new Error('This project holds customization from a newer app version. Update this app to sync.');
      const remote = sanitizeRemote(row ? row.doc : null, this.now());
      if (s.scope !== scope) { s.scope = scope; s.synced = {}; }
      if (s.backupScope !== scope && Object.values(remote).some((e) => e.by !== me)) {    // before the first pull of another install's values in this project or group
        this._backup(scope);
        s.backupScope = scope;
      }
      this._scan();
      const m = merge({ local: s.keys, remote, synced: s.synced });
      if (Object.keys(m.toApply).length) {
        if (this.isBusy()) return null;
        this._applyLocal(Object.fromEntries(Object.entries(m.toApply).map(([k, e]) => [k, e.v])));
        pulled += Object.keys(m.toApply).length;
      }
      s.keys = m.merged;
      if (m.conflicts.length) {
        conflictCount += m.conflicts.length;
        s.conflicts = [...m.conflicts.map((c) => ({ ...c, at: this.now() })), ...s.conflicts].slice(0, MAX_CONFLICTS);
      }
      this._scan();             // a value this PC would not accept as it came is corrected here, and that correction goes up too
      this._save();

      const doc = A.buildPayload(s.keys);
      const uploaded = sanitizeRemote(doc, this.now());
      const stray = row && Object.keys(row.doc?.keys || {}).some((k) => !(k in remote));   // a key this app does not allow goes on the next upload
      if (!row || stray || differs(uploaded, remote)) {
        if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > MAX_DOC_BYTES) throw new Error('Your customization is larger than the 2 MB sync limit; nothing was uploaded.');
        const done = row
          ? await client.rest('PATCH', `customization?id=eq.${encodeURIComponent(row.id)}&version=eq.${encodeURIComponent(row.version)}`, { body: { doc }, prefer: 'return=representation' })
          : await client.rest('POST', 'customization', { body: { ...owner, doc }, prefer: 'return=representation' }).catch((e) => { if (e.status === 409) return []; throw e; });
        if (!Array.isArray(done) || !done.length) continue;     // somebody wrote first: fetch and merge again
        pushed = Object.keys(doc.keys).length;
      }
      s.synced = Object.fromEntries(Object.entries(s.keys).map(([k, e]) => [k, e.t]));
      const members = await client.rpc('list_group');
      s.members = Array.isArray(members) ? members.slice(0, 50).map((x) => ({ id: String(x.install_id), version: String(x.version || ''), isMe: !!x.is_me, joinedAt: x.joined_at || null })) : [];
      return { pulled, pushed, conflicts: conflictCount };
    }
    throw new Error('Another install kept writing at the same time; will try again.');
  }

  /* ---------- linking ---------- */
  async createCode() {
    const c = this._client();
    if (!c) return { ok: false, error: 'Switch sync on first.' };
    try {
      await this._register(c); this._save();
      const v = await c.rpc('create_link_code');
      const row = Array.isArray(v) ? v[0] : v;
      if (!row || !row.code) return { ok: false, error: 'The server sent no code.' };
      this.waitForJoin = !this.state.scope.startsWith('group:');
      if (this.waitForJoin) { this.fastUntil = this.now() + CODE_LIFE_MS; this._later(LINK_POLL_MS); }
      return { ok: true, code: formatCode(row.code), expiresAt: row.expires_at };
    } catch (e) { return { ok: false, error: String(e.message).slice(0, 200) }; }
  }
  async join(raw) {
    const code = normalizeCode(raw);
    if (!code) return { ok: false, error: 'A link code is 6 letters and digits, like ABC-234.' };
    const c = this._client();
    if (!c) return { ok: false, error: 'Switch sync on first.' };
    try {
      await this._register(c); this._save();
      const v = await c.rpc('join_with_code', { raw_code: code });
      if (!v || v.ok !== true) return { ok: false, error: String((v && v.error) || 'Could not join.').slice(0, 200) };
      this.fastUntil = this.now() + JOINED_POLL_FOR_MS;
      await this.syncNow();
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e.message).slice(0, 200) }; }
  }
  async unlink() {
    const c = this._client();
    if (!c) return { ok: false, error: 'Switch sync on first.' };
    try {
      await c.rpc('leave_group');
      await this.syncNow();     // keeps every local value; this install goes on with its own row
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e.message).slice(0, 200) }; }
  }

  /** what the Sync section shows. No network, no secret: the key itself and the tokens never go to a page */
  status() {
    const c = this._cred(), s = this.state;
    return {
      enabled: this.enabled(), configured: !!(c && c.url && c.key), encryption: !!(this.secrets && this.secrets.available()),
      url: c ? c.url : '', installId: c?.session?.installId || '',
      linked: s.scope.startsWith('group:'), members: s.members,
      lastSyncAt: s.lastSyncAt, lastError: s.lastError, nextRetryAt: this.nextRetryAt, pulled: s.pulled, pushed: s.pushed,
      waiting: Object.entries(s.keys).filter(([k, e]) => e.t !== s.synced[k] && e.t > 0).length,
      conflicts: s.conflicts.slice(0, 5).map((x) => ({ label: A.keyLabel(x.key), kept: x.kept, lost: JSON.stringify(x.lost ?? null).slice(0, 120), at: x.at })),
      backup: s.backup, notice: this.notice,
    };
  }
}

module.exports = { SyncService, SECRET };
