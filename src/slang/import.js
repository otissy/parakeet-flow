'use strict';
/* Parse a pasted or loaded text/CSV list of terms. Pure. Nothing here touches the disk.

   One term per line:                         rizz
   term + misrecognitions (| separated):      rizz,riz|rits
   quoted fields, "" for a quote:             "no cap, fr",no kap|no cab
   tab separated works too; # starts a comment line; a header row (term,variants,category,lang,casing) is detected.
   Columns without a header: term, variants, category, lang, casing.
   Only spellings are read. There is no definition column: this app never needs, stores or shows definitions. */

const MAX_LINE = 400;
const HEADER_NAMES = {
  term: 'term', word: 'term', phrase: 'term', spelling: 'term', slang: 'term',
  variants: 'variants', variant: 'variants', heard: 'variants', misheard: 'variants', misrecognitions: 'variants', 'heard as': 'variants', alias: 'variants', aliases: 'variants',
  category: 'category', tag: 'category', tags: 'category', type: 'category',
  lang: 'lang', language: 'lang',
  casing: 'casing', case: 'casing',
};
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠﻿]/g;

const clean = (s) => String(s ?? '').normalize('NFC').replace(CONTROL, '').replace(/\s+/g, ' ').trim();

/** split text into rows of fields. A quote only opens a quoted field at the start of a field, and only if it closes
    before the end of the text; an unmatched quote is read as a plain character so one stray " cannot swallow the file. */
function rows(text, delim) {
  const out = [];
  const n = text.length;
  let i = 0, row = [], field = '';
  const push = () => { row.push(field); field = ''; };
  const endRow = () => { push(); out.push(row); row = []; };
  while (i < n) {
    const c = text[i];
    if (c === '"' && field === '') {
      let j = i + 1, buf = '', closed = false;
      while (j < n) {
        if (text[j] === '"') { if (text[j + 1] === '"') { buf += '"'; j += 2; continue; } closed = true; break; }
        buf += text[j++];
      }
      const after = text[j + 1];
      if (closed && (after === undefined || after === delim || after === '\n' || after === '\r')) { field = buf; i = j + 1; continue; }
      field += c; i++; continue;                        // stray quote: literal
    }
    if (c === delim) { push(); i++; continue; }
    if (c === '\r') { i++; if (text[i] === '\n') i++; endRow(); continue; }
    if (c === '\n') { i++; endRow(); continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) endRow();
  return out;
}

function pickDelim(text) {
  const head = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).slice(0, 20).join('\n');
  const tabs = (head.match(/\t/g) || []).length, commas = (head.match(/,/g) || []).length, semis = (head.match(/;/g) || []).length;
  if (tabs && tabs >= commas) return '\t';
  if (!commas && semis >= 2) return ';';
  return ',';
}

/** @returns {{terms: object[], warnings: string[], stats: {rows:number, accepted:number, skipped:number, duplicates:number}}} */
function parseTerms(input, { maxTerms = 20000, maxBytes = 5 * 1024 * 1024 } = {}) {
  const warnings = [];
  const stats = { rows: 0, accepted: 0, skipped: 0, duplicates: 0 };
  let text = String(input ?? '');
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    return { terms: [], warnings: [`The text is larger than ${Math.round(maxBytes / 1048576)} MB and was not read.`], stats };
  }
  text = text.replace(/^﻿/, '');
  if (text.indexOf('\u0000') !== -1) warnings.push('The text contains NUL characters; this does not look like a text list.');
  const delim = pickDelim(text);
  // drop comment lines before CSV parsing so a "#" inside a quoted field is not a comment
  const all = rows(text, delim).filter((r) => !(r.length && String(r[0]).trim().startsWith('#') ) && r.some((f) => String(f).trim() !== ''));
  let cols = ['term', 'variants', 'category', 'lang', 'casing'];
  if (all.length) {
    const first = all[0].map((f) => HEADER_NAMES[clean(f).toLowerCase()]);
    if (first[0] === 'term' && first.every((x) => x)) { cols = first; all.shift(); }
    else if (first[0] === 'term' && first.filter(Boolean).length >= 2) { cols = first.map((x, i) => x || ['term', 'variants', 'category', 'lang', 'casing'][i] || 'x'); all.shift(); }
  }
  const seen = new Set();
  const terms = [];
  for (let ln = 0; ln < all.length; ln++) {
    stats.rows++;
    if (terms.length >= maxTerms) { warnings.push(`Stopped at ${maxTerms} terms; the rest was ignored.`); break; }
    const r = all[ln];
    const get = (name) => { const k = cols.indexOf(name); return k >= 0 && k < r.length ? r[k] : ''; };
    const rawTerm = get('term');
    if (rawTerm.length > MAX_LINE) { stats.skipped++; warnings.push(`Row ${ln + 1}: term too long, skipped.`); continue; }
    const term = clean(rawTerm);
    if (!/[\p{L}\p{N}]/u.test(term)) { stats.skipped++; if (term) warnings.push(`Row ${ln + 1}: "${term.slice(0, 30)}" has no letters or digits, skipped.`); continue; }
    if (term.length > 80) { stats.skipped++; warnings.push(`Row ${ln + 1}: term longer than 80 characters, skipped.`); continue; }
    const key = term.toLowerCase();
    if (seen.has(key)) { stats.duplicates++; continue; }
    seen.add(key);
    const variants = get('variants').split('|').map(clean).filter(Boolean);
    const t = { term, variants };
    const cat = clean(get('category')); if (cat) t.category = cat.slice(0, 40);
    const lang = clean(get('lang')).toLowerCase(); if (lang) t.lang = lang.slice(0, 8);
    const casing = clean(get('casing')).toLowerCase(); if (casing) t.casing = casing;
    terms.push(t);
    stats.accepted++;
  }
  return { terms, warnings: warnings.slice(0, 50), stats };
}

const csvField = (s) => (/[",\t\r\n|]|^#|^\s|\s$/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s));
/** terms -> CSV text that parseTerms reads back (variants joined with |) */
function toCsv(terms) {
  const lines = ['term,variants,category,lang,casing'];
  for (const t of terms) {
    const variants = [...(t.variants || []), ...(t.heard || [])];
    lines.push([csvField(t.term), csvField(variants.join('|')), csvField(t.category || ''), csvField(t.lang || ''), csvField(t.casing || '')].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = { parseTerms, toCsv, rows, clean };
