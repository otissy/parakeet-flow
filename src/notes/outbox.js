'use strict';
/* Notes outbox: one JSON line per note in <userData>/notes.jsonl, written locally first. Sync state lives on the line:
     {id, ts, text, sync:'local'|'pending'|'synced'|'failed', attempts, nextAt, error?, pageId?, syncedAt?}
   'local'   saved, Notion sync was off at the time (Resend pushes it once sync is configured)
   'pending' waiting for its turn; 'failed' retried with backoff (nextAt); 'synced' done.
   New notes are appended; state changes rewrite the (small) file atomically. Single process, so no locking. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_TEXT = 20000;
const BACKOFF_BASE_MS = 30 * 1000, BACKOFF_MAX_MS = 60 * 60 * 1000;
/** 30 s, 1 min, 2 min, 4 min ... capped at 1 h. attempts counts the failures so far (>=1). */
const backoffMs = (attempts) => Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));

class Outbox {
  constructor(file, { now = Date.now, genId = () => crypto.randomBytes(8).toString('hex') } = {}) {
    Object.assign(this, { file, now, genId });
    this.notes = this._read();
  }

  _read() {
    let raw = '';
    try { raw = fs.readFileSync(this.file, 'utf8'); } catch (_) { return []; }
    const out = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { const n = JSON.parse(line); if (n && n.id && typeof n.text === 'string') out.push(n); } catch (_) { /* a torn last line must not lose the rest */ }
    }
    return out;
  }
  _rewrite() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, this.notes.map((n) => JSON.stringify(n)).join('\n') + (this.notes.length ? '\n' : ''));
    fs.renameSync(tmp, this.file);
  }

  /** @returns the saved note, or null for empty text */
  add(text, { sync = 'local' } = {}) {
    const t = String(text || '').normalize('NFC').trim().slice(0, MAX_TEXT);
    if (!t) return null;
    const n = { id: this.genId(), ts: this.now(), text: t, sync: sync === 'pending' ? 'pending' : 'local', attempts: 0, nextAt: 0 };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(n) + '\n');
    this.notes.push(n);
    return n;
  }

  get(id) { return this.notes.find((n) => n.id === id) || null; }
  /** newest first */
  list() { return this.notes.slice().sort((a, b) => b.ts - a.ts); }
  counts() { const c = { local: 0, pending: 0, failed: 0, synced: 0 }; for (const n of this.notes) c[n.sync] = (c[n.sync] || 0) + 1; return c; }

  /** pending or failed notes whose time has come */
  due(at = this.now()) { return this.notes.filter((n) => (n.sync === 'pending' || n.sync === 'failed') && (n.nextAt || 0) <= at).sort((a, b) => a.ts - b.ts); }

  markSynced(id, pageId) {
    const n = this.get(id); if (!n) return null;
    Object.assign(n, { sync: 'synced', syncedAt: this.now(), pageId: pageId || n.pageId, nextAt: 0 }); delete n.error;
    this._rewrite(); return n;
  }
  /** schedule the retry: backoff by attempts, or at least `retryAfterMs` (HTTP 429) */
  markFailed(id, error, { retryAfterMs = 0 } = {}) {
    const n = this.get(id); if (!n) return null;
    n.attempts = (n.attempts || 0) + 1;
    n.sync = 'failed'; n.error = String(error || 'failed').slice(0, 200);
    n.nextAt = this.now() + Math.max(backoffMs(n.attempts), retryAfterMs || 0);
    this._rewrite(); return n;
  }
  /** user pressed Resend: try again right now, restart the backoff */
  resend(id) {
    const n = this.get(id); if (!n) return null;
    Object.assign(n, { sync: 'pending', attempts: 0, nextAt: 0 }); delete n.error;
    this._rewrite(); return n;
  }
  remove(id) {
    const i = this.notes.findIndex((n) => n.id === id); if (i < 0) return false;
    this.notes.splice(i, 1); this._rewrite(); return true;
  }
}

module.exports = { Outbox, backoffMs, MAX_TEXT };
