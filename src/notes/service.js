'use strict';
/* NoteService: what the app does with a note, in one place.
     save(text, {source, tags})   write it to notes.jsonl; hand it to the optional Notion sync; export it as Markdown if that is on
     exportPending() / exportAll()   Markdown export (src/notes/export-md.js)
     watch()                      notes.jsonl is shared with the MCP server: when it changes behind our back (a note Claude added, a note
                                  marked as filed), tell the UI, and export what is new. Polls the file's size+mtime once a second.
   No dictated text is logged here; log lines carry counts. */
const fs = require('fs');
const { exportNote, checkFolder } = require('./export-md');

class NoteService {
  /** getSettings() -> the settings object; notion: NotionSync or null; hasToken() -> bool; onChange(); log(level, msg) */
  constructor({ outbox, getSettings, notion = null, hasToken = () => false, onChange = () => {}, log = () => {} }) {
    Object.assign(this, { outbox, getSettings, notion, hasToken, onChange, log });
    this._busy = false;
  }

  save(text, { source = 'dictation', tags = [] } = {}) {
    const s = this.getSettings();
    const c = s.notes.notion;
    const configured = !!(c.enabled && c.targetId && this.hasToken());
    const n = this.outbox.add(text, { sync: configured ? 'pending' : 'local', source, tags });
    if (!n) return null;
    if (configured && this.notion) this.notion.submit(n.id).catch(() => {});
    this.exportPending();
    this.onChange();
    return n;
  }

  /** export the notes that have no Markdown file yet (no-op when export is off or the folder is unusable) */
  exportPending() {
    const e = this.getSettings().notes.export;
    if (!e.enabled || this._busy) return { exported: 0 };
    return this._export(e.folder, this.outbox.notes.filter((n) => !n.md));
  }
  /** every note, again, into the current folder (after changing the folder, or to rebuild it) */
  exportAll() {
    const e = this.getSettings().notes.export;
    return this._export(e.folder, this.outbox.notes, true);
  }
  _export(folder, notes, force = false) {
    this._busy = true;
    try {
      const c = checkFolder(folder);
      if (!c.ok) return { exported: 0, error: c.error };
      let done = 0, failed = 0;
      for (const n of notes) {
        const r = exportNote(n, c.dir);
        if (r.ok) { done++; if (n.md !== r.name) this.outbox.setFlag(n.id, 'md', r.name); } else failed++;
      }
      this.log('info', `markdown export notes=${notes.length} written=${done} failed=${failed}${force ? ' (all)' : ''}`);
      return { exported: done, failed };
    } finally { this._busy = false; }
  }

  /** @returns a stop function */
  watch(intervalMs = 1000) {
    const f = this.outbox.file;
    let last = '';
    const sig = () => { try { const st = fs.statSync(f); return st.mtimeMs + ':' + st.size; } catch (_) { return ''; } };
    last = sig();
    const t = setInterval(() => {
      const now = sig();
      if (now === last) return;
      last = now;
      try { this.exportPending(); } catch (_) { /* a bad folder must not stop the watcher */ }
      last = sig();            // our own flag writes are not "news"
      this.onChange();
    }, intervalMs);
    if (t.unref) t.unref();
    return () => clearInterval(t);
  }
}

module.exports = { NoteService };
