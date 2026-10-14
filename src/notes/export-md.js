'use strict';
/* Markdown export for note apps without MCP (Obsidian, Logseq, plain folders): one .md per note in a folder you choose.
     ---
     title: "first line of the note"
     id: 0123456789abcdef
     created: 2026-10-13T20:02:58.982Z
     tags: ["work", "idea"]
     source: dictation
     ---
     the note text
   The name is <YYYY-MM-DD>-<slug>-<id>.md, so the same note always lands in the same file (exporting twice rewrites that
   file, never duplicates it) and two notes never share one. Only values that need quoting are inside quotes and every
   value is JSON-quoted, so a note cannot break out of the front matter. Files are written through a temp file and a rename.
   Nothing here logs; the folder comes from Settings and every name written is built here, never taken from a note. */
const fs = require('fs');
const path = require('path');

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function slug(text) {
  const first = String(text || '').split(/\r?\n/)[0].normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let s = first.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  if (!s || RESERVED.test(s)) s = 'note';
  return s;
}

function fileName(note) {
  const d = new Date(note.ts || 0);
  const day = Number.isNaN(d.getTime()) ? '1970-01-01' : d.toISOString().slice(0, 10);
  const id = String(note.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'x';
  return `${day}-${slug(note.text)}-${id}.md`;
}

const q = (v) => JSON.stringify(String(v ?? ''));

function render(note) {
  const first = String(note.text || '').split(/\r?\n/)[0].trim();
  const title = first.length > 80 ? first.slice(0, 79) + '…' : first;
  const tags = Array.isArray(note.tags) ? note.tags : [];
  const lines = ['---', `title: ${q(title)}`, `id: ${q(note.id)}`, `created: ${new Date(note.ts || 0).toISOString()}`, `tags: [${tags.map(q).join(', ')}]`, `source: ${q(note.source || 'dictation')}`];
  if (note.sync === 'synced' && note.destination) lines.push(`filed: ${q(note.destination)}`);
  if (note.sync === 'synced' && note.url) lines.push(`url: ${q(note.url)}`);
  lines.push('---', '', String(note.text || '').replace(/\r\n?/g, '\n'), '');
  return lines.join('\n');
}

/** a usable export folder: absolute, not a drive root, not a file. Creates it when missing.
    @returns {{ok:true, dir:string}|{ok:false, error:string}} */
function checkFolder(folder) {
  const f = String(folder || '').trim();
  if (!f) return { ok: false, error: 'No export folder chosen' };
  if (!path.isAbsolute(f)) return { ok: false, error: 'The export folder must be a full path' };
  const dir = path.resolve(f);
  if (path.parse(dir).root === dir) return { ok: false, error: 'Choose a folder, not a drive root' };
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.statSync(dir).isDirectory()) return { ok: false, error: 'That path is not a folder' };
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (e) { return { ok: false, error: 'Cannot write to that folder' }; }
  return { ok: true, dir };
}

/** write one note. @returns {{ok:true, name:string}|{ok:false, error:string}} */
function exportNote(note, folder) {
  const c = checkFolder(folder);
  if (!c.ok) return c;
  const name = fileName(note);
  const target = path.join(c.dir, name);
  if (path.dirname(target) !== c.dir) return { ok: false, error: 'bad file name' };      // belt and braces: the name is built from safe characters only
  const tmp = target + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, render(note), 'utf8');
    fs.renameSync(tmp, target);
  } catch (e) { try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ } return { ok: false, error: 'Could not write the file' }; }
  return { ok: true, name };
}

module.exports = { exportNote, checkFolder, fileName, slug, render };
