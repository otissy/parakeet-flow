'use strict';
/* Score measure.js results against the starter pack, and derive "heard" misrecognition candidates.
   usage: node analyze.js candidates <measureA.json> <out.json>            what Parakeet wrote for each term that is not the term
          node analyze.js score <pack.json,pack.json> <measure.json> [out.json]    right with no pack vs right with the pack(s)
   "right" = the preferred spelling appears in the text as whole words, case-sensitive (the carrier sentence is ignored). */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..', '..');
const P = require(path.join(root, 'src/slang/pack.js'));
const M = require(path.join(root, 'src/slang/matcher.js'));
const { COMMON } = require(path.join(root, 'src/slang/common.js'));
const { MODEL_DIR } = require('./measure.js');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rightExact = (text, term) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(term)}(?![\\p{L}\\p{N}])`, 'u').test(text);
const rightAnyCase = (text, term) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(term)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
// real words, names and idioms that a measured output happened to be: rewriting them would damage ordinary sentences
const REJECT_HEARD = new Set(['phantom', 'daddy', 'loki', 'earl', 'derek', 'hello', 'wiley', 'raffle', 'murph', 'murphs', 'grim', 'grims', 'daisy', 'sports', 'to cheat', 'alts', 'gotcha',
  'yes too', 'period', 'being chilling', "it's different", 'ike', 'the ike', 'heike', 'erik', 'errol', 'moxie', 'subs', 'motes', 'lol', 'lola', 'coach', 'have one', 'bread crumbing',
  'beast mode', 'atomic', 'girl boss', 'ariel', 'coast dream', 'giant', 'gap', 'eggs', 'tile', 'up there was something', 'clap', 'low hell', 'dora', 'crack', 'overpower', 'speedrun', 'sink',
  'daring', "he'd", 'vm', 'rm', 'waddy', 'ibaka', 'moats', 'cold stream', 'was sub', 'has too', 'rise up', 'i call', 'ow e', "daddy's", 'breezy', 'gee c', 'iker', 'drolly', 'isk']);
const JUNK_LEAD = new Set(['he', 'it', 'hit', 'a', 'i', 'at', 'hey', 'is', 'his', 'her', 'or', 'and', 'she', 'we', 'as', 'an', 'the']);

/** what Parakeet wrote for the term itself: carrier removed, a stray one-word carrier remnant dropped */
function heardOf(row) {
  let t = String(row.text || '').trim();
  t = t.replace(/[\s,.!?]*that was something[\s,.!?]*$/i, '').replace(/[\s,.!?]*that was somethin[\s,.!?]*$/i, '');
  t = t.replace(/^(yeah|yes|yah|ya|yay|yea|yup)\b[\s,.!?]*/i, '');
  t = t.replace(/^[\s,.!?]+|[\s,.!?]+$/g, '');
  const m = /^(\S+)[ ,]+(.+)$/.exec(t);
  if (m && JUNK_LEAD.has(m[1].toLowerCase().replace(/[^a-z]/g, '')) && !row.term.toLowerCase().startsWith(m[1].toLowerCase())) t = m[2];
  return t;
}

function vocabPieces() {
  return new Set(fs.readFileSync(path.join(MODEL_DIR, 'tokens.txt'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split(' ')[0]));
}

if (require.main === module) {
  const [mode, a, b, c] = process.argv.slice(2);
  if (mode === 'candidates') {
    const rows = JSON.parse(fs.readFileSync(a, 'utf8'));
    const pieces = vocabPieces();
    const out = [], rejected = [];
    for (const r of rows) {
      const h = heardOf(r);
      if (!h || h.length > 60) { rejected.push({ term: r.term, heard: h, why: 'empty or too long' }); continue; }
      if (rightExact(h, r.term) || h.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === r.term.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()) continue;      // already the term
      const words = h.toLowerCase().split(/\s+/);
      const squash = (s) => s.toLowerCase().replace(/[\s-]+/g, '');
      if (REJECT_HEARD.has(h.toLowerCase())) { rejected.push({ term: r.term, heard: h, why: 'real word, name or idiom' }); continue; }
      if (/^y[ae]|^yo\b|^y\s/i.test(h) && !/^y/i.test(r.term)) { rejected.push({ term: r.term, heard: h, why: 'carrier word fused into the term' }); continue; }
      if (squash(h) === squash(r.term) && r.term === r.term.toLowerCase()) { rejected.push({ term: r.term, heard: h, why: 'the standard spelling of a compound' }); continue; }
      const why = words.length > 5 ? 'too many words' : null;
      // a single word the model's own vocabulary holds as ONE piece is an ordinary word: not a safe rewrite rule
      const single = words.length === 1 && (pieces.has('▁' + words[0]) || pieces.has('▁' + h));
      if (why) rejected.push({ term: r.term, heard: h, why });
      else if (single) rejected.push({ term: r.term, heard: h, why: 'ordinary word (one piece in the model vocabulary)' });
      else if (words.length === 1 && COMMON.has(words[0])) rejected.push({ term: r.term, heard: h, why: 'very common word' });
      else out.push({ term: r.term, heard: h });
    }
    fs.writeFileSync(b, JSON.stringify({ candidates: out, rejected }, null, 1));
    console.log('candidates', out.length, 'rejected', rejected.length);
  } else if (mode === 'score') {
    const packs = a.split(',').map((f) => P.parsePackText(fs.readFileSync(f, 'utf8'), { fileName: path.basename(f), builtin: true }).pack);
    const matcher = M.compile(P.toForms(packs));
    const terms = new Set(packs.flatMap((p) => p.terms.map((t) => t.term)));
    const rows = JSON.parse(fs.readFileSync(b, 'utf8')).filter((r) => terms.has(r.term));
    let rightBefore = 0, rightAfter = 0, ciBefore = 0, broken = 0, fixed = 0, still = 0;
    const detail = [];
    for (const r of rows) {
      const before = rightExact(r.text, r.term);
      const after = rightExact(matcher.apply(r.text), r.term);
      if (before) rightBefore++;
      if (rightAnyCase(r.text, r.term)) ciBefore++;
      if (after) rightAfter++;
      if (before && !after) broken++;
      if (!before && after) fixed++;
      if (!after) still++;
      detail.push({ term: r.term, text: r.text, after: matcher.apply(r.text), before, afterOk: after });
    }
    const res = { terms: rows.length, rightBefore, rightBeforeAnyCase: ciBefore, rightAfter, fixed, broken, stillWrong: still };
    console.log(JSON.stringify(res));
    if (c) fs.writeFileSync(c, JSON.stringify({ summary: res, detail }, null, 1));
  }
}
module.exports = { heardOf, rightExact, rightAnyCase };
