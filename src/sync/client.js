'use strict';
/* Small Supabase client for customization sync: anonymous sign-in (the Supabase user id IS this install's id), token refresh,
   PostgREST calls. Same design as parakeet-check. Only a public key is ever accepted; Row Level Security decides what it can
   reach. Tokens stay in memory and in the encrypted secret store (service.js); they are never logged or put in an error text. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L
const CODE_LEN = 6;
const REFRESH_SKEW_S = 60;
const IDENTITY_GONE = new Set(['refresh_token_not_found', 'user_not_found']);

/** '' when fine, else why not. A sb_secret_ key or a service_role JWT bypasses Row Level Security and must never be stored on a PC */
function checkPublicKey(raw) {
  const key = String(raw ?? '').trim();
  if (!key) return 'Paste the publishable key.';
  if (key.startsWith('sb_secret_')) return 'That is a SECRET key (sb_secret_...). Use the publishable key (sb_publishable_...) instead.';
  if (key.startsWith('sb_publishable_')) return '';
  const parts = key.split('.');
  if (parts.length === 3) {
    let role;
    try { role = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role; } catch (_) { return 'That key looks like a token but cannot be read.'; }
    if (role === 'anon') return '';
    if (role === 'service_role') return 'That is the SERVICE ROLE key. Use the publishable (or legacy anon) key instead.';
    return 'That key has an unexpected role. Use the publishable (or legacy anon) key.';
  }
  return 'Not a recognised key. Use the project\'s publishable key (sb_publishable_...) or legacy anon key.';
}

/** the project URL's origin, or {error}. https only, except a local dev server on this PC */
function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw ?? '').trim()); } catch (_) { return { error: 'That is not a URL. It looks like https://<ref>.supabase.co' }; }
  const local = u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) return { error: 'The project URL must start with https://' };
  if (u.username || u.password) return { error: 'The project URL must not hold a user name or password.' };
  return { url: u.origin };
}

/** "abc-234", " ABC 234 " -> "ABC234"; '' when it cannot be a code */
function normalizeCode(raw) {
  const c = String(raw ?? '').replace(/[\s-]/g, '').toUpperCase();
  return c.length === CODE_LEN && [...c].every((x) => CODE_ALPHABET.includes(x)) ? c : '';
}
const formatCode = (c) => (c.length > 3 ? c.slice(0, 3) + '-' + c.slice(3) : c);

class SyncHttpError extends Error {
  constructor(message, { status = 0, code = '' } = {}) { super(message); this.name = 'SyncHttpError'; this.status = status; this.code = code; }
}

/** the words of the link-code functions (supabase/migrations/0001_install_links.sql) as sentences; anything else gets a capital and a full stop */
const SERVER_WORDS = {
  'invalid, used or expired code': 'That code is invalid, used or expired. Create a new code on the other PC.',
  'too many wrong codes, wait 10 minutes': 'Too many wrong codes. Wait 10 minutes and try again.',
  "that is this install's own code: join it from another install": "That is this install's own code. Enter it on the other PC.",
  'install not registered': 'This install is not registered yet. Press Sync now, then try again.',
};
function serverWords(raw) {
  const t = String(raw ?? '').trim();
  if (SERVER_WORDS[t]) return SERVER_WORDS[t];
  if (!t) return 'Could not join.';
  return t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.');
}

/** what a person reads for a failure. Status and code stay on the error for the log. Errors written for people pass through */
function syncErrorText(e) {
  const msg = String((e && e.message) || 'Sync failed.');
  if (!(e instanceof SyncHttpError) || !e.status) return msg;
  const s = e.status;
  if (/anonymous|signups/i.test(msg)) return 'Anonymous sign-ins are off in this Supabase project. Turn them on in its Authentication settings.';
  if (s === 401) return `The server refused this install's sign-in. Check the publishable key (error ${s}).`;
  if (s === 403) return `The server refused this request. Check the project's setup in docs/sync-setup.md (error ${s}).`;
  if (s === 404) return `This project has no sync tables yet. Run the setup in docs/sync-setup.md (error ${s}).`;
  if (s === 408 || s === 429) return `The server is busy (error ${s}).`;
  if (s >= 500) return `The server had a problem (error ${s}).`;
  return `The server refused the request (error ${s}).`;
}

class SupabaseClient {
  /** session: {installId, access, refresh, expiresAt}; onSession(session): save it (called before the new tokens are used) */
  constructor({ url, key, session = {}, onSession = () => {}, onIdentityLost = () => {}, fetchImpl = (...a) => fetch(...a), timeoutMs = 15000, nowS = () => Math.floor(Date.now() / 1000) }) {
    Object.assign(this, { url, key, session: { ...session }, onSession, onIdentityLost, fetchImpl, timeoutMs, nowS });
  }

  get installId() { return this.session.installId || ''; }

  async _http(method, path, { headers = {}, body } = {}) {
    let res;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      res = await this.fetchImpl(this.url + path, { method, signal: ctl.signal, headers: { apikey: this.key, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      let data = null;
      if (text.trim()) { try { data = JSON.parse(text); } catch (_) { data = null; } }
      if (!res.ok) {
        const msg = data && (data.msg || data.message || data.error_description || data.error);
        throw new SyncHttpError(`The server answered ${res.status}${msg ? ': ' + String(msg).slice(0, 160) : ''}`, { status: res.status, code: String((data && (data.error_code || data.code)) || '') });
      }
      return data;
    } catch (e) {
      if (e instanceof SyncHttpError) throw e;
      throw new SyncHttpError('Could not reach the server.', { status: 0, code: 'network' });
    } finally { clearTimeout(timer); }
  }

  _apply(a) {
    if (!a || !a.access_token || !a.refresh_token || !a.user || !a.user.id) throw new SyncHttpError('Unexpected answer from sign-in.');
    this.session = { installId: a.user.id, access: a.access_token, refresh: a.refresh_token, expiresAt: a.expires_at || this.nowS() + (a.expires_in || 3600) };
    this.onSession(this.session);
  }

  async signIn() {
    try { this._apply(await this._http('POST', '/auth/v1/signup', { body: { data: {} } })); } catch (e) {
      if (e.status && /anonymous|signups/i.test(e.message)) throw new SyncHttpError(e.message + ' (Anonymous sign-ins must be on in the Supabase project.)', e);
      throw e;
    }
  }

  token() {
    if (!this.pending) this.pending = this._token().finally(() => { this.pending = null; });
    return this.pending;
  }

  async _token() {
    const s = this.session;
    if (!s.refresh) { await this.signIn(); return this.session.access; }
    if (!s.access || this.nowS() + REFRESH_SKEW_S >= (s.expiresAt || 0)) {
      try { this._apply(await this._http('POST', '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: s.refresh } })); } catch (e) {
        // the server no longer knows this identity (its user was deleted): a new one. A network failure or a busy token never lands here
        if (!IDENTITY_GONE.has(e.code)) throw e;
        this.session = {};
        this.onIdentityLost();
        await this.signIn();
      }
    }
    return this.session.access;
  }

  async rest(method, path, { body, prefer } = {}) {
    const token = await this.token();
    return this._http(method, '/rest/v1/' + path, { body, headers: { Authorization: 'Bearer ' + token, ...(prefer ? { Prefer: prefer } : {}) } });
  }
  rpc(name, args = {}) { return this.rest('POST', 'rpc/' + name, { body: args }); }
}

module.exports = { SupabaseClient, SyncHttpError, serverWords, syncErrorText, checkPublicKey, checkUrl, normalizeCode, formatCode, CODE_ALPHABET, CODE_LEN };
