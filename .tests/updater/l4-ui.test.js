'use strict';
/* Settings > Updates in the REAL renderer files, headless Chromium, fake preload bridge. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const root = path.join(__dirname, '..', '..');
const { DEFAULTS, normalize } = require(path.join(root, 'src/main/settings.js'));
const APP = path.join(root, 'src', 'renderer', 'app.html');

function chromePath() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const dir = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  return path.join(base, dir, 'chrome-win64', 'chrome.exe');
}
const bridge = (u) => `(() => {
  let settings = ${JSON.stringify(normalize(JSON.parse(JSON.stringify(DEFAULTS))))};
  const data = { 'stats:get': { words: 0, wpm: 0, streak: 0 }, 'history:get': [], 'app:info': { engine: 'ready', version: '0.2.61' },
    'llm:status': { runtime: false, model: 'missing', worker: { state: 'stopped' }, last: null }, 'notion:status': { hasToken: false, encryption: true, counts: {} },
    'notes:list': [], 'mcp:info': { serverPath: 'x', dataDir: 'y', installed: false, statusFile: 'z' },
    'slang:state': { enabled: true, biasing: { enabled: false, score: 1.5, percent: 50 }, packs: [], mine: { count: 0 }, problems: [], active: 0 }, 'slang:terms': { total: 0, items: [] }, 'meetings:list': [], 'meetings:status': {} };
  window.__u = ${JSON.stringify(u)}; window.__calls = [];
  window.pf = {
    invoke: (ch, ...a) => {
      if (ch === 'update:status') return window.__u === 'fail' ? Promise.reject(new Error('x')) : Promise.resolve({ ...window.__u });
      if (ch === 'settings:get') return Promise.resolve(settings);
      if (ch === 'settings:set') { window.__calls.push([ch, ...a]); settings = { ...settings, ...a[0] }; return Promise.resolve(settings); }
      if (ch.startsWith('update:')) { window.__calls.push([ch]); if (window.__after) window.__u = window.__after; return Promise.resolve({ ok: true }); }
      return Promise.resolve(ch in data ? JSON.parse(JSON.stringify(data[ch])) : null);
    },
    send: () => {}, on: () => () => {},
  };
})();`;

let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: chromePath(), headless: true }); });
test.after(async () => { if (browser) await browser.close(); });
const INSTALLED = { version: '0.2.61', installed: true, auto: true, state: 'idle', lastCheckAt: 0, lastFailed: false };

async function open(u) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 680 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(bridge(u));
  await page.goto('file:///' + APP.replace(/\\/g, '/'));
  await page.click('.nav[data-page="settings"]');
  await page.waitForSelector('#sec-typing', { timeout: 5000 });
  return { page, errors };
}
const text = (page) => page.locator('#main').innerText();

test('installed: version, the switch on by default, Check now, and the truth about the request', async () => {
  const { page, errors } = await open(INSTALLED);
  await page.waitForSelector('#sec-updates');
  const t = await text(page);
  assert.match(t, /Version 0\.2\.61/);
  assert.match(t, /github\.com/);
  assert.match(t, /Nothing you dictated/);
  assert.match(t, /separate from Sync/);
  assert.equal(await page.getAttribute('#up-auto', 'aria-checked'), 'true');
  await page.click('#up-check');
  await page.waitForTimeout(40);
  assert.deepStrictEqual(await page.evaluate(() => window.__calls), [['update:check']]);
  await page.click('#up-auto');
  await page.waitForFunction(() => document.getElementById('up-auto').getAttribute('aria-checked') === 'false');
  assert.deepStrictEqual((await page.evaluate(() => window.__calls))[1], ['settings:set', { updates: { auto: false, installAuto: true, seen: '' } }]);
  assert.equal(await page.getAttribute('#up-install', 'aria-checked'), 'true', 'Install updates automatically is on by default');
  await page.click('#up-install');
  await page.waitForFunction(() => document.getElementById('up-install').getAttribute('aria-checked') === 'false');
  assert.deepStrictEqual((await page.evaluate(() => window.__calls))[2], ['settings:set', { updates: { auto: false, installAuto: false, seen: '' } }]);
  assert.deepStrictEqual(errors, []);
  await page.close();
});

test('not installed: says so, and Check now cannot be pressed', async () => {
  const { page } = await open({ ...INSTALLED, installed: false });
  await page.waitForSelector('#sec-updates');
  assert.match(await text(page), /only in the installed app/);
  assert.ok(await page.locator('#up-check').isDisabled());
  await page.close();
});

test('ready: Restart to update replaces Check now and asks the main process', async () => {
  const { page } = await open({ ...INSTALLED, state: 'ready' });
  await page.waitForSelector('#up-restart');
  assert.equal(await page.locator('#up-check').count(), 0);
  assert.match(await text(page), /used the next time the app starts/);
  assert.match(await text(page), /quiet moment/);
  await page.click('#up-restart');
  await page.waitForTimeout(40);
  assert.deepStrictEqual(await page.evaluate(() => window.__calls), [['update:restart']]);
  await page.close();
});

test('a background failure shows nothing; after pressing Check now a calm line says it could not check', async () => {
  const { page } = await open({ ...INSTALLED, lastFailed: true });
  await page.waitForSelector('#sec-updates');
  assert.doesNotMatch(await text(page), /Could not check/);
  await page.click('#up-check');
  await page.waitForFunction(() => /Could not check/.test(document.getElementById('up-line').innerText));
  await page.close();
});

test('the status failing leaves Settings working, with no Updates section', async () => {
  const { page, errors } = await open('fail');
  await page.waitForFunction(() => /Keep transcript history/.test(document.getElementById('main').innerText));
  assert.equal(await page.locator('#sec-updates').count(), 0);
  assert.deepStrictEqual(errors, []);
  await page.close();
});
