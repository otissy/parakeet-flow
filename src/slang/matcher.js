'use strict';
/* Slang matcher: turns enabled pack terms into one compiled matcher and applies it to FINAL text only.
   Pure, no I/O. Rules (docs/slang-packs.md has the long version):
     - whole words: a match never starts or ends inside a word (letters, digits, and apostrophes inside a word are one token)
     - case-insensitive on the way in; the way out follows the entry's casing rule
     - leftmost, longest first ("no cap" beats "cap")
     - tokens of a multi-word form may be separated by spaces or one hyphen ("no-cap" matches "no cap")
     - never inside URLs, e-mail addresses, file paths, `code spans`, @handles, #tags, snake_case or dotted identifiers
     - a possessive "'s" after a single-word match is kept ("rizz's")
   compile(forms, {exclude}) -> { apply(text), explain(text) -> {text, hits, found}, size, conflicts }
   A "form" is {from, to, casing, matchCase, entryId}: `from` is the heard text, `to` the preferred spelling. */

const TOKEN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const norm = (s) => String(s).normalize('NFC').toLowerCase().replace(/’/g, "'");

/** [{key, start, end}] for every word token of `text` */
function tokenize(text) {
  const out = [];
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(text))) out.push({ key: norm(m[0]), start: m.index, end: m.index + m[0].length });
  return out;
}

/* ---------- protected spans ---------- */
const FILE_EXT = 'com|net|org|io|gg|tv|nl|be|de|uk|dev|app|co|me|ai|xyz|ly|fm|so|sh|html?|css|js|jsx|json|txt|md|exe|dll|png|jpe?g|gif|mp4|mp3|wav|py|ts|tsx|cs|cpp|java|zip|pdf|log|csv|ini|cfg|yml|yaml|toml|bat|ps1';
const PROTECT = [
  /```[\s\S]*?```/g,                                              // fenced code
  /`[^`\n]*`/g,                                                    // inline code
  /\b(?:https?|ftp|file|wss?):\/\/[^\s<>"'`)\]]+/gi,               // URLs
  /\bwww\.[^\s<>"'`)\]]+/gi,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,                                 // e-mail
  /\b[A-Za-z]:[\\/][^\s"'<>|?*`]*/g,                               // C:\path or C:/path
  /\\\\[\w.$-]+\\[^\s"'<>|?*`]*/g,                                 // \\server\share
  /(?<![\w)\].])(?:~|\.{1,2})?\/[\w.\-~@%+]+(?:\/[\w.\-~@%+]*)*/g,  // /usr/bin, ~/x, ./x, /command
  new RegExp(`(?<![\\w.-])[\\w-]+(?:\\.[\\w-]+)*\\.(?:${FILE_EXT})\\b(?:[/?#][^\\s<>"'\`)\\]]*)?`, 'gi'),   // twitch.tv/x, rizz.txt
  /(?<![\w@])[@#][\w.]+/g,                                         // @handles, #tags
];
function protectedSpans(text) {
  const spans = [];
  for (const re of PROTECT) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) { spans.push([m.index, m.index + m[0].length]); if (m[0].length === 0) re.lastIndex++; }
  }
  return spans;
}
const inSpan = (spans, s, e) => spans.some(([a, b]) => s < b && e > a);

const WORDCH = /[\p{L}\p{N}]/u;
/** a match glued to an identifier: foo_rizz, rizz_bot, obj.rizz, a.rizz.b, dir/rizz */
function glued(text, s, e) {
  const p = text[s - 1], n = text[e];
  if (p === '_' || n === '_' || p === '\\' || p === '/' || (n === '/' && WORDCH.test(text[e + 1] || ''))) return true;
  if (p === '.' && s >= 2 && WORDCH.test(text[s - 2])) return true;
  if (n === '.' && WORDCH.test(text[e + 1] || '') && s >= 1) return true;
  if (p === '-' && s >= 2 && WORDCH.test(text[s - 2])) return true;        // part of a hyphenated compound we do not own
  if (n === '-' && WORDCH.test(text[e + 1] || '')) return true;
  return false;
}

/* gaps between the tokens of a multi-word match */
function gapOk(textGap, formGap) {
  if (/^[ \t\u00a0]+$/.test(textGap)) return true;
  if (/^[ \t]*[-\u2010-\u2013][ \t]*$/.test(textGap) && /^[\s\-\u2010-\u2013]*$/.test(formGap)) return true;
  return textGap.toLowerCase() === formGap.toLowerCase() || (formGap.trim() !== '' && textGap.trim() === formGap.trim());
}

