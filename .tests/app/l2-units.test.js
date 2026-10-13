'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const root = path.join(__dirname, '..', '..');
const L = require(path.join(root, 'src/renderer/lib.js'));
const { Store, normalize, DEFAULTS, dayKey } = require(path.join(root, 'src/main/settings.js'));
const { iconPng } = require(path.join(root, 'src/main/tray-icon.js'));
const MS = require(path.join(root, 'src/asr/model-store.js'));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-test-'));

test('lib: key codes, labels, hotkey validation', () => {
  assert.equal(L.codeToVk('KeyA'), 0x41); assert.equal(L.codeToVk('F9'), 0x78); assert.equal(L.codeToVk('F24'), 0x87);
  assert.equal(L.codeToVk('Pause'), 0x13); assert.equal(L.codeToVk('ControlRight'), 0xA3); assert.equal(L.codeToVk('Nope'), 0);
  assert.equal(L.vkLabel(0x13), 'Pause'); assert.equal(L.vkLabel(0x78), 'F9'); assert.equal(L.hotkeyLabel([0xA2, 0x20]), 'Left Ctrl + Space');
  assert.match(L.validateHotkey([]), /at least one/);
  assert.match(L.validateHotkey([0x1B]), /Esc/);
  assert.match(L.validateHotkey([0x41]), /type/);
  assert.equal(L.validateHotkey([0xA2, 0x41]), '');
  assert.equal(L.validateHotkey([0x13]), '');
  assert.match(L.validateHotkey([0x78, 0x79]), /one non-modifier/);
});

test('lib: greeting, escaping, day grouping', () => {
  assert.equal(L.greeting(9, 'Otis'), 'Good morning, Otis'); assert.equal(L.greeting(14, ''), 'Good afternoon'); assert.equal(L.greeting(21, ''), 'Good evening');
  assert.equal(L.esc('<b>"x"&\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;&lt;/b&gt;');
  const now = new Date(2026, 9, 13, 12, 0), at = (d, h) => new Date(2026, 9, d, h, 5).getTime();
  const g = L.groupByDay([{ id: 'a', ts: at(12, 9), text: 'y' }, { id: 'b', ts: at(13, 8), text: 't1' }, { id: 'c', ts: at(13, 11), text: 't2' }, { id: 'd', ts: at(9, 9), text: 'old' }], now);
  assert.deepEqual(g.map((x) => x.label), ['Today', 'Yesterday', g[2].label]);
  assert.deepEqual(g[0].items.map((i) => i.id), ['c', 'b'], 'newest first within a day');
  assert.match(g[2].label, /9 October/);
  assert.deepEqual(L.groupByDay([], now), []);
});

test('settings: defaults are safe and bad input is coerced', () => {
  assert.equal(DEFAULTS.historyEnabled, false); assert.equal(DEFAULTS.launchAtLogin, false); assert.equal(DEFAULTS.hotkey.vks[0], 0x13);
  const n = normalize({ threads: 99, mode: 'weird', hotkey: { vks: [] }, dictionary: [{ from: ' a ', to: 'b' }, { from: '', to: 'x' }, null], fillers: ' um , ,uh', provider: 'tpu', language: 'xx' });
  assert.equal(n.threads, 8); assert.equal(n.mode, 'hold'); assert.deepEqual(n.hotkey.vks, [0x13]);
  assert.deepEqual(n.dictionary, [{ from: 'a', to: 'b' }]); assert.deepEqual(n.fillers, DEFAULTS.fillers, 'a non-array falls back to defaults');
  assert.equal(n.provider, 'cpu'); assert.equal(n.language, 'auto');
  assert.deepEqual(normalize({ fillers: [' um ', '', 'uh'] }).fillers, ['um', 'uh']);
  assert.deepEqual(normalize(null).hotkey, DEFAULTS.hotkey);
});

test('settings: persistence, history is opt-in, stats hold counts only, streak math', () => {
  const dir = tmp();
  let s = new Store(dir);
  assert.equal(s.addHistory('secret words'), null, 'history off by default: nothing stored');
  assert.equal(fs.existsSync(path.join(dir, 'history.json')), false);
  s.set({ historyEnabled: true, userName: 'Otis' });
  assert.ok(s.addHistory('kept words'));
  s = new Store(dir);
  assert.equal(s.get().userName, 'Otis'); assert.equal(s.history.length, 1);
  const day = (n) => new Date(2026, 9, 13 - n, 12);
  s.addUsage({ words: 100, speechSec: 40, date: day(0) });
  s.addUsage({ words: 50, speechSec: 20, date: day(1) });
  s.addUsage({ words: 10, speechSec: 4, date: day(3) });
  const sum = s.summary(new Date(2026, 9, 13, 18));
  assert.equal(sum.words, 160); assert.equal(sum.wpm, Math.round(160 / (64 / 60))); assert.equal(sum.streak, 2);
  assert.equal(s.summary(new Date(2026, 9, 15, 9)).streak, 0, 'a missed day breaks the streak');
  const raw = fs.readFileSync(path.join(dir, 'stats.json'), 'utf8');
  assert.ok(!/kept words|secret/.test(raw), 'stats never contain text');
  s.clearHistory(); assert.equal(new Store(dir).history.length, 0);
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('settings: corrupt file falls back to defaults', () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'settings.json'), '{not json');
  assert.deepEqual(new Store(dir).get().hotkey, DEFAULTS.hotkey);
});

test('tray icon is a valid 32x32 PNG', () => {
  const b = iconPng(32);
  assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(b.readUInt32BE(16), 32); assert.equal(b.readUInt32BE(20), 32);
  const idat = b.indexOf('IDAT'); const len = b.readUInt32BE(idat - 4);
  assert.equal(zlib.inflateSync(b.subarray(idat + 4, idat + 4 + len)).length, (32 * 4 + 1) * 32);
});

test('model store: pinned catalogue is well formed and sizes are within budget', () => {
  assert.ok(MS.FILES.every((f) => /^[0-9a-f]{64}$/.test(f.sha256) && f.url.startsWith('https://')));
  assert.ok(MS.FILES.every((f) => /^https:\/\/(huggingface\.co\/csukuangfj|github\.com\/k2-fsa)\//.test(f.url)), 'official hosts only');
  assert.ok(MS.FILES.reduce((s, f) => s + f.bytes, 0) < 1.5e9, '<= 1.5 GB');
});

test('model store: verify finds missing, truncated and tampered files', async () => {
  const dir = tmp();
  assert.equal((await MS.verify(dir)).ok, false);
  const f = MS.FILES.find((x) => x.rel.endsWith('tokens.txt'));
  fs.mkdirSync(path.dirname(path.join(dir, f.rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, f.rel), 'x'.repeat(f.bytes));          // right size, wrong content
  const v = await MS.verify(dir);
  assert.ok(v.bad.includes(f.rel), 'same-size tamper caught by SHA-256');
  fs.writeFileSync(path.join(dir, f.rel), 'short');
  assert.ok((await MS.verify(dir, { quick: true })).bad.includes(f.rel), 'size mismatch caught quickly');
});

test('model store: a real, correct file passes (the downloaded tokens.txt)', async (t) => {
  const real = path.join(process.env.APPDATA || '', 'parakeet-flow', 'models', MS.MODEL_ID, 'tokens.txt');
  if (!fs.existsSync(real)) return t.skip('model not downloaded (UNVERIFIED)');
  const f = MS.FILES.find((x) => x.rel.endsWith('tokens.txt'));
  assert.equal(await MS.sha256File(real), f.sha256);
});
