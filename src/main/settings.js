'use strict';
/* Settings, stats and (opt-in) history, as small JSON files in the user-data folder.
   Stats hold counts only; history holds text ONLY when the user turned it on. Nothing here is logged. */
const fs = require('fs');
const path = require('path');
const { DEFAULT_FILLERS } = require('../core/postprocess');
const { DEFAULT_DENY } = require('../core/deny');
const { ACTIONS, DEFAULT_COMMANDS, DEFAULT_NOTE_TRIGGERS } = require('../core/commands');
const { PROFILES } = require('../core/tone');

const DEFAULTS = {
  hotkey: { vks: [0x13], label: 'Pause' },   // lone key: no modifier changes what Backspace does; not an OBS / Rocket League default
  mode: 'hold',                  // 'hold' | 'toggle' (double-tap always starts hands-free)
  liveMode: 'aggressive',        // 'aggressive' | 'stable'
  provider: 'cpu', threads: 2,
  micId: '', keepMicOpen: false,
  language: 'auto',
  endpointMs: 500, partialMs: 400,
  fillers: DEFAULT_FILLERS, deny: DEFAULT_DENY,
  trailingSpace: false, historyEnabled: false, launchAtLogin: false,
  style: { casual: false },
  dictionary: [], snippets: [],
  userName: '',
  // voice commands: whole-segment phrases on finals, English + Dutch, never typed (see core/commands.js)
  commands: { enabled: true, carryMs: 120000, list: DEFAULT_COMMANDS },
  // per-app tone: user rows are checked before the built-ins in core/tone.js; the deny-list still wins
  tone: { enabled: true, apps: [] },
  // translate (EXPERIMENTAL, local 0.6B model): 'swap' = type the other of Dutch/English
  translate: { enabled: false, target: 'swap' },
  // whisper mode: more input gain, lower VAD threshold (normal threshold is 0.5)
  whisper: { enabled: false, gain: 3, vadThreshold: 0.3 },
  // optional local-model cleanup of FINALS (off by default); hard timeout then the original text is typed
  cleanup: { enabled: false, timeoutMs: 1500, threads: 2, idleMin: 5 },
  // "note to self" -> local outbox (notes.jsonl); Notion sync is optional, the token lives in secrets.json (encrypted)
  notes: { enabled: true, triggers: DEFAULT_NOTE_TRIGGERS, notion: { enabled: false, targetType: 'database', targetId: '', titleProperty: 'Name' } },
};

const flt = (v, lo, hi, d) => (Number.isFinite(+v) && v !== '' && v !== null ? Math.min(hi, Math.max(lo, +v)) : d);
const notionId = (v) => { const m = String(v || '').match(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi); return m ? m[m.length - 1].toLowerCase() : ''; };   // a pasted Notion URL works too
const cmdList = (v, d) => {
  if (!Array.isArray(v)) return d;
  const seen = new Set();
  return v.map((c) => ({ phrase: String(c?.phrase ?? '').trim().slice(0, 60), action: String(c?.action ?? '') }))
    .filter((c) => c.phrase && ACTIONS.includes(c.action) && !seen.has(c.phrase.toLowerCase()) && seen.add(c.phrase.toLowerCase())).slice(0, 200);
};
const appRows = (v) => (Array.isArray(v)
  ? v.map((r) => ({ match: String(r?.match ?? '').trim().slice(0, 80), profile: String(r?.profile ?? '') })).filter((r) => r.match && PROFILES.includes(r.profile)).slice(0, 200) : []);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

const clampInt = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const strList = (v, d) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 200) : d);
const pairs = (v, a, b) => (Array.isArray(v)
  ? v.map((p) => ({ [a]: String(p?.[a] ?? '').trim(), [b]: String(p?.[b] ?? '') })).filter((p) => p[a]).slice(0, 500) : []);

