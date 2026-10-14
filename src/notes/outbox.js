'use strict';
/* Notes outbox: one JSON line per note in <userData>/notes.jsonl, written locally first. Sync state lives on the line:
     {id, ts, text, tags[], source, sync:'local'|'pending'|'synced'|'failed', attempts, nextAt, error?, pageId?,
      syncedAt?, destination?, url?, md?}
   'local'   saved, Notion sync was off at the time (Resend pushes it once sync is configured)
   'pending' waiting for its turn; 'failed' retried with backoff (nextAt); 'synced' done (by the app's own Notion sync,
             or by an MCP client through note_mark_synced, which also records destination and url).
   MORE THAN ONE PROCESS writes this file: the app and the MCP server (mcp/server.js, which requires this very module so the
   format cannot drift). So nothing is kept in memory as truth:
   - every change takes a lock file (<file>.lock, created with O_EXCL; a lock older than 15 s is a crashed holder and is
     stolen), RE-READS the file, applies the change to that fresh copy and writes it;
   - a new note is one appended line (a torn last line left by a crash is closed with a newline first, never glued to);
     any other change rewrites the file through a unique temp file and a rename (retried on EPERM/EBUSY: Windows);
   - reads take no lock; a half-written last line is skipped (JSON.parse fails), so a reader never throws or sees a torn note.
   Dictated text never goes anywhere but this file; nothing here logs it. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_TEXT = 20000;
const MAX_TAGS = 10, MAX_TAG = 40;
const BACKOFF_BASE_MS = 30 * 1000, BACKOFF_MAX_MS = 60 * 60 * 1000;
const LOCK_STALE_MS = 15000, LOCK_WAIT_MS = 8000;
/** 30 s, 1 min, 2 min, 4 min ... capped at 1 h. attempts counts the failures so far (>=1). */
const backoffMs = (attempts) => Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));

const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) { const t = Date.now() + ms; while (Date.now() < t) { /* spin */ } } };

