'use strict';
/* Slang packs: validate, load, save, flatten into matcher forms. Pure except loadPackFile / savePack, which only
   touch the one directory they are given and never build a path from anything but a sanitised pack id.

   Pack JSON (format 1):
   { "format": 1, "id": "my-pack", "name": "My pack", "description": "", "language": "en",
     "terms": [ { "term": "rizz", "variants": ["riz"], "heard": ["ris"], "category": "slang", "lang": "en",
                  "casing": "smart", "matchCase": false, "allowCommon": false } ] }
   variants = misrecognitions you expect (guessed or user-added); heard = misrecognitions actually measured on Parakeet. */
const fs = require('fs');
const path = require('path');
const { parseTerms, toCsv, clean } = require('./import');
const { tokenize, norm } = require('./matcher');
const { COMMON } = require('./common');

const LIMITS = { fileBytes: 5 * 1024 * 1024, terms: 20000, termLen: 80, variantsPerTerm: 24, termTokens: 8, nameLen: 60, descLen: 300 };
const CASINGS = ['smart', 'exact', 'lower', 'upper', 'title', 'keep'];
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/** any string -> a safe pack id: no path separators, no dots, no drive letters, never empty */
function slug(s, fallback = 'pack') {
  const base = String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/i, '')            // a file extension
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  return ID_RE.test(base) ? base : fallback;
}

function str(v, max) { return clean(typeof v === 'string' || typeof v === 'number' ? v : '').slice(0, max); }

