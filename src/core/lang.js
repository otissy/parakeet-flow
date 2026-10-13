'use strict';
/* Tiny Dutch/English detector on common function words. Enough to pick the translation direction and to
   reject a "translation" that stayed in the source language. Returns 'nl' | 'en' | null (unsure). */
const NL = new Set(['de', 'het', 'een', 'ik', 'je', 'jij', 'u', 'dat', 'niet', 'maar', 'ook', 'met', 'voor', 'zijn', 'wat', 'kan', 'naar', 'dit', 'ze', 'we', 'wij', 'hebben', 'heb', 'nog', 'wel', 'als', 'mijn', 'ben', 'dan', 'er', 'om', 'bij', 'moet', 'wil', 'morgen', 'vandaag', 'goed', 'graag', 'hoe', 'waar', 'want', 'omdat', 'jullie', 'zou', 'zal', 'deze', 'die', 'aan', 'uit', 'over', 'worden', 'wordt', 'geen', 'veel', 'alsjeblieft', 'bedankt', 'hallo', 'heel', 'misschien', 'altijd', 'nooit', 'eigenlijk', 'gewoon', 'nog', 'even']);
const EN = new Set(['the', 'and', 'you', 'that', 'it', 'of', 'to', 'for', 'with', 'this', 'are', 'was', 'have', 'not', 'but', 'my', 'can', 'what', 'i', 'we', 'they', 'will', 'would', 'should', 'could', 'be', 'on', 'at', 'from', 'your', 'tomorrow', 'today', 'please', 'thanks', 'hello', 'how', 'where', 'because', 'about', 'there', 'their', 'these', 'those', 'just', 'really', 'maybe', 'always', 'never', "i'm", "don't", "it's", "i'll", "that's", 'been', 'has', 'had', 'do', 'does', 'did']);

function detectLang(text) {
  const w = String(text || '').toLowerCase().normalize('NFC').split(/[^\p{L}']+/u).filter(Boolean);
  if (!w.length) return null;
  let nl = 0, en = 0;
  for (const x of w) { if (NL.has(x)) nl++; if (EN.has(x)) en++; }
  if (nl === en) return null;
  const hi = Math.max(nl, en), lo = Math.min(nl, en);
  if (hi < 1 || (w.length > 3 && hi < 2 && lo > 0)) return null;
  return nl > en ? 'nl' : 'en';
}

module.exports = { detectLang };
