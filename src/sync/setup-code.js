'use strict';
/* The one-string "Sync code": project URL + publishable key + a fresh link code + when that link code stops working.
   It is NOT encrypted (the publishable key is public by design and the link code is one-use, 10 minutes); the check characters
   only catch typos and edits. A secret / service-role key is refused on both ends: never put one in here, never accept one. */
const crypto = require('crypto');
const { checkPublicKey, checkUrl, normalizeCode } = require('./client');

const PREFIX = 'PFS1-';
const MAX_LEN = 1500;
const sum = (s) => crypto.createHash('sha256').update(s).digest('base64url').slice(0, 6);

/** {url, key, code, expiresAt (ms)} -> 'PFS1-...' ; {error} when it must not be made (a secret key, a bad URL, a bad code) */
function encode({ url, key, code, expiresAt }) {
  const u = checkUrl(url);
  if (u.error) return { error: u.error };
  const k = String(key ?? '').trim(), keyErr = checkPublicKey(k);
  if (keyErr) return { error: keyErr };
  const c = normalizeCode(code);
  if (!c) return { error: 'The link code is not valid.' };
  if (!Number.isFinite(expiresAt)) return { error: 'The link code has no expiry.' };
  const body = Buffer.from(JSON.stringify({ u: u.url, k, c, e: Math.floor(expiresAt / 1000) }), 'utf8').toString('base64url');
  return { code: PREFIX + body + '.' + sum(body) };
}

/** a pasted string -> {url, key, code, expiresAt} or {error, expired?}. Nothing is contacted */
function decode(raw, now = Date.now()) {
  const bad = 'That is not a Sync code. Copy the whole code from Settings > Sync on the other PC.';
  const t = String(raw ?? '').replace(/\s+/g, '').replace(/^["'<`]+|["'>`]+$/g, '');
  if (!t) return { error: 'Paste the Sync code from the other PC.' };
  if (t.length > MAX_LEN || !t.startsWith(PREFIX)) return { error: bad };
  const [body, check, ...extra] = t.slice(PREFIX.length).split('.');
  if (!body || !check || extra.length || !/^[A-Za-z0-9_-]+$/.test(body)) return { error: bad };
  if (check !== sum(body)) return { error: 'This Sync code is damaged or was edited. Copy it again from the other PC.' };
  let o;
  try { o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (_) { return { error: bad }; }
  if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.u !== 'string' || typeof o.k !== 'string' || typeof o.c !== 'string' || !Number.isFinite(o.e)) return { error: bad };
  const u = checkUrl(o.u);
  if (u.error || u.url !== o.u) return { error: bad };
  const keyErr = checkPublicKey(o.k);
  if (keyErr) return { error: 'This Sync code holds a key that must not be shared, so it was refused. ' + keyErr };
  const code = normalizeCode(o.c);
  if (!code) return { error: bad };
  const expiresAt = o.e * 1000;
  if (expiresAt <= now) return { error: 'This Sync code has expired (they last 10 minutes). Create a new one on the other PC.', expired: true };
  return { url: u.url, key: o.k.trim(), code, expiresAt };
}

module.exports = { encode, decode, PREFIX };