/** one raw term object -> {term, warnings} or {error} */
function normTerm(raw, builtinSafe = false) {
  if (typeof raw === 'string') raw = { term: raw };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'not an object' };
  const term = str(raw.term, LIMITS.termLen + 1);
  if (!term) return { error: 'empty term' };
  if (term.length > LIMITS.termLen) return { error: `term longer than ${LIMITS.termLen} characters` };
  const tt = tokenize(term);
  if (!tt.length) return { error: 'no letters or digits' };
  if (tt.length > LIMITS.termTokens) return { error: `more than ${LIMITS.termTokens} words` };
  const matchCase = raw.matchCase === true;
  const warnings = [];
  if (!matchCase && tt.length === 1 && tt[0].key.replace(/['’]/g, '').length < 2) return { error: 'a one-letter term would match everywhere (use matchCase)' };
  const out = { term };
  const allowCommon = raw.allowCommon === true;
  const own = new Set([norm(term).replace(/\s+/g, ' ')]);
  for (const field of ['variants', 'heard']) {
    const arr = Array.isArray(raw[field]) ? raw[field] : (typeof raw[field] === 'string' && raw[field] ? raw[field].split('|') : []);
    const keep = [];
    for (const v of arr.slice(0, LIMITS.variantsPerTerm * 2)) {
      const s = str(v, LIMITS.termLen + 1);
      if (!s) continue;
      const vt = tokenize(s);
      if (!vt.length || s.length > LIMITS.termLen) { warnings.push(`"${s.slice(0, 20)}": not a usable variant`); continue; }
      const key = vt.map((t) => t.key).join(' ');
      if (own.has(key)) continue;
      const letters = key.replace(/[^\p{L}\p{N}]/gu, '');
      if (letters.length < 2) { warnings.push(`variant "${s}" for "${term}" rejected: one character would match everywhere`); continue; }
      if (!allowCommon && vt.length === 1 && COMMON.has(key)) { warnings.push(`variant "${s}" for "${term}" rejected: a very common word (set allowCommon to keep it)`); continue; }
      own.add(key); keep.push(s);
      if (keep.length >= LIMITS.variantsPerTerm) break;
    }
    if (keep.length) out[field] = keep;
  }
  const cat = str(raw.category, 40); if (cat) out.category = cat;
  const lang = str(raw.lang, 8).toLowerCase(); if (lang) out.lang = lang;
  const casing = str(raw.casing, 10).toLowerCase();
  if (casing) { if (CASINGS.includes(casing)) out.casing = casing; else warnings.push(`"${term}": unknown casing "${casing}", using the default`); }
  if (matchCase) out.matchCase = true;
  if (allowCommon) out.allowCommon = true;
  return { term: out, warnings };
}

/** raw pack object -> {pack, warnings, errors}. Never throws. */
function normalizePack(raw, { id: forcedId, builtin = false, name } = {}) {
  const warnings = [], errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { pack: null, warnings, errors: ['The pack is not a JSON object.'] };
  if (raw.format !== undefined && raw.format !== 1) { return { pack: null, warnings, errors: [`Unsupported pack format ${String(raw.format).slice(0, 10)} (this app reads format 1).`] }; }
  if (!Array.isArray(raw.terms)) return { pack: null, warnings, errors: ['The pack has no "terms" list.'] };
  const id = forcedId || (typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : slug(raw.id || raw.name, 'pack'));
  const pack = {
    format: 1, id, name: str(name || raw.name, LIMITS.nameLen) || id, description: str(raw.description, LIMITS.descLen),
    language: str(raw.language, 8).toLowerCase() || 'en', builtin: !!builtin, terms: [],
  };
  if (raw.terms.length > LIMITS.terms) warnings.push(`Only the first ${LIMITS.terms} terms are used (the pack has ${raw.terms.length}).`);
  const seen = new Map();
  let dup = 0, bad = 0;
  for (const r of raw.terms.slice(0, LIMITS.terms)) {
    const n = normTerm(r);
    if (n.error) { bad++; if (bad <= 5) warnings.push(`Skipped a term: ${n.error}.`); continue; }
    const key = n.term.term.toLowerCase() + (n.term.matchCase ? '\u0001cs' : '');
    if (seen.has(key)) { dup++; continue; }
    seen.set(key, true);
    pack.terms.push(n.term);
    for (const w of n.warnings) if (warnings.length < 60) warnings.push(w);
  }
  if (dup) warnings.push(`${dup} duplicate term${dup > 1 ? 's' : ''} ignored.`);
  if (bad > 5) warnings.push(`${bad} terms skipped in total.`);
  return { pack, warnings, errors };
}

/** text file (.json, .csv, .txt) -> normalised pack. */
function parsePackText(text, { fileName = '', id, name, builtin = false } = {}) {
  const s = String(text ?? '');
  if (Buffer.byteLength(s, 'utf8') > LIMITS.fileBytes) return { pack: null, warnings: [], errors: ['The file is larger than 5 MB and was not read.'] };
  const t = s.replace(/^﻿/, '').trimStart();
  const fid = id || slug(fileName || name, 'pack');
  if (t.startsWith('{') || t.startsWith('[')) {
    let raw;
    try { raw = JSON.parse(t); } catch (e) { return { pack: null, warnings: [], errors: ['The file is not valid JSON: ' + String(e.message).slice(0, 80)] }; }
    if (Array.isArray(raw)) raw = { terms: raw };
    // the id inside a pack file is advice only: when the caller names one it wins, and anything odd is sanitised
    return normalizePack(raw, { id: id || (typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : fid), builtin, name });
  }
  const p = parseTerms(s);
  const r = normalizePack({ name: name || fileName.replace(/\.[^.\\/]*$/, ''), terms: p.terms }, { id: fid, builtin, name });
  r.warnings = [...p.warnings, ...r.warnings];
  return r;
}

/** read one pack file from `dir`. `file` must be a plain file name inside `dir`. */
function loadPackFile(dir, file, opts = {}) {
  if (file !== path.basename(file) || !/\.(json|csv|txt)$/i.test(file)) return { pack: null, warnings: [], errors: ['Not a pack file name.'] };
  const full = path.join(dir, file);
  if (path.dirname(path.resolve(full)) !== path.resolve(dir)) return { pack: null, warnings: [], errors: ['Outside the packs folder.'] };
  let st;
  try { st = fs.statSync(full); } catch (e) { return { pack: null, warnings: [], errors: ['Cannot read the file.'] }; }
  if (!st.isFile()) return { pack: null, warnings: [], errors: ['Not a file.'] };
  if (st.size > LIMITS.fileBytes) return { pack: null, warnings: [], errors: ['The file is larger than 5 MB and was not read.'] };
  let text;
  try { text = fs.readFileSync(full, 'utf8'); } catch (e) { return { pack: null, warnings: [], errors: ['Cannot read the file.'] }; }
  const r = parsePackText(text, { fileName: file, ...opts });
  if (r.pack && /\.json$/i.test(file)) { try { const j = JSON.parse(text.replace(/^﻿/, '')); if (j && typeof j.id === 'string' && ID_RE.test(j.id) && !opts.id) r.pack.id = j.id; } catch (_) { /* already reported */ } }
  return r;
}

/** write a user pack as <dir>/<id>.json (atomic). The id is re-sanitised here, so no caller can escape `dir`. */
function savePack(dir, pack) {
  const id = ID_RE.test(pack.id) ? pack.id : slug(pack.id);
  const full = path.join(dir, id + '.json');
  if (path.dirname(path.resolve(full)) !== path.resolve(dir)) throw new Error('pack path escapes the packs folder');
  fs.mkdirSync(dir, { recursive: true });
  const body = { format: 1, id, name: pack.name, description: pack.description || '', language: pack.language || 'en', terms: pack.terms };
  const tmp = full + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(body, null, 1));
  fs.renameSync(tmp, full);
  return full;
}

/** packs in priority order -> matcher forms. The term itself is a form too (it fixes casing and spacing). */
function toForms(packs) {
  const forms = [];
  for (const p of packs) {
    for (const t of p.terms) {
      const entryId = p.id + ':' + t.term;
      const base = { to: t.term, casing: t.casing, matchCase: !!t.matchCase, entryId };
      forms.push({ ...base, from: t.term });
      for (const v of t.variants || []) forms.push({ ...base, from: v, matchCase: false });
      for (const v of t.heard || []) forms.push({ ...base, from: v, matchCase: false });
    }
  }
  return forms;
}

module.exports = { LIMITS, CASINGS, ID_RE, slug, normTerm, normalizePack, parsePackText, loadPackFile, savePack, toForms, toCsv };