/** text of a note: NFC, no NUL or other control characters except newline and tab, trimmed, capped */
function cleanText(text) {
  return String(text ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, MAX_TEXT);
}
/** tags: at most 10, each 1-40 chars of letters, digits, space, - _ / . # ; lower-cased, de-duplicated */
function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const t of tags) {
    const s = String(t ?? '').normalize('NFC').trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, ' ');
    if (s && s.length <= MAX_TAG && /^[\p{L}\p{N} _\-/.]+$/u.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

class Outbox {
  constructor(file, { now = Date.now, genId = () => crypto.randomBytes(8).toString('hex') } = {}) {
    Object.assign(this, { file, now, genId, lockFile: file + '.lock', _cache: null, _sig: '' });
    this._notes = this._read();
  }

  /* ---------- reading (no lock) ---------- */
  _read() {
    let st;
    try { st = fs.statSync(this.file); } catch (_) { this._sig = ''; return []; }
    const sig = st.mtimeMs + ':' + st.size;
    if (sig === this._sig && this._cache) return this._cache;
    let raw = '';
    try { raw = fs.readFileSync(this.file, 'utf8'); } catch (_) { return this._cache || []; }
    const out = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { const n = JSON.parse(line); if (n && typeof n === 'object' && n.id && typeof n.text === 'string') out.push(n); } catch (_) { /* a torn line must not lose the rest */ }
    }
    this._sig = sig; this._cache = out;
    return out;
  }
  _refresh() { this._notes = this._read(); return this._notes; }
  /** the notes as they are on disk right now */
  get notes() { return this._refresh(); }

  /* ---------- locking ---------- */
  _lock() {
    const t0 = Date.now();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    for (let i = 0; ; i++) {
      try {
        const fd = fs.openSync(this.lockFile, 'wx');
        try { fs.writeSync(fd, String(process.pid)); } catch (_) { /* the file existing is the lock */ }
        fs.closeSync(fd);
        return;
      } catch (e) {
        if (e.code !== 'EEXIST' && e.code !== 'EPERM' && e.code !== 'EACCES' && e.code !== 'EBUSY') throw e;
        try { if (Date.now() - fs.statSync(this.lockFile).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(this.lockFile); continue; } } catch (_) { /* gone already */ }
        if (Date.now() - t0 > LOCK_WAIT_MS) throw new Error('notes file is locked by another process');
        sleepSync(2 + Math.min(25, i * 2) + Math.floor(Math.random() * 6));
      }
    }
  }
  _unlock() { try { fs.unlinkSync(this.lockFile); } catch (_) { /* already gone */ } }
  /** run fn(freshNotes) under the lock; fn returns the value to hand back */
  _locked(fn) {
    this._lock();
    try { this._sig = ''; this._cache = null; this._notes = this._read(); return fn(this._notes); } finally { this._unlock(); }
  }

  /* ---------- writing (only inside _locked) ---------- */
  _append(n) {
    let prefix = '';
    try {
      const fd = fs.openSync(this.file, 'r');
      try { const size = fs.fstatSync(fd).size; if (size > 0) { const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, size - 1); if (b[0] !== 10) prefix = '\n'; } } finally { fs.closeSync(fd); }
    } catch (_) { /* no file yet */ }
    fs.appendFileSync(this.file, prefix + JSON.stringify(n) + '\n');
  }
  _rewrite(notes) {
    const tmp = `${this.file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, notes.map((n) => JSON.stringify(n)).join('\n') + (notes.length ? '\n' : ''));
    for (let i = 0; ; i++) {
      try { fs.renameSync(tmp, this.file); break; } catch (e) {
        if (i >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ } throw e; }
        sleepSync(10 + i * 5);
      }
    }
    this._sig = ''; this._cache = null;
  }
  /** change one note by id under the lock; fn(note) mutates it. -> the note, or null if it does not exist */
  _update(id, fn) {
    return this._locked((notes) => {
      const n = notes.find((x) => x.id === id);
      if (!n) return null;
      fn(n);
      this._rewrite(notes);
      return n;
    });
  }

  /** @returns the saved note, or null for empty text */
  add(text, { sync = 'local', tags = [], source = 'dictation' } = {}) {
    const t = cleanText(text);
    if (!t) return null;
    const n = { id: this.genId(), ts: this.now(), text: t, tags: cleanTags(tags), source: String(source || 'dictation').slice(0, 20), sync: sync === 'pending' ? 'pending' : 'local', attempts: 0, nextAt: 0 };
    this._locked(() => { this._append(n); });
    return n;
  }

  get(id) { return this._refresh().find((n) => n.id === id) || null; }
  /** newest first */
  list() { return this._refresh().slice().sort((a, b) => b.ts - a.ts); }
  counts() { const c = { local: 0, pending: 0, failed: 0, synced: 0 }; for (const n of this._refresh()) c[n.sync] = (c[n.sync] || 0) + 1; return c; }

  /** pending or failed notes whose time has come */
  due(at = this.now()) { return this._refresh().filter((n) => (n.sync === 'pending' || n.sync === 'failed') && (n.nextAt || 0) <= at).sort((a, b) => a.ts - b.ts); }

  markSynced(id, pageId, { destination, url } = {}) {
    return this._update(id, (n) => {
      Object.assign(n, { sync: 'synced', syncedAt: this.now(), pageId: pageId || n.pageId, nextAt: 0 }); delete n.error;
      if (destination) n.destination = String(destination).slice(0, 100);
      if (url) n.url = String(url).slice(0, 500);
    });
  }
  /** schedule the retry: backoff by attempts, or at least `retryAfterMs` (HTTP 429) */
  markFailed(id, error, { retryAfterMs = 0 } = {}) {
    return this._update(id, (n) => {
      n.attempts = (n.attempts || 0) + 1;
      n.sync = 'failed'; n.error = String(error || 'failed').slice(0, 200);
      n.nextAt = this.now() + Math.max(backoffMs(n.attempts), retryAfterMs || 0);
    });
  }
  /** user pressed Resend: try again right now, restart the backoff */
  resend(id) {
    return this._update(id, (n) => { Object.assign(n, { sync: 'pending', attempts: 0, nextAt: 0 }); delete n.error; });
  }
  /** small flags the app keeps on a note (md = the exported Markdown file name) */
  setFlag(id, key, value) {
    if (!['md'].includes(key)) return null;
    return this._update(id, (n) => { n[key] = String(value || '').slice(0, 200); });
  }
  remove(id) {
    return this._locked((notes) => {
      const i = notes.findIndex((n) => n.id === id);
      if (i < 0) return false;
      notes.splice(i, 1); this._rewrite(notes); return true;
    });
  }
}

module.exports = { Outbox, backoffMs, cleanText, cleanTags, MAX_TEXT, MAX_TAGS };