/** validate / coerce anything coming from disk or the UI */
function normalize(s) {
  const d = DEFAULTS;
  const vks = Array.isArray(s?.hotkey?.vks) ? s.hotkey.vks.map(Number).filter((n) => n > 0 && n < 256).slice(0, 4) : d.hotkey.vks;
  return {
    hotkey: vks.length ? { vks, label: String(s?.hotkey?.label || '').slice(0, 40) || d.hotkey.label } : d.hotkey,
    mode: oneOf(s?.mode, ['hold', 'toggle'], d.mode),
    liveMode: oneOf(s?.liveMode, ['aggressive', 'stable'], d.liveMode),
    provider: oneOf(s?.provider, ['cpu', 'cuda'], d.provider),
    threads: clampInt(s?.threads, 1, 8, d.threads),
    micId: String(s?.micId || ''), keepMicOpen: !!s?.keepMicOpen,
    language: 'auto',
    endpointMs: clampInt(s?.endpointMs, 300, 1500, d.endpointMs), partialMs: clampInt(s?.partialMs, 200, 1500, d.partialMs),
    fillers: strList(s?.fillers, d.fillers), deny: strList(s?.deny, d.deny),
    trailingSpace: !!s?.trailingSpace, historyEnabled: !!s?.historyEnabled, launchAtLogin: !!s?.launchAtLogin,
    style: { casual: !!s?.style?.casual },
    dictionary: pairs(s?.dictionary, 'from', 'to'), snippets: pairs(s?.snippets, 'trigger', 'expansion'),
    userName: String(s?.userName || '').slice(0, 40),
    commands: { enabled: s?.commands?.enabled !== false, carryMs: clampInt(s?.commands?.carryMs, 0, 600000, d.commands.carryMs), list: cmdList(s?.commands?.list, d.commands.list) },
    tone: { enabled: s?.tone?.enabled !== false, apps: appRows(s?.tone?.apps) },
    translate: { enabled: !!s?.translate?.enabled, target: oneOf(s?.translate?.target, ['swap', 'en', 'nl'], d.translate.target) },
    whisper: { enabled: !!s?.whisper?.enabled, gain: flt(s?.whisper?.gain, 1, 8, d.whisper.gain), vadThreshold: flt(s?.whisper?.vadThreshold, 0.1, 0.5, d.whisper.vadThreshold) },
    cleanup: { enabled: !!s?.cleanup?.enabled, timeoutMs: clampInt(s?.cleanup?.timeoutMs, 500, 5000, d.cleanup.timeoutMs), threads: clampInt(s?.cleanup?.threads, 1, 4, d.cleanup.threads), idleMin: clampInt(s?.cleanup?.idleMin, 1, 120, d.cleanup.idleMin) },
    notes: {
      enabled: s?.notes?.enabled !== false, triggers: strList(s?.notes?.triggers, d.notes.triggers),
      notion: { enabled: !!s?.notes?.notion?.enabled, targetType: oneOf(s?.notes?.notion?.targetType, ['database', 'page'], 'database'),
        targetId: notionId(s?.notes?.notion?.targetId), titleProperty: String(s?.notes?.notion?.titleProperty || 'Name').slice(0, 60) || 'Name' },
    },
  };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.files = { settings: path.join(dir, 'settings.json'), stats: path.join(dir, 'stats.json'), history: path.join(dir, 'history.json') };
    this.settings = normalize(readJson(this.files.settings, {}));
    this.stats = readJson(this.files.stats, { days: {} });       // { days: { 'YYYY-MM-DD': { words, speechSec, sessions } } }
    this.history = readJson(this.files.history, []);
  }
  get() { return this.settings; }
  set(patch) { this.settings = normalize({ ...this.settings, ...patch }); writeJson(this.files.settings, this.settings); return this.settings; }

  /** counts only, never text */
  addUsage({ words, speechSec, date = new Date() }) {
    const k = dayKey(date);
    const d = (this.stats.days[k] ||= { words: 0, speechSec: 0, sessions: 0 });
    d.words += words; d.speechSec += speechSec; d.sessions += 1;
    writeJson(this.files.stats, this.stats);
  }
  summary(now = new Date()) {
    const days = Object.entries(this.stats.days);
    const words = days.reduce((s, [, d]) => s + d.words, 0);
    const sec = days.reduce((s, [, d]) => s + d.speechSec, 0);
    let streak = 0; const cur = new Date(now);
    if (!this.stats.days[dayKey(cur)]) cur.setDate(cur.getDate() - 1);   // today may not have started yet
    while (this.stats.days[dayKey(cur)]) { streak++; cur.setDate(cur.getDate() - 1); }
    return { words, wpm: sec > 5 ? Math.round(words / (sec / 60)) : 0, streak };
  }

  addHistory(text, date = new Date()) {
    if (!this.settings.historyEnabled || !text) return null;
    const e = { id: date.getTime().toString(36) + Math.random().toString(36).slice(2, 6), ts: date.getTime(), text };
    this.history.unshift(e); this.history = this.history.slice(0, 1000);
    writeJson(this.files.history, this.history);
    return e;
  }
  clearHistory() { this.history = []; writeJson(this.files.history, this.history); }
}

function dayKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

module.exports = { Store, DEFAULTS, normalize, dayKey };
