'use strict';
/* Settings > Read aloud and the What's new card, in the REAL renderer files (headless Chromium, fake preload bridge): nothing is played, no model is read. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const root = path.join(__dirname, '..', '..');
const { DEFAULTS, normalize } = require(path.join(root, 'src/main/settings.js'));
const { VOICES } = require(path.join(root, 'src/readaloud/voices.js'));
const APP = path.join(root, 'src', 'renderer', 'app.html');

function chromePath() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const dir = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  return path.join(base, dir, 'chrome-win64', 'chrome.exe');
}
const bridge = (st, news) => `(() => {
  let settings = ${JSON.stringify(normalize(JSON.parse(JSON.stringify(DEFAULTS))))};
  const data = { 'stats:get': { words: 0, wpm: 0, streak: 0 }, 'history:get': [], 'app:info': { engine: 'ready', version: '0.2.66' },
    'llm:status': { runtime: false, model: 'missing', worker: { state: 'stopped' }, last: null }, 'notion:status': { hasToken: false, encryption: true, counts: {} },
    'notes:list': [], 'mcp:info': { serverPath: 'x', dataDir: 'y', installed: false, statusFile: 'z' },
    'slang:state': { enabled: true, biasing: { enabled: false, score: 1.5, percent: 50 }, packs: [], mine: { count: 0 }, problems: [], active: 0 }, 'slang:terms': { total: 0, items: [] }, 'meetings:list': [], 'meetings:status': {},
    'update:status': { version: '0.2.66', installed: true, auto: true, installAuto: true, state: 'idle', lastCheckAt: 0, lastFailed: false } };
  window.__st = ${JSON.stringify(st)}; window.__news = ${JSON.stringify(news)}; window.__calls = []; window.__hk = '';
  window.pf = {
    invoke: (ch, ...a) => {
      if (ch === 'readaloud:status') return Promise.resolve({ ...window.__st });
      if (ch === 'whatsnew:get') return Promise.resolve(window.__news);
      if (ch === 'whatsnew:dismiss') { window.__calls.push([ch]); window.__news = null; return Promise.resolve(true); }
      if (ch === 'readaloud:check-hotkey') { window.__calls.push([ch, ...a]); return Promise.resolve(window.__hk); }
      if (ch.startsWith('readaloud:')) { window.__calls.push([ch, ...a]); return Promise.resolve({ ok: true }); }
      if (ch === 'settings:get') return Promise.resolve(a[0] === 'defaults' ? ${JSON.stringify(DEFAULTS)} : settings);
      if (ch === 'settings:set') { window.__calls.push([ch, ...a]); settings = { ...settings, ...a[0] }; return Promise.resolve(settings); }
      return Promise.resolve(ch in data ? JSON.parse(JSON.stringify(data[ch])) : null);
    },
    send: (ch, ...a) => { window.__calls.push(['send:' + ch, ...a]); }, on: () => () => {},
  };
})();`;
const VOICES_LIST = VOICES.map((v) => ({ id: v.id, label: v.label }));
const NO_VOICE = { enabled: false, voiceOk: false, sizeMB: 350, downloading: false, phase: '', pct: 0, error: '', state: 'idle', voices: VOICES_LIST };
const HAS_VOICE = { ...NO_VOICE, voiceOk: true };
const NEWS = { version: '0.2.66', items: ['Read aloud: select text and press Ctrl+Alt+R.', 'Updates install by themselves.'] };

let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: chromePath(), headless: true }); });
test.after(async () => { if (browser) await browser.close(); });
async function open(st, news = null, goSettings = true) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(bridge(st, news));
  await page.goto('file:///' + APP.replace(/\\/g, '/'));
  if (goSettings) { await page.click('.nav[data-page="settings"]'); await page.waitForSelector('#sec-readaloud', { timeout: 5000 }); }
  else await page.waitForSelector('.hint');
  return { page, errors };
}
const calls = (page) => page.evaluate(() => window.__calls);

test('no voice yet: the section explains itself, the switch cannot be turned on, Download voice is offered with its size', async () => {
  const { page, errors } = await open(NO_VOICE);
  const t = await page.locator('#sec-readaloud + .card').innerText();
  assert.match(t, /Ctrl\+Alt\+R/);
  assert.match(t, /Off by default because it presses Ctrl\+C/);
  assert.match(t, /clipboard is put back exactly/);
  assert.match(t, /never leaves this PC/);
  assert.match(t, /about 350 MB/);
  assert.equal(await page.getAttribute('#ra-on', 'aria-checked'), 'false');
  assert.ok(await page.locator('#ra-on').isDisabled(), 'cannot switch on without the voice');
  assert.ok(await page.locator('#ra-test').isDisabled());
  await page.click('#ra-download');
  await page.waitForTimeout(50);
  assert.deepStrictEqual((await calls(page)).filter((c) => c[0] === 'readaloud:download'), [['readaloud:download']]);
  assert.deepStrictEqual(errors, []);
  await page.close();
});

test('voice installed: the switch works, voice list has George as default, speed and sample work', async () => {
  const { page, errors } = await open(HAS_VOICE);
  assert.equal(await page.locator('#ra-on').isDisabled(), false);
  assert.equal(await page.inputValue('#ra-voice'), 'bm_george');
  assert.match(await page.locator('#ra-voice option:checked').innerText(), /George .*default/);
  assert.equal(await page.locator('#ra-voice option').count(), VOICES.length);
  assert.equal(await page.inputValue('#ra-speed'), '1');
  await page.click('#ra-on');
  await page.waitForFunction(() => document.getElementById('ra-on').getAttribute('aria-checked') === 'true');
  assert.deepStrictEqual((await calls(page)).find((c) => c[0] === 'settings:set')[1].readAloud.enabled, true);
  await page.selectOption('#ra-voice', 'af_bella');
  await page.waitForFunction(() => document.getElementById('ra-voice').value === 'af_bella');
  await page.selectOption('#ra-speed', '1.25');
  await page.waitForFunction(() => document.getElementById('ra-speed').value === '1.25');
  const sets = (await calls(page)).filter((c) => c[0] === 'settings:set').map((c) => c[1].readAloud);
  assert.equal(sets.at(-2).voice, 'af_bella'); assert.equal(sets.at(-1).speed, 1.25);
  await page.click('#ra-test');
  await page.waitForTimeout(50);
  assert.ok((await calls(page)).some((c) => c[0] === 'readaloud:sample'));
  assert.deepStrictEqual(errors, []);
  await page.close();
});

test('changing the hotkey: keys are collected, the main process vets them, a clash shows its reason and saves nothing, a good chord is saved', async () => {
  const { page } = await open(HAS_VOICE);
  await page.click('#ra-change');
  assert.ok((await calls(page)).some((c) => c[0] === 'send:hotkey:capture' && c[1] === true), 'the helper is told to let keys through');
  await page.evaluate(() => { window.__hk = 'That key is also used by the dictation hotkey. Pick another key'; });
  await page.keyboard.down('Control'); await page.keyboard.down('Alt'); await page.keyboard.down('Space'); await page.keyboard.up('Space'); await page.keyboard.up('Alt'); await page.keyboard.up('Control');
  await page.waitForFunction(() => /also used by the dictation hotkey/.test(document.getElementById('main').innerText));
  assert.equal((await calls(page)).filter((c) => c[0] === 'settings:set').length, 0, 'a refused chord is not saved');
  assert.ok((await calls(page)).some((c) => c[0] === 'send:hotkey:capture' && c[1] === false), 'capture ends');
  await page.evaluate(() => { window.__hk = ''; });
  await page.click('#ra-change');
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.down('KeyK'); await page.keyboard.up('KeyK'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  await page.waitForFunction(() => window.__calls.some((c) => c[0] === 'settings:set'));
  const saved = (await calls(page)).find((c) => c[0] === 'settings:set')[1].readAloud.hotkey;
  assert.deepStrictEqual(saved.vks, [0xA2, 0xA0, 0x4B], 'left Ctrl + left Shift + K as the keyboard reports them');
  assert.equal(saved.label, 'Left Ctrl+Left Shift+K');
  await page.close();
});

test('downloading shows progress; an error from the main process is shown', async () => {
  const { page } = await open({ ...NO_VOICE, downloading: true, phase: 'download', pct: 42 });
  assert.match(await page.locator('#sec-readaloud + .card').innerText(), /Downloading 42%/);
  assert.equal(await page.locator('#sec-readaloud + .card .progress i').getAttribute('style'), 'width:42%');
  await page.close();
  const e = await open({ ...NO_VOICE, error: 'hash mismatch for the voice pack: download deleted' });
  assert.match(await e.page.locator('#sec-readaloud + .card').innerText(), /hash mismatch/);
  await e.page.close();
});

test("What's new: shown on Home after an update, dismissed once with Got it", async () => {
  const { page, errors } = await open(HAS_VOICE, NEWS, false);
  await page.waitForSelector('#whatsnew');
  const t = await page.locator('#whatsnew').innerText();
  assert.match(t, /What's new in 0\.2\.66/);
  assert.match(t, /Ctrl\+Alt\+R/);
  await page.click('#whatsnew-ok');
  await page.waitForFunction(() => !document.getElementById('whatsnew'));
  assert.deepStrictEqual((await calls(page)).filter((c) => c[0] === 'whatsnew:dismiss'), [['whatsnew:dismiss']]);
  assert.deepStrictEqual(errors, []);
  await page.close();
  const none = await open(HAS_VOICE, null, false);
  assert.equal(await none.page.locator('#whatsnew').count(), 0, 'nothing to show: no card');
  await none.page.close();
});