/* ---------- casing ---------- */
const cap1 = (s) => s.replace(/\p{L}/u, (c) => c.toUpperCase());
const titleCase = (s) => s.replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
const hasLetter = (s) => /\p{L}/u.test(s);
const letters = (s) => (s.match(/\p{L}/gu) || []).length;
const allUpper = (s) => hasLetter(s) && s === s.toUpperCase() && s !== s.toLowerCase();
function sentenceStart(text, i) {
  let k = i - 1;
  while (k >= 0 && /[\s"'“‘(\[]/.test(text[k])) k--;
  return k < 0 || /[.!?…]/.test(text[k]) || text[k] === '\n';
}
/** default casing: a term with a capital in it is written exactly as given; an all-lower-case term is 'smart' */
function defaultCasing(term) { return term !== term.toLowerCase() ? 'exact' : 'smart'; }
function cased(to, casing, heard, text, at) {
  switch (casing) {
    case 'exact': return to;
    case 'lower': return to.toLowerCase();
    case 'upper': return to.toUpperCase();
    case 'title': return titleCase(to);
    case 'keep': if (heard.toLowerCase() === to.toLowerCase()) return heard; return cased(to, 'smart', heard, text, at);   // a word that already is the term keeps whatever case the model gave it
    default: {                                                           // smart: the term, plus what the sentence needs
      if (letters(heard) >= 2 && allUpper(heard)) return to.toUpperCase();
      if (to === to.toLowerCase() && sentenceStart(text, at)) return cap1(to);
      return to;
    }
  }
}

/* ---------- compile ---------- */
function compile(forms, { exclude = [] } = {}) {
  const root = new Map();
  const skip = new Set(exclude.map(norm));
  const conflicts = [];
  let size = 0, depthMax = 1;
  for (const f of forms) {
    const toks = tokenize(String(f.from));
    if (!toks.length) continue;
    const key = toks.map((t) => t.key).join(' ');
    if (skip.has(key)) continue;
    // the gaps the form was written with ("G.O.A.T" has "." gaps), kept so the same punctuation in the text still matches
    const gaps = toks.slice(1).map((t, i) => String(f.from).slice(toks[i].end, t.start));
    let node = root;
    for (let i = 0; i < toks.length; i++) {
      let nx = node.get(toks[i].key);
      if (!nx) { nx = { next: new Map(), hit: null }; node.set(toks[i].key, nx); }
      if (i === toks.length - 1) {
        if (nx.hit) { if (nx.hit.to !== f.to) conflicts.push({ from: f.from, kept: nx.hit.to, dropped: f.to }); break; }
        nx.hit = { to: f.to, casing: f.casing || defaultCasing(f.to), matchCase: !!f.matchCase, orig: String(f.from).trim(), gaps, n: toks.length, id: f.entryId };
        size++;
      }
      node = nx.next;
    }
    depthMax = Math.max(depthMax, toks.length);
  }

  /** longest match starting at token i: {n, hit, endTok} */
  function longestAt(text, toks, i) {
    let node = root, best = null;
    for (let k = i; k < toks.length && k - i < depthMax; k++) {
      if (k > i) {
        const gap = text.slice(toks[k - 1].end, toks[k].start);
        if (gap.length > 4 || !/^[^\p{L}\p{N}]*$/u.test(gap)) break;
      }
      const nx = node.get(toks[k].key);
      if (!nx) break;
      if (nx.hit) {
        let ok = true;
        for (let g = 0; g < nx.hit.gaps.length && ok; g++) ok = gapOk(text.slice(toks[i + g].end, toks[i + g + 1].start), nx.hit.gaps[g]);
        if (ok) best = { n: k - i + 1, hit: nx.hit };
      }
      node = nx.next;
    }
    return best;
  }

  function run(text) {
    const src = String(text ?? '');
    const hits = [], found = [];
    if (!size || !src) return { text: src, hits, found };
    const toks = tokenize(src);
    const spans = protectedSpans(src);
    let out = '', last = 0;
    for (let i = 0; i < toks.length;) {
      let m = longestAt(src, toks, i), end;
      if (!m) {                                                              // "rizz's": the possessive stays, the word is matched
        const t = toks[i];
        const ps = /^(.+?)'s$/.exec(t.key);
        const base = ps && root.get(ps[1]);
        if (base && base.hit && base.hit.n === 1) { m = { n: 1, hit: base.hit }; end = t.end - 2; }
      }
      if (!m) { i++; continue; }
      const s = toks[i].start; end = end ?? toks[i + m.n - 1].end;
      const heard = src.slice(s, end);
      if (inSpan(spans, s, end) || glued(src, s, end)) { i += m.n; continue; }
      if (m.hit.matchCase && heard !== m.hit.orig) { i += m.n; continue; }
      found.push(m.hit.to);
      const to = cased(m.hit.to, m.hit.casing, heard, src, s);
      if (to !== heard) { out += src.slice(last, s) + to; last = end; hits.push({ at: s, end, from: heard, to, id: m.hit.id }); }
      i += m.n;
    }
    return { text: out + src.slice(last), hits, found };
  }
  return { apply: (t) => run(t).text, explain: run, size, conflicts };
}

module.exports = { compile, tokenize, protectedSpans, defaultCasing, norm, cased, sentenceStart };
