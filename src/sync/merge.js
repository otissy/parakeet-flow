'use strict';
/* The conflict rule: per key, last write wins by timestamp. An entry is {v, t, by}: value (null = deleted), time in ms, install id.
   t = 0 means "still the default": never a customization, so it never counts as a conflict and any real edit beats it.
   Equal times are settled by the install id, so both sides always pick the same winner. Pure code. */
const { isAllowedKey, TERM_FIELDS } = require('./allowlist');

const FUTURE_MS = 5 * 60 * 1000;

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}
/** equal as data: the database hands objects back with their keys in another order */
const same = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

/** a document from the server -> entries this app accepts: allowlisted keys only, a sane time (a PC with a wrong clock cannot win forever) */
function sanitizeRemote(doc, now = Date.now()) {
  const out = {};
  const keys = doc && typeof doc === 'object' && doc.schema === 1 && doc.keys && typeof doc.keys === 'object' ? doc.keys : {};
  for (const [k, e] of Object.entries(keys)) {
    if (!isAllowedKey(k) || !e || typeof e !== 'object' || !('v' in e)) continue;
    const t = Number(e.t);
    if (!Number.isFinite(t) || t < 0) continue;
    let v = e.v;
    if (k.startsWith('word:') && v !== null) {
      if (typeof v !== 'object') continue;
      v = Object.fromEntries(TERM_FIELDS.filter((f) => v[f] !== undefined).map((f) => [f, v[f]]));
    }
    out[k] = { v, t: t > now + FUTURE_MS ? now : t, by: String(e.by || '').slice(0, 40) };
  }
  return out;
}

const remoteWins = (l, r) => (r.t !== l.t ? r.t > l.t : r.by >= l.by);

/** local, remote: {key: entry}; synced: {key: t} as last agreed with the server.
    Returns merged (the new local state), toApply (keys whose VALUE changes on this PC), conflicts (both sides really changed it). */
function merge({ local = {}, remote = {}, synced = {} }) {
  const merged = {}, toApply = {}, conflicts = [];
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[k], r = remote[k];
    if (!r) { merged[k] = l; continue; }
    if (!l) { merged[k] = r; toApply[k] = r; continue; }
    if (same(l.v, r.v)) { merged[k] = remoteWins(l, r) ? r : l; continue; }
    const win = remoteWins(l, r);
    merged[k] = win ? r : l;
    if (win) toApply[k] = r;
    const localChanged = l.t > 0 && l.t !== synced[k], remoteChanged = r.t > 0 && r.t !== synced[k];
    if (localChanged && remoteChanged) conflicts.push({ key: k, kept: win ? 'other' : 'this', lost: win ? l.v : r.v, keptValue: win ? r.v : l.v, keptAt: Math.max(l.t, r.t) });
  }
  return { merged, toApply, conflicts };
}

/** does the server need a new document? (the merged state differs from what it has) */
function differs(merged, remote) {
  const a = Object.keys(merged), b = Object.keys(remote);
  if (a.length !== b.length) return true;
  return a.some((k) => !remote[k] || remote[k].t !== merged[k].t || remote[k].by !== merged[k].by || !same(remote[k].v, merged[k].v));
}

module.exports = { merge, sanitizeRemote, differs, same, FUTURE_MS };
