'use strict';
/* Turns the selected text into short pieces for the voice: whitespace tidied, then cut at sentence ends (and, for a sentence that
   is still too long, at a comma / semicolon / colon, and last at a space), so the first piece is small and speech starts quickly
   and every later piece is synthesized while the earlier ones play. Pure; no I/O. */

const MAX_TOTAL = 60000;        // characters read per press; the rest is dropped (the pill says so)
const FIRST_MAX = 140;          // the first piece is kept short: speech starts sooner
const NEXT_MAX = 320;

/** one line of text: control characters out, runs of space collapsed, paragraph breaks kept as a break marker */
function tidy(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/­|​|‌|‍|﻿/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n\n')
    .trim();
}

const ABBR = /\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.g|i\.e|bijv|bv|nr|ca|blz|approx|no)\.$/i;

/** sentences, in order. A line break is a boundary too (a list item, a heading, a paragraph) */
function sentences(text) {
  const out = [];
  for (const block of tidy(text).split('\n')) {
    const b = block.trim();
    if (!b) continue;
    // a boundary: . ! ? … (and closing quotes / brackets) followed by space and something that is not a lowercase continuation of an abbreviation
    const re = /[.!?…]+["'”’)\]]*(?=\s+|$)/g;
    let start = 0, m;
    while ((m = re.exec(b))) {
      const end = m.index + m[0].length;
      const piece = b.slice(start, end).trim();
      if (ABBR.test(piece) && end < b.length) continue;                     // "Dr." "e.g." do not end a sentence
      if (/^\d+\.$/.test(piece.split(/\s+/).pop()) && end < b.length && /^\s+[a-z]/.test(b.slice(end))) continue;   // "3. a" style numbering inside a sentence
      if (piece) out.push(piece);
      start = end;
    }
    const rest = b.slice(start).trim();
    if (rest) out.push(rest);
  }
  return out;
}

/** cut a too-long sentence at the best place at or before max: a clause mark, else a space, else a hard cut */
function cutLong(s, max) {
  const parts = [];
  let rest = s;
  while (rest.length > max) {
    const win = rest.slice(0, max);
    let at = Math.max(win.lastIndexOf(', '), win.lastIndexOf('; '), win.lastIndexOf(': '), win.lastIndexOf(' - '), win.lastIndexOf(' — '));
    if (at < max * 0.4) at = win.lastIndexOf(' ');
    if (at < max * 0.25) at = max - 1;
    parts.push(rest.slice(0, at + 1).trim());
    rest = rest.slice(at + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** {chunks:[string], truncated:boolean, chars:number}. Short sentences are joined up to the limit; the first chunk uses the smaller limit */
function chunkText(text, { firstMax = FIRST_MAX, nextMax = NEXT_MAX, maxTotal = MAX_TOTAL } = {}) {
  let all = tidy(text);
  let truncated = false;
  if (all.length > maxTotal) { all = all.slice(0, maxTotal); truncated = true; }
  const chunks = [];
  let cur = '';
  const limit = () => (chunks.length === 0 ? firstMax : nextMax);
  const flush = () => { if (cur) { chunks.push(cur); cur = ''; } };
  for (const para of all.split(/\n{2,}/)) {                              // a paragraph break is a pause: a piece never spans it
    for (const s of sentences(para)) {
      for (const piece of s.length > nextMax ? cutLong(s, nextMax) : [s]) {
        if (cur && (cur.length + 1 + piece.length > limit())) flush();
        if (!cur && piece.length > limit() && chunks.length === 0) {       // a long first sentence: cut it small so the voice starts soon
          const cuts = cutLong(piece, firstMax);
          for (let i = 0; i < cuts.length - 1; i++) chunks.push(cuts[i]);
          cur = cuts[cuts.length - 1];
          continue;
        }
        cur = cur ? cur + ' ' + piece : piece;
      }
    }
    flush();
  }
  const speakable = chunks.filter((c) => /[\p{L}\p{N}]/u.test(c));      // a piece of only punctuation has nothing to say
  return { chunks: speakable, truncated, chars: all.length };
}

module.exports = { chunkText, sentences, tidy, cutLong, MAX_TOTAL, FIRST_MAX, NEXT_MAX };
