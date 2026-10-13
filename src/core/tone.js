'use strict';
/* Per-app tone. The foreground app (process name or window title, from the Win32 helper) picks a profile:
     default  : as the model writes it (plus the global Style setting)
     casual   : lower-case start allowed, no final full stop
     formal   : capital letters, full stop, no slang/contractions (English)
     code     : no auto-capitalisation, no trailing full stop, never a trailing space (terminals, editors)
   Finals only. The deny-list is checked before this ever runs (LiveTyper.begin), so it always wins. */
const { casual } = require('./postprocess');
const { detectLang } = require('./lang');

const PROFILES = ['default', 'casual', 'formal', 'code'];

/** built-ins; a user row (Settings > App tone) is checked first and overrides. proc is the lower-case
    process name without .exe (spaces are underscores), title is a lower-case window-title substring */
const BUILTIN_APPS = [
  { proc: 'discord', profile: 'casual' }, { title: 'discord', profile: 'casual' },
  { proc: 'whatsapp', profile: 'casual' }, { title: 'whatsapp', profile: 'casual' },
  { proc: 'telegram', profile: 'casual' }, { proc: 'signal', profile: 'casual' },
  { proc: 'outlook', profile: 'formal' }, { proc: 'olk', profile: 'formal' }, { proc: 'thunderbird', profile: 'formal' },
  { title: 'gmail', profile: 'formal' }, { title: 'outlook', profile: 'formal' },
  { proc: 'code', profile: 'code' }, { proc: 'code_-_insiders', profile: 'code' }, { proc: 'cursor', profile: 'code' }, { title: 'visual studio code', profile: 'code' },
  { proc: 'windowsterminal', profile: 'code' }, { proc: 'wt', profile: 'code' }, { proc: 'cmd', profile: 'code' }, { proc: 'powershell', profile: 'code' },
  { proc: 'pwsh', profile: 'code' }, { proc: 'conhost', profile: 'code' }, { proc: 'mintty', profile: 'code' }, { proc: 'alacritty', profile: 'code' },
  { proc: 'wezterm-gui', profile: 'code' }, { proc: 'devenv', profile: 'code' }, { proc: 'idea64', profile: 'code' }, { proc: 'pycharm64', profile: 'code' },
  { title: 'command prompt', profile: 'code' }, { title: 'windows powershell', profile: 'code' },
];

const procOf = (fg) => String(fg?.proc || '').toLowerCase().replace(/\.exe$/, '');
const titleOf = (fg) => String(fg?.title || '').toLowerCase();

function rowHits(row, proc, title) {
  if (row.proc) return proc === row.proc;
  if (row.title) return title.includes(row.title);
  const m = String(row.match || '').toLowerCase().replace(/\.exe$/, '').trim();    // user row: process name or title text
  return !!m && (proc === m || title.includes(m));
}

/** @returns {{profile:string, source:'user'|'builtin'|'none', match?:string}} */
function resolveProfile(fg, { enabled = true, apps = [], builtin = BUILTIN_APPS } = {}) {
  if (!enabled || !fg) return { profile: 'default', source: 'none' };
  const proc = procOf(fg), title = titleOf(fg);
  for (const r of apps) if (PROFILES.includes(r.profile) && rowHits(r, proc, title)) return { profile: r.profile, source: 'user', match: r.match };
  for (const r of builtin) if (rowHits(r, proc, title)) return { profile: r.profile, source: 'builtin', match: r.proc || r.title };
  return { profile: 'default', source: 'none' };
}

const EN_FORMAL = [[/\bgonna\b/gi, 'going to'], [/\bwanna\b/gi, 'want to'], [/\bgotta\b/gi, 'have to'], [/\bkinda\b/gi, 'somewhat'], [/\byeah\b|\byep\b/gi, 'yes'], [/\bnope\b/gi, 'no'],
  [/\bthx\b|\bthanks\b/gi, 'thank you'], [/\bcan't\b/gi, 'cannot'], [/\bwon't\b/gi, 'will not'], [/\bdon't\b/gi, 'do not'], [/\bdoesn't\b/gi, 'does not'], [/\bdidn't\b/gi, 'did not'],
  [/\bisn't\b/gi, 'is not'], [/\baren't\b/gi, 'are not'], [/\bwasn't\b/gi, 'was not'], [/\bI'm\b/gi, 'I am'], [/\bI've\b/gi, 'I have'], [/\bI'll\b/gi, 'I will'], [/\bI'd\b/gi, 'I would'],
  [/\bit's\b/gi, 'it is'], [/\bthat's\b/gi, 'that is'], [/\bwe're\b/gi, 'we are'], [/\byou're\b/gi, 'you are'], [/\bthey're\b/gi, 'they are'], [/\blet's\b/gi, 'let us']];
const NL_FORMAL = [[/\bff\b/gi, 'even'], [/\bjeetje\b/gi, ''], [/\bthx\b/gi, 'dank u wel']];

const capSentences = (t) => t.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_m, a, b) => a + b.toUpperCase());
const keepCase = (from, to) => (/^\p{Lu}/u.test(from) && to ? to[0].toUpperCase() + to.slice(1) : to);

function formal(text) {
  let t = String(text || '').trim();
  if (!t) return t;
  const lang = detectLang(t);
  const table = lang === 'nl' ? NL_FORMAL : lang === 'en' ? EN_FORMAL : [];
  for (const [re, to] of table) t = t.replace(re, (m) => keepCase(m, to));
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
  t = capSentences(t).replace(/\bi\b/g, 'I');
  t = t[0].toUpperCase() + t.slice(1);
  if (!/[.!?…:]$/u.test(t)) t += '.';
  return t;
}

/** code / terminal: no auto-capital on the first word (unless it is I, an acronym or already camel-ish), no final full stop */
function codeTone(text) {
  let t = String(text || '');
  const m = /^(\p{Lu})(\p{Ll}+)(\b.*)$/su.exec(t);
  if (m && !/^I$/.test(m[1] + m[2]) && !/^I'/.test(t)) t = m[1].toLowerCase() + m[2] + m[3];
  return t.replace(/\.(\s*)$/u, '$1');
}

/** apply a profile to a finished segment. `globalCasual` is the existing Style setting (used by `default`). */
function applyTone(text, profile = 'default', { globalCasual = false } = {}) {
  const t = String(text || '');
  if (!t) return t;
  if (profile === 'casual') return casual(t);
  if (profile === 'formal') return formal(t);
  if (profile === 'code') return codeTone(t);
  return globalCasual ? casual(t) : t;
}

module.exports = { PROFILES, BUILTIN_APPS, resolveProfile, applyTone, formal, codeTone };
