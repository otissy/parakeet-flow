'use strict';
/* What customization sync may send, and nothing else. This is an ALLOWLIST: a setting that is not named here never leaves
   the PC, so a new setting stays local until somebody decides otherwise (.tests/sync checks every setting is classified).
   Never sent: dictated text, history, notes, meetings, tokens, logs, and anything tied to this one PC (microphone, GPU,
   threads, file paths). Pure code: no file, no network. */
const SETTING_PATHS = Object.freeze([
  // hotkeys
  'hotkey', 'toggleOn', 'toggleKey', 'notes.noteHotkey',
  // UI and typing preferences
  'liveMode', 'trailingSpace', 'style.casual',
  'typing.newline', 'typing.enterAfterFinal', 'typing.live', 'typing.terminalMethod', 'typing.otherMethod', 'typing.insertApps',
  // voice commands
  'commands.enabled', 'commands.carryMs', 'commands.list',
  'notes.enabled', 'notes.triggers', 'notes.autoRoute',
  // tone
  'tone.enabled', 'tone.apps',
  // translate
  'translate.enabled', 'translate.target',
  // cleanup preferences
  'fillers', 'cleanup.enabled', 'cleanup.timeoutMs', 'cleanup.idleMin',
  // custom words: which packs, and how strongly they bias recognition
  'slang.enabled', 'slang.biasing.enabled', 'slang.biasing.score',
]);

/* Settings that deliberately stay on this PC (the reason is what a reader needs when adding a setting). */
const LOCAL_ONLY = Object.freeze({
  micId: 'device', keepMicOpen: 'device', provider: 'device', threads: 'device', 'cleanup.threads': 'device', endpointMs: 'device tuning', partialMs: 'device tuning',
  'whisper.enabled': 'depends on the microphone', 'whisper.gain': 'depends on the microphone', 'whisper.vadThreshold': 'depends on the microphone',
  language: 'fixed', hotkeyV: 'file format', gestureV: 'file format',
  launchAtLogin: 'device', historyEnabled: 'privacy choice per PC', 'mcp.shareHistory': 'privacy choice per PC',
  deny: 'safety list per PC', snippets: 'may hold personal text', userName: 'personal',
  'notes.notion.enabled': 'account', 'notes.notion.targetType': 'account', 'notes.notion.targetId': 'account', 'notes.notion.titleProperty': 'account',
  'notes.export.enabled': 'file path', 'notes.export.folder': 'file path',
  'sync.enabled': 'sync itself is switched per PC', 'updates.auto': 'network choice per PC', 'updates.installAuto': 'restart choice per PC', 'updates.seen': 'which release notes this PC showed',
  'readAloud.enabled': 'it presses Ctrl+C in apps on this PC and needs the voice downloaded on this PC', 'readAloud.hotkey': 'a key chord is per PC', 'readAloud.voice': 'follows the voice installed on this PC', 'readAloud.speed': 'per PC',
});

const TERM_FIELDS = Object.freeze(['term', 'variants', 'heard', 'category', 'lang', 'casing', 'matchCase', 'allowCommon', 'bias']);
const SETTING_SET = new Set(SETTING_PATHS);
const PACK_RE = /^pack:[a-z0-9][a-z0-9_-]{0,47}$/;
const WORD_RE = /^word:.{1,90}$/su;
const DICT_RE = /^dict:.{1,200}$/su;

function isAllowedKey(k) {
  return typeof k === 'string' && (SETTING_SET.has(k) || PACK_RE.test(k) || WORD_RE.test(k) || DICT_RE.test(k));
}
const isDynamic = (k) => !SETTING_SET.has(k);

