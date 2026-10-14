'use strict';
/* IPC for the Dictionary page's slang packs. Inputs are coerced here; the service re-validates everything.
   Files are only ever read or written through the system open/save dialogs the user answers (never a path from the page). */
const fs = require('fs');
const path = require('path');
const { parseTerms } = require('./import');
const P = require('./pack');

const s = (v, max) => String(v ?? '').slice(0, max);
const MAX_FILE = 5 * 1024 * 1024;

/** register(ipcMain, {service, dialog, getWindow, onChange}); dialog is Electron's `dialog` (a fake in tests) */
function register(ipcMain, { service, dialog, getWindow = () => null, onChange = () => {} }) {
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => { try { const r = await fn(...a); if (r && r.ok) onChange(); return r; } catch (e) { return { ok: false, error: 'Unexpected error: ' + s(e && e.message, 120) }; } });
  const termArg = (t) => ({ term: s(t && t.term, 120), variants: Array.isArray(t && t.variants) ? t.variants.slice(0, 40).map((v) => s(v, 120)) : s(t && t.variants, 2000),
    category: s(t && t.category, 40), lang: s(t && t.lang, 8), casing: s(t && t.casing, 10), matchCase: !!(t && t.matchCase) });

  ipcMain.handle('slang:state', () => service.state());
  ipcMain.handle('slang:terms', (_e, id, o) => service.terms(s(id, 60), { query: s(o && o.query, 80), limit: Math.min(500, +(o && o.limit) || 200), offset: Math.max(0, +(o && o.offset) || 0) }));
  ipcMain.handle('slang:parse-preview', (_e, text) => {       // what an import would read, before anything is written
    const r = P.parsePackText(s(text, MAX_FILE + 1), { fileName: 'preview' });
    const p = parseTerms(s(text, MAX_FILE + 1));
    return { stats: { ...p.stats, accepted: r.pack ? r.pack.terms.length : 0 }, warnings: (r.warnings || []).concat(r.errors || []).slice(0, 5), sample: r.pack ? r.pack.terms.slice(0, 4).map((t) => ({ term: t.term, variants: (t.variants || []).slice(0, 3) })) : [] };
  });
  ipcMain.handle('slang:preview', (_e, text) => service.preview(s(text, 2000), service.getSettings().dictionary.map((d) => d.from)));
  h('slang:set-enabled', (id, on) => service.setEnabled(s(id, 60), !!on));
  h('slang:add', (t) => service.addTerm(termArg(t)));
  h('slang:update', (old, t) => service.updateTerm(s(old, 120), termArg(t)));
  h('slang:remove', (term) => service.removeTerm(s(term, 120)));
  h('slang:delete-pack', (id) => service.deletePack(s(id, 60)));
  h('slang:import-text', (text, o) => service.importText(s(text, MAX_FILE + 1), { name: s(o && o.name, 60), fileName: s(o && o.fileName, 120), target: o && o.target === 'mine' ? 'mine' : 'new' }));
  h('slang:import-file', async (o) => {
    const r = await dialog.showOpenDialog(getWindow(), { title: 'Import terms', properties: ['openFile'],
      filters: [{ name: 'Term lists', extensions: ['txt', 'csv', 'json'] }, { name: 'All files', extensions: ['*'] }] });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, cancelled: true };
    const file = r.filePaths[0];
    let st;
    try { st = fs.statSync(file); } catch (_) { return { ok: false, error: 'Cannot read that file.' }; }
    if (!st.isFile()) return { ok: false, error: 'That is not a file.' };
    if (st.size > MAX_FILE) return { ok: false, error: 'That file is larger than 5 MB and was not read.' };
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return { ok: false, error: 'Cannot read that file.' }; }
    return service.importText(text, { name: s(o && o.name, 60), fileName: path.basename(file), target: o && o.target === 'mine' ? 'mine' : 'new' });
  });
  h('slang:export', async (id, format) => {
    const ex = service.exportPack(s(id, 60), format === 'csv' ? 'csv' : 'json');
    if (!ex.ok) return ex;
    const r = await dialog.showSaveDialog(getWindow(), { title: 'Export pack', defaultPath: ex.name, filters: [{ name: ex.ext.toUpperCase(), extensions: [ex.ext] }] });
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
    try { fs.writeFileSync(r.filePath, ex.text, 'utf8'); } catch (_) { return { ok: false, error: 'Could not write the file.' }; }
    return { ok: true, path: r.filePath, count: (ex.text.match(/\n/g) || []).length };
  });
}

module.exports = { register };
