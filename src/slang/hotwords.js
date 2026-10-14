'use strict';
/* Contextual biasing (sherpa-onnx hotwords) for the Parakeet TDT model. Measured on this PC: see docs/slang-packs.md.
   sherpa-onnx 1.13.8 accepts hotwords for this model only with decodingMethod 'modified_beam_search' and a "bpe" modeling unit,
   which needs a sentencepiece-style vocabulary: we write one from the model's own tokens.txt (every piece at the same cost).
   build() writes <dir>/hotwords.txt and <dir>/bpe.vocab and returns the engine options, or null when there is nothing to bias. */
const fs = require('fs');
const path = require('path');

const MAX_TERMS = 3000;

function build({ tokensFile, terms, dir, score = 1.5 }) {
  const uniq = [...new Set((terms || []).map((t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim()).filter((t) => t.length >= 2 && t.length <= 60))].slice(0, MAX_TERMS);
  if (!uniq.length) return null;
  const pieces = fs.readFileSync(tokensFile, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split(' ')[0]);
  fs.mkdirSync(dir, { recursive: true });
  const bpeVocab = path.join(dir, 'bpe.vocab'), hotwordsFile = path.join(dir, 'hotwords.txt');
  fs.writeFileSync(bpeVocab, pieces.map((t, i) => (i < 5 ? t + '\t0' : t + '\t-1')).join('\n') + '\n');
  fs.writeFileSync(hotwordsFile, uniq.join('\n') + '\n');
  return { hotwordsFile, bpeVocab, hotwordsScore: Math.min(3, Math.max(0.1, +score || 1.5)), count: uniq.length };
}

/** the terms of the enabled packs, for build() */
const termsOf = (packs) => packs.flatMap((p) => p.terms.map((t) => t.term));

module.exports = { build, termsOf, MAX_TERMS };