const getPath = (o, p) => p.split('.').reduce((a, k) => (a === null || a === undefined ? undefined : a[k]), o);
function setPath(o, p, v) {
  const parts = p.split('.'), last = parts.pop();
  let a = o;
  for (const k of parts) a = a[k] = a[k] && typeof a[k] === 'object' ? { ...a[k] } : {};
  a[last] = v;
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function pickTerm(t) {
  const out = {};
  if (!t || typeof t !== 'object') return null;
  for (const f of TERM_FIELDS) if (t[f] !== undefined) out[f] = clone(t[f]);
  return typeof out.term === 'string' && out.term ? out : null;
}
const wordKey = (term) => 'word:' + String(term).toLowerCase();
const dictKey = (from) => 'dict:' + String(from).toLowerCase();

/** settings (already normalized by the Store) + the My terms words -> {key: value}, every key allowlisted */
function flatten(settings, terms = []) {
  const out = {};
  for (const p of SETTING_PATHS) { const v = getPath(settings, p); if (v !== undefined) out[p] = clone(v); }
  for (const [id, on] of Object.entries(settings?.slang?.packs || {})) { const k = 'pack:' + id; if (isAllowedKey(k) && typeof on === 'boolean') out[k] = on; }
  for (const d of settings?.dictionary || []) { const k = dictKey(d.from); if (isAllowedKey(k)) out[k] = { from: String(d.from), to: String(d.to ?? '') }; }
  for (const t of terms) { const p = pickTerm(t); if (p && isAllowedKey(wordKey(p.term))) out[wordKey(p.term)] = p; }
  return out;
}

/** a key -> value map (null = deleted) onto a copy of the settings: returns only the top-level settings that change, for Store.set */
function settingsPatch(settings, changes) {
  const next = clone(settings), touched = new Set();
  let dict = null;
  for (const [k, v] of Object.entries(changes)) {
    if (SETTING_SET.has(k)) { if (v !== null && v !== undefined) { setPath(next, k, clone(v)); touched.add(k.split('.')[0]); } } else if (PACK_RE.test(k)) {
      next.slang.packs = next.slang.packs || {};
      if (typeof v === 'boolean') next.slang.packs[k.slice(5)] = v; else delete next.slang.packs[k.slice(5)];
      touched.add('slang');
    } else if (DICT_RE.test(k)) {
      dict = dict || new Map((next.dictionary || []).map((d) => [dictKey(d.from), d]));
      if (v && typeof v === 'object' && typeof v.from === 'string') dict.set(k, { from: v.from, to: String(v.to ?? '') }); else dict.delete(k);
    }
  }
  if (dict) { next.dictionary = [...dict.values()]; touched.add('dictionary'); }
  return Object.fromEntries([...touched].map((t) => [t, next[t]]));
}

/** the word part of the same map: {upsert: [term], remove: [lowercase term]} */
function wordChanges(changes) {
  const upsert = [], remove = [];
  for (const [k, v] of Object.entries(changes)) {
    if (!WORD_RE.test(k)) continue;
    const t = pickTerm(v);
    if (t) upsert.push(t); else remove.push(k.slice(5));
  }
  return { upsert, remove };
}

/** THE upload document: the only thing that is ever sent as customization. Every key and word field goes through the allowlist here. */
function buildPayload(keys) {
  const out = {};
  for (const [k, e] of Object.entries(keys || {})) {
    if (!isAllowedKey(k) || !e || typeof e !== 'object') continue;
    const v = WORD_RE.test(k) && !SETTING_SET.has(k) && e.v !== null ? pickTerm(e.v) : clone(e.v ?? null);
    out[k] = { v, t: Number(e.t) || 0, by: String(e.by || '').slice(0, 40) };
  }
  return { schema: 1, keys: out };
}

/** what a person calls a key (the Sync section's conflict list) */
function keyLabel(k) {
  if (k.startsWith('word:')) return 'Word "' + k.slice(5) + '"';
  if (k.startsWith('dict:')) return 'Dictionary "' + k.slice(5) + '"';
  if (k.startsWith('pack:')) return 'Pack "' + k.slice(5) + '"';
  return k;
}

module.exports = { SETTING_PATHS, LOCAL_ONLY, TERM_FIELDS, isAllowedKey, isDynamic, flatten, settingsPatch, wordChanges, buildPayload, getPath, keyLabel, wordKey };
