'use strict';
/* Guards for model output. The model may only FIX text (cleanup) or MOVE it between Dutch and English
   (translate); anything else falls back to the original. Pure functions, no I/O. */
const { detectLang } = require('../core/lang');

const wordsOf = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}'’\s]+/gu, ' ').replace(/’/g, "'").split(/\s+/).filter(Boolean);

function lev(a, b) {            // works on strings and arrays
  const n = a.length, m = b.length;
  if (!n) return m; if (!m) return n;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[m];
}
const ratio = (a, b) => { const d = Math.max(a.length, b.length); return d ? 1 - lev(a, b) / d : 1; };   // 1 = identical

const BAD = /<\/?think>|<\|im_(start|end)\|>|```/i;
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/u;
const PREAMBLE = /^(here(?:'s| is)|sure|certainly|of course|corrected|translation|the corrected|output)\b[^a-z0-9]*:?/i;

/** strip wrapping quotes / stray whitespace a model likes to add */
function tidyOutput(s) {
  let t = String(s ?? '').replace(/\r/g, '').trim();
  t = t.replace(/^<text>\s*|\s*<\/text>$/gi, '').trim();
  if (/^(["“'‘]).*(["”'’])$/su.test(t) && !/["“”]/.test(t.slice(1, -1))) t = t.slice(1, -1).trim();
  return t.replace(/\s*\n+\s*/g, ' ');
}

/** cleanup: same words, better punctuation/casing. thresholds are deliberately tight for a 0.6B model */
function acceptCleanup(original, output, { minCharSim = 0.8, maxWordDiff = 0.34, minLen = 0.7, maxLen = 1.4 } = {}) {
  const o = String(original ?? '').trim(); const t = tidyOutput(output);
  if (!o) return { ok: false, reason: 'empty original' };
  if (!t) return { ok: false, reason: 'empty output' };
  if (BAD.test(output) || CJK.test(t)) return { ok: false, reason: 'garbage' };
  if (PREAMBLE.test(t) && !PREAMBLE.test(o)) return { ok: false, reason: 'preamble' };
  const ow = wordsOf(o), tw = wordsOf(t);
  if (!tw.length) return { ok: false, reason: 'no words' };
  if (t.length / o.length < minLen || t.length / o.length > maxLen) return { ok: false, reason: 'length' };
  const wd = lev(ow, tw) / Math.max(ow.length, tw.length);
  if (wd > maxWordDiff) return { ok: false, reason: 'words differ', wordDiff: wd };
  const cs = ratio(ow.join(' '), tw.join(' '));
  if (cs < minCharSim) return { ok: false, reason: 'chars differ', charSim: cs };
  const A = new Set(ow), B = new Set(tw); let inter = 0; for (const x of A) if (B.has(x)) inter++;
  const jac = inter / (A.size + B.size - inter);
  if (jac < 0.6) return { ok: false, reason: 'word set differs', jaccard: jac };
  return { ok: true, text: t, wordDiff: wd, charSim: cs, jaccard: jac };
}

/** vocabulary terms present in the original must survive the model: still there (any case), and exactly as spelled when the spelling has a capital (TikTok, GG) */
function keepsVocab(original, output, vocab) {
  const o = String(original ?? ''), t = String(output ?? ''), tl = t.toLowerCase();
  for (const term of vocab || []) {
    if (!o.toLowerCase().includes(term.toLowerCase())) continue;
    if (!tl.includes(term.toLowerCase())) return false;
    if (term !== term.toLowerCase() && o.includes(term) && !t.includes(term)) return false;
  }
  return true;
}

/** translate: no similarity possible, so check it looks like a translation into `target` ('en'|'nl') */
function acceptTranslation(original, output, target) {
  const o = String(original ?? '').trim(); const t = tidyOutput(output);
  if (!o) return { ok: false, reason: 'empty original' };
  if (!t) return { ok: false, reason: 'empty output' };
  if (BAD.test(output) || CJK.test(t)) return { ok: false, reason: 'garbage' };
  if (PREAMBLE.test(t) && !PREAMBLE.test(o)) return { ok: false, reason: 'preamble' };
  const r = t.length / o.length;
  if (r < 0.4 || r > 2.8) return { ok: false, reason: 'length' };
  const lang = detectLang(t);
  if (lang && target && lang !== target) return { ok: false, reason: 'wrong language' };
  if (wordsOf(o).join(' ') === wordsOf(t).join(' ') && detectLang(o) && detectLang(o) !== target) return { ok: false, reason: 'unchanged' };
  return { ok: true, text: t };
}

module.exports = { keepsVocab, acceptCleanup, acceptTranslation, tidyOutput, lev, ratio, wordsOf };
