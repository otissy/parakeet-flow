'use strict';
/* Contextual biasing (sherpa-onnx hotwords) for the Parakeet TDT model. Measured on this PC: see docs/slang-packs.md.
   sherpa-onnx 1.13.8 accepts hotwords for this model only with decodingMethod 'modified_beam_search' and a "bpe" modeling unit,
   which needs a sentencepiece-style vocabulary: we write one from the model's own tokens.txt (every piece at the same cost).
   build() writes <dir>/hotwords.txt and <dir>/bpe.vocab and returns the engine options, or null when there is nothing to bias.
   Strength is shown to the user as a percentage; src/slang/bias.js is the only place that converts it to a score.
   Per-word strength: a line "word :score". sherpa-onnx 1.13.8 (csrc/utils.cc EncodeHotwords + EncodeBase) reads a
   whitespace-separated token that STARTS with ':' as that line's boost score (and '#' / '@' as threshold / phrase markers);
   csrc/context-graph.cc uses the global hotwords_score for a line without one (or with 0). */
const fs = require('fs');
const path = require('path');
const B = require('./bias');

const MAX_TERMS = 3000;

/** terms: strings, or {term, bias} where bias is a whole percent (absent = the global strength) */
function build({ tokensFile, terms, dir, score = B.DEFAULT_SCORE }) {
  const seen = new Set(), lines = [];
  let perWord = 0;
  for (const t of terms || []) {
    const w = String(t && typeof t === 'object' ? t.term : t).toLowerCase().replace(/\s+/g, ' ').trim();
    if (w.length < 2 || w.length > 60 || seen.has(w)) continue;
    if (w.split(' ').some((x) => /^[:#@]/.test(x))) continue;     // sherpa-onnx would read that word as a score/threshold/phrase marker
    seen.add(w);
    const pct = t && typeof t === 'object' && t.bias != null ? B.normPercent(t.bias) : null;
    if (pct !== null) perWord++;
    lines.push(pct !== null ? `${w} :${B.percentToScore(pct)}` : w);
    if (lines.length >= MAX_TERMS) break;
  }
  if (!lines.length) return null;
  const pieces = fs.readFileSync(tokensFile, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split(' ')[0]);
  fs.mkdirSync(dir, { recursive: true });
  const bpeVocab = path.join(dir, 'bpe.vocab'), hotwordsFile = path.join(dir, 'hotwords.txt');
  fs.writeFileSync(bpeVocab, pieces.map((t, i) => (i < 5 ? t + '\t0' : t + '\t-1')).join('\n') + '\n');
  fs.writeFileSync(hotwordsFile, lines.join('\n') + '\n');
  const hotwordsScore = B.normScore(score);
  return { hotwordsFile, bpeVocab, hotwordsScore, percent: B.scoreToPercent(hotwordsScore), count: lines.length, perWord };
}

/** the log line for a built hotwords set: counts and the percentage only (never a term) */
const logLine = (h) => `hotwords on terms=${h.count} bias=${h.percent}%${h.perWord ? ` own-bias=${h.perWord}` : ''}`;

/** the terms of the enabled packs, for build() */
const termsOf = (packs) => packs.flatMap((p) => p.terms.map((t) => (t.bias != null ? { term: t.term, bias: t.bias } : t.term)));

/** "restart the engine once the edits settle": every call pushes the restart back by `ms`; nothing happens while
    shouldRestart() is false (biasing off and the engine not using hotwords). Returns the function to call on each change. */
function settleRestart({ shouldRestart, restart, ms = 2500, timers = { setTimeout, clearTimeout } }) {
  let t = null;
  const fn = () => { if (!shouldRestart()) return false; timers.clearTimeout(t); t = timers.setTimeout(() => { t = null; restart(); }, ms); return true; };
  fn.pending = () => t !== null;
  return fn;
}

module.exports = { build, termsOf, logLine, settleRestart, MAX_TERMS };
