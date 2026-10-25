'use strict';
/* SlangService: the packs on disk, which are enabled, and the compiled matcher.
   Packs: built-in ones ship in src/slang/packs (read-only); yours live in <userData>/dictionary/packs/*.json.
   "mine" is the pack the Dictionary page edits. Priority when two packs have the same heard text: mine, your packs (by id), built-in.
   Enabled state is kept in settings.slang.packs {id: bool} (a pack not listed is enabled). Never logs a term. */
const fs = require('fs');
const path = require('path');
const { compile } = require('./matcher');
const P = require('./pack');
const BIAS = require('./bias');
const { termsOf } = require('./hotwords');

// a word typed or picked by the user must be something speech can produce: emoji never come out of Parakeet
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/u;

const MINE = 'mine';
const MINE_NAME = 'My terms';

class SlangService {
  /** getSettings(): the store's settings; setSettings(patch) saves; builtinDir / userDir: pack folders */
  constructor({ builtinDir, userDir, getSettings, setSettings }) {
    Object.assign(this, { builtinDir, userDir, getSettings, setSettings });
    this.packs = []; this.problems = []; this.version = 0; this._cache = null;
    this.reload();
  }

  _scan(dir, builtin) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => /\.(json|csv|txt)$/i.test(f)).sort(); } catch (_) { return []; }
    const out = [];
    for (const f of files) {
      const r = P.loadPackFile(dir, f, { builtin });
      if (!r.pack) { this.problems.push({ file: f, errors: r.errors }); continue; }
      out.push({ ...r.pack, file: f, warnings: r.warnings });
    }
    return out;
  }

  reload() {
    this.problems = [];
    const user = this._scan(this.userDir, false);
    const built = this._scan(this.builtinDir, true);
    const seen = new Set();
    const all = [];
    for (const p of [...user.filter((p) => p.id === MINE), ...user.filter((p) => p.id !== MINE), ...built]) {
      if (seen.has(p.id)) { this.problems.push({ file: p.file, errors: [`Pack id "${p.id}" is already used; this file was ignored.`] }); continue; }
      seen.add(p.id); all.push(p);
    }
    this.packs = all; this.version++; this._cache = null;
  }

  _cfg() { const s = (this.getSettings() || {}).slang || {}; const b = s.biasing || {}; return { enabled: s.enabled !== false, packs: s.packs || {}, biasing: { enabled: !!b.enabled, score: BIAS.normScore(b.score) } }; }
  /** terms of the enabled packs (hotword biasing): a string, or {term, bias} for a term with its own bias percent */
  enabledTerms() { const c = this._cfg(); return c.enabled ? termsOf(this.packs.filter((p) => c.packs[p.id] !== false)) : []; }
  isEnabled(id) { const c = this._cfg(); return c.enabled && c.packs[id] !== false; }
  _pack(id) { return this.packs.find((p) => p.id === id); }

  /** what the Dictionary page shows */
  state() {
    const c = this._cfg();
    const mine = this._pack(MINE);
    return {
      enabled: c.enabled, biasing: { ...c.biasing, percent: BIAS.scoreToPercent(c.biasing.score) },
      packs: this.packs.map((p) => ({ id: p.id, name: p.name, description: p.description, language: p.language, builtin: p.builtin, editable: this._editable(p), count: p.terms.length,
        variants: p.terms.reduce((n, t) => n + (t.variants || []).length + (t.heard || []).length, 0), enabled: c.packs[p.id] !== false, warnings: (p.warnings || []).slice(0, 8) })),
      mine: { count: mine ? mine.terms.length : 0 },
      problems: this.problems.slice(0, 10),
      active: this.activeCount(),
    };
  }
  activeCount() { let n = 0; for (const p of this.packs) if (this.isEnabled(p.id)) n += p.terms.length; return n; }

  setBiasing(on) { const c = this._cfg(); this.setSettings({ slang: { ...c, biasing: { ...c.biasing, enabled: !!on } } }); return { ok: true }; }
  /** the global bias, as the percent the user typed (1..100); stored as its score */
  setBiasPercent(v) {
    const r = BIAS.parsePercentInput(v);
    if (r.error) return { ok: false, error: r.error };
    if (r.pct === null) return { ok: false, error: 'Type a bias from 1% to 100%.' };
    const c = this._cfg();
    if (BIAS.scoreToPercent(c.biasing.score) === r.pct) return { ok: true, percent: r.pct, unchanged: true };
    this.setSettings({ slang: { ...c, biasing: { ...c.biasing, score: BIAS.percentToScore(r.pct) } } });
    return { ok: true, percent: r.pct };
  }

  /** terms of one pack for the list view: optional text filter, capped */
  terms(id, { query = '', limit = 200, offset = 0 } = {}) {
    const p = this._pack(id);
    if (!p) return { total: 0, items: [] };
    const q = String(query || '').toLowerCase().trim();
    const all = q ? p.terms.filter((t) => t.term.toLowerCase().includes(q) || (t.variants || []).concat(t.heard || []).some((v) => v.toLowerCase().includes(q)) || (t.category || '').toLowerCase().includes(q)) : p.terms;
    return { total: all.length, items: all.slice(offset, offset + Math.min(500, limit)) };
  }

  setEnabled(id, on) {
    const c = this._cfg();
    if (id === '*') { this.setSettings({ slang: { ...c, enabled: !!on } }); }
    else if (this._pack(id)) { this.setSettings({ slang: { ...c, packs: { ...c.packs, [id]: !!on } } }); }
    else return { ok: false, error: 'No such pack.' };
    this.version++; this._cache = null;
    return { ok: true };
  }

  /** the compiled matcher over every enabled pack. `exclude`: heard texts that the user's own Dictionary rows already handle. */
  matcher(exclude = []) {
    const c = this._cfg();
    const key = this.version + '|' + c.enabled + '|' + JSON.stringify(c.packs) + '|' + exclude.join('\u0001');
    if (this._cache && this._cache.key === key) return this._cache.m;
    const m = c.enabled ? compile(P.toForms(this.packs.filter((p) => c.packs[p.id] !== false)), { exclude }) : compile([]);
    this._cache = { key, m };
    return m;
  }
  /** apply to a final text (null-safe) */
  apply(text, exclude) { return this.matcher(exclude).apply(text); }
  preview(text, exclude) { const r = this.matcher(exclude).explain(String(text || '').slice(0, 2000)); return { text: r.text, hits: r.hits.map((h) => ({ from: h.from, to: h.to })) }; }

  /** terms of the enabled packs that occur in `text`: the vocabulary hint for the local cleanup model */
  vocab(text, max = 30) {
    const found = this.matcher().explain(String(text || '')).found;
    return [...new Set(found)].slice(0, max);
  }

  /* ---------- my terms ---------- */
  _mine() {
    let m = this._pack(MINE);
    if (!m) { m = { format: 1, id: MINE, name: MINE_NAME, description: 'Terms you added.', language: 'en', builtin: false, terms: [], warnings: [] }; this.packs.unshift(m); }
    return m;
  }
  _saveMine() {
    const m = this._mine();
    P.savePack(this.userDir, m);
    this.version++; this._cache = null;
  }

  /** a pack the Dictionary may add words to: My terms, or one of your own packs stored as <id>.json (built-in packs and
      .csv/.txt packs are never rewritten) */
  _editable(p) { return !!p && !p.builtin && (p.id === MINE || p.file === p.id + '.json'); }

  /** add one word (the Dictionary's Add box and "Add to dictionary" from a transcript). raw: {term, variants, bias, ...};
      opts.packId: My terms (default) or an editable pack of yours. Same spelling in any case = merged into the existing
      entry, never a second one. Returns {ok, term, merged, packId, packName, undo, alsoIn} or {ok:false, error}. */
  addTerm(raw, { packId = MINE } = {}) {
    const r = raw && typeof raw === 'object' ? raw : { term: raw };
    if (EMOJI.test(String(r.term ?? ''))) return { ok: false, error: 'Emoji cannot be dictated, so a word with an emoji would never match. Leave the emoji out.' };
    const vs = Array.isArray(r.variants) ? r.variants : String(r.variants ?? '').split('|');
    if (vs.some((v) => EMOJI.test(String(v ?? '')))) return { ok: false, error: 'Leave emoji out of "heard as" too.' };
    let bias;
    if (r.bias !== undefined && r.bias !== null && r.bias !== '') {
      const b = BIAS.parsePercentInput(r.bias);
      if (b.error) return { ok: false, error: b.error };
      bias = b.pct;
    }
    const n = P.normTerm({ ...r, bias });
    if (n.error) return { ok: false, error: n.error.charAt(0).toUpperCase() + n.error.slice(1) + '.' };
    const m = packId === MINE ? this._mine() : this._pack(packId);
    if (!m) return { ok: false, error: 'That pack no longer exists.' };
    if (!this._editable(m)) return { ok: false, error: m.builtin ? 'Built-in packs cannot be changed. Add the word to My terms instead.' : 'This pack is a .csv or .txt file; add the word to My terms instead.' };
    const key = n.term.term.toLowerCase();
    const i = m.terms.findIndex((t) => t.term.toLowerCase() === key);
    if (i < 0 && m.terms.length >= P.LIMITS.terms) return { ok: false, error: `${m.name} is full.` };
    const before = i >= 0 ? JSON.parse(JSON.stringify(m.terms[i])) : null;
    if (i >= 0) {
      const old = m.terms[i], add = [...(n.term.variants || []), ...(n.term.heard || [])];
      const seenV = new Set([key, ...(old.heard || []).map((v) => v.toLowerCase())]);     // variants differ only by case = the same variant
      const merged = [...(old.variants || []), ...add].filter((v) => !seenV.has(v.toLowerCase()) && seenV.add(v.toLowerCase())).slice(0, P.LIMITS.variantsPerTerm);
      m.terms[i] = { ...old, ...n.term, variants: merged, heard: old.heard };
      if (!m.terms[i].heard) delete m.terms[i].heard;
      if (!m.terms[i].variants.length) delete m.terms[i].variants;
    } else m.terms.push(n.term);
    this._savePack(m);
    this._undo = { token: (this._undoSeq = (this._undoSeq || 0) + 1), packId: m.id, key, before };
    const alsoIn = this.packs.filter((p) => p.id !== m.id && p.terms.some((t) => t.term.toLowerCase() === key)).map((p) => p.name).slice(0, 3);
    return { ok: true, term: n.term.term, merged: i >= 0, packId: m.id, packName: m.name, undo: this._undo.token, alsoIn, warnings: n.warnings };
  }
  /** undo the LAST add (only that one, and only by its token): a new word is removed, a merged one gets its old entry back */
  undoAdd(token) {
    const u = this._undo;
    if (!u || u.token !== token) return { ok: false, error: 'Nothing to undo.' };
    this._undo = null;
    const m = this._pack(u.packId);
    if (!m) return { ok: false, error: 'That pack no longer exists.' };
    const i = m.terms.findIndex((t) => t.term.toLowerCase() === u.key);
    if (u.before) { if (i >= 0) m.terms[i] = u.before; else m.terms.push(u.before); }
    else if (i >= 0) m.terms.splice(i, 1);
    else return { ok: false, error: 'That word was already removed.' };
    this._savePack(m);
    return { ok: true, term: u.before ? u.before.term : null };
  }
  _savePack(p) {
    if (p.id === MINE) return this._saveMine();
    P.savePack(this.userDir, p);
    this.version++; this._cache = null;
  }
  updateTerm(oldTerm, raw) {
    const m = this._mine();
    const i = m.terms.findIndex((t) => t.term === oldTerm);
    if (i < 0) return { ok: false, error: 'That term is not in My terms.' };
    const n = P.normTerm(raw);
    if (n.error) return { ok: false, error: n.error.charAt(0).toUpperCase() + n.error.slice(1) + '.' };
    if (n.term.term.toLowerCase() !== oldTerm.toLowerCase() && m.terms.some((t, k) => k !== i && t.term.toLowerCase() === n.term.term.toLowerCase())) return { ok: false, error: 'That spelling already exists.' };
    if (n.term.bias == null && m.terms[i].bias != null && (raw == null || raw.bias === undefined)) n.term.bias = m.terms[i].bias;   // the edit row does not show bias: keep it
    m.terms[i] = n.term;
    this._saveMine();
    return { ok: true, warnings: n.warnings };
  }
  removeTerm(term) {
    const m = this._mine();
    const i = m.terms.findIndex((t) => t.term === term);
    if (i < 0) return { ok: false, error: 'That term is not in My terms.' };
    m.terms.splice(i, 1);
    this._saveMine();
    return { ok: true };
  }

  /* ---------- import / export ---------- */
  _freeId(base) {
    let id = base, n = 2;
    while (this._pack(id)) id = (base.slice(0, 44) + '-' + n++);
    return id;
  }
  /** text: JSON pack, CSV or one term per line. target 'new' (default) makes a pack named after `name`/`fileName`; 'mine' merges into My terms. */
  importText(text, { name = '', fileName = '', target = 'new' } = {}) {
    const base = String(fileName || '').replace(/^.*[\\/]/, '');         // only a bare name is ever used, never a path
    const r = P.parsePackText(String(text ?? ''), { fileName: base, name: name || undefined, id: undefined });
    if (!r.pack) return { ok: false, error: r.errors[0] || 'Nothing to import.', warnings: r.warnings };
    if (!r.pack.terms.length) return { ok: false, error: 'No terms found in that text.', warnings: r.warnings };
    if (target === 'mine') {
      const m = this._mine(); let added = 0, merged = 0;
      for (const t of r.pack.terms) {
        const i = m.terms.findIndex((x) => x.term.toLowerCase() === t.term.toLowerCase());
        if (i < 0) { if (m.terms.length < P.LIMITS.terms) { m.terms.push(t); added++; } }
        else { const v = [...new Set([...(m.terms[i].variants || []), ...(t.variants || []), ...(t.heard || [])])].slice(0, P.LIMITS.variantsPerTerm); if (v.length !== (m.terms[i].variants || []).length) { m.terms[i] = { ...m.terms[i], variants: v }; merged++; } }
      }
      this._saveMine();
      return { ok: true, packId: MINE, added, merged, total: r.pack.terms.length, warnings: r.warnings };
    }
    const wanted = P.slug(name || base || r.pack.name, 'imported');
    const id = wanted === MINE ? this._freeId('imported') : this._freeId(wanted);
    const pack = { ...r.pack, id, builtin: false, name: String(name || r.pack.name || id).slice(0, P.LIMITS.nameLen) };
    P.savePack(this.userDir, pack);
    this.reload();
    return { ok: true, packId: id, added: pack.terms.length, merged: 0, total: pack.terms.length, warnings: r.warnings };
  }

  /** {name, ext, text} for a pack; format 'json' | 'csv' */
  exportPack(id, format = 'json') {
    const p = this._pack(id);
    if (!p) return { ok: false, error: 'No such pack.' };
    if (format === 'csv') return { ok: true, ext: 'csv', name: p.id + '.csv', text: P.toCsv(p.terms) };
    const body = { format: 1, id: p.id, name: p.name, description: p.description || '', language: p.language || 'en', terms: p.terms };
    return { ok: true, ext: 'json', name: p.id + '.json', text: JSON.stringify(body, null, 1) };
  }

  deletePack(id) {
    const p = this._pack(id);
    if (!p) return { ok: false, error: 'No such pack.' };
    if (p.builtin) return { ok: false, error: 'Built-in packs cannot be deleted; switch them off instead.' };
    const full = path.join(this.userDir, p.file || id + '.json');
    if (path.dirname(path.resolve(full)) !== path.resolve(this.userDir)) return { ok: false, error: 'Outside the packs folder.' };
    try { fs.unlinkSync(full); } catch (e) { return { ok: false, error: 'Could not delete the file.' }; }
    this.reload();
    return { ok: true };
  }
}

module.exports = { SlangService, MINE };
