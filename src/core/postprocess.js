'use strict';
/* Finals only: filler removal, user dictionary, snippets, casual style. Partials are never cleaned. */

const DEFAULT_FILLERS = ['um', 'uh', 'erm', 'hmm', 'uhm', 'euh', 'eh'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const B = '(?<![\\p{L}\\p{N}_])';
const A = '(?![\\p{L}\\p{N}_])';

function removeFillers(text, fillers) {
  const list = (fillers || []).map((f) => String(f).trim()).filter(Boolean);
  if (!list.length) return text;
  const re = new RegExp(`${B}(?:${list.map(esc).join('|')})+${A}[,.;]?\\s*`, 'giu');
  let out = text.replace(re, '');
  // a filler removed at the start leaves a lower-case sentence start
  if (out !== text && /^\p{Ll}/u.test(out) && !/^\p{Ll}/u.test(text)) out = out[0].toUpperCase() + out.slice(1);
  return out;
}

function applyPairs(text, pairs, { wholeUtteranceStripsPunct = false } = {}) {
  let out = text;
  for (const p of pairs || []) {
    const from = String(p.from ?? p.trigger ?? '').trim();
    if (!from) continue;
    const to = String(p.to ?? p.expansion ?? '');
    if (wholeUtteranceStripsPunct) {
      const bare = out.replace(/[\s.,!?;:]+$/u, '');
      if (bare.toLowerCase() === from.toLowerCase()) { out = to; continue; }
    }
    out = out.replace(new RegExp(`${B}${esc(from).replace(/\s+/g, '\\s+')}${A}`, 'giu'), () => to);
  }
  return out;
}

function tidy(text) {
  return text.replace(/\s+([,.;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}

function casual(text) {
  let out = text.replace(/\.(\s*)$/u, '$1');
  if (/^\p{Lu}\p{Ll}/u.test(out) && !/^(I|I'm|I'll|I've|I'd)\b/.test(out)) out = out[0].toLowerCase() + out.slice(1);
  return out;
}

/** clean(text, {fillers, dictionary, snippets, style:{casual}}) */
function clean(text, o = {}) {
  let t = String(text || '').normalize('NFC').replace(/[\r\n]+/g, ' ');
  t = removeFillers(t, o.fillers ?? DEFAULT_FILLERS);
  t = applyPairs(t, o.snippets, { wholeUtteranceStripsPunct: true });
  t = applyPairs(t, o.dictionary);
  t = tidy(t);
  if (o.style && o.style.casual) t = casual(t);
  return t;
}

module.exports = { clean, removeFillers, applyPairs, DEFAULT_FILLERS };
