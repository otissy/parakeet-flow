'use strict';
/* The main window must never be blank. Loads the real app.html in headless Chromium with a fake
   `window.pf` (the preload bridge) whose calls are slow, hung or failing on purpose, and checks what
   a person would see. Set PF_RENDERER_ROOT to a folder holding src/renderer and src/slang to run the
   same checks against another copy (used for the broken-variant proof). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = process.env.PF_RENDERER_ROOT || path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'src', 'renderer', 'app.html');
const { DEFAULTS, normalize } = require(path.join(__dirname, '..', '..', 'src', 'main', 'settings.js'));

function chromePath() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const dir = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  return path.join(base, dir, 'chrome-win64', 'chrome.exe');
}

/* the preload bridge as a script run before the page's own: `plan` says how each channel behaves */
function bridge(plan) {
  return `(() => {
    const plan = ${JSON.stringify(plan)};
    const settings = ${JSON.stringify(normalize(JSON.parse(JSON.stringify(DEFAULTS))))};
    const data = {
      'settings:get': settings, 'stats:get': { words: 120, wpm: 90, streak: 3 }, 'history:get': [],
      'app:info': { engine: 'ready', version: '0.2.4' },
      'llm:status': { runtime: false, model: 'missing', worker: { state: 'stopped' }, last: null },
      'notion:status': { hasToken: false, encryption: true, counts: { pending: 0, sent: 0, failed: 0 } },
      'notes:list': [], 'mcp:info': { serverPath: 'x', dataDir: 'y', installed: false, statusFile: 'z' },
      'slang:state': { enabled: true, biasing: { enabled: false, score: 1.5, percent: 50 }, packs: [], mine: { count: 0 }, problems: [], active: 0 },
      'slang:preview': { text: '', hits: [], changed: false },
      'slang:terms': { total: 0, items: [] },
      'meetings:list': [], 'meetings:status': {},
    };
    window.__calls = [];
    window.pf = {
      invoke: (ch, ...a) => {
        window.__calls.push(ch);
        const p = plan[ch] || {};
        const run = () => {
          if (p.hang) return new Promise(() => {});
          if (p.fail) return Promise.reject(new Error(p.fail));
          if (p.failFirst && !p.seen) { p.seen = 1; return Promise.reject(new Error(p.failFirst)); }
          if (!(ch in data)) return Promise.resolve(null);
          return Promise.resolve(JSON.parse(JSON.stringify(data[ch])));
        };
        return p.delay ? new Promise((res, rej) => setTimeout(() => run().then(res, rej), p.delay)) : run();
      },
      send: () => {}, on: () => () => {},
    };
    if (plan.devicesHang) navigator.mediaDevices.enumerateDevices = () => new Promise(() => {});
  })();`;
}

let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: chromePath(), headless: true }); });
test.after(async () => { if (browser) await browser.close(); });

async function open(plan) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 680 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(bridge(plan));
  await page.goto('file:///' + APP.replace(/\\/g, '/'));
  return { page, errors };
}
const mainText = (page) => page.evaluate(() => document.getElementById('main').innerText.trim());

test('normal start: the Home page is drawn at once, with its nav marked and no errors', async () => {
  const { page, errors } = await open({});
  await page.waitForFunction(() => document.getElementById('main').innerText.length > 40, null, { timeout: 3000 });
  assert.match(await mainText(page), /Hold|Home|words/i);
  assert.strictEqual(await page.locator('.nav.on').getAttribute('data-page'), 'home');
  assert.deepStrictEqual(errors, []);
  await page.close();
});

test('a microphone list that never answers does not keep the page blank', async () => {
  const { page } = await open({ devicesHang: true });
  await page.waitForFunction(() => document.getElementById('main').innerText.length > 40, null, { timeout: 3000 });
  assert.match(await mainText(page), /Hold|words/i);
  await page.close();
});

test('slow settings: a loading card shows at once, the page replaces it when the data arrives', async () => {
  const { page } = await open({ 'settings:get': { delay: 1800 } });
  await page.waitForTimeout(250);
  assert.match(await mainText(page), /Loading Parakeet Flow/);
  await page.waitForFunction(() => /Hold|words/i.test(document.getElementById('main').innerText), null, { timeout: 5000 });
  await page.close();
});

test('a very slow start explains itself instead of looking frozen', async () => {
  const { page } = await open({ 'settings:get': { delay: 7500 } });
  await page.waitForFunction(() => /Still starting/.test(document.getElementById('main').innerText), null, { timeout: 8000 });
  await page.close();
});

test('settings fail: an error card with a working Try again, never a blank page', async () => {
  const { page } = await open({ 'settings:get': { fail: 'Error invoking remote method \'settings:get\': Error: disk is full' } });
  await page.waitForSelector('#boot-retry', { timeout: 3000 });
  const t = await mainText(page);
  assert.match(t, /could not load its settings/i);
  assert.match(t, /disk is full/);
  assert.doesNotMatch(t, /Error invoking remote method/);
  await page.close();
});

test('the extras failing (or hanging) does not touch Home; their pages say what went wrong and can be retried', async () => {
  const { page } = await open({ 'llm:status': { fail: 'llm worker is down' }, 'slang:state': { fail: 'dictionary files unreadable' } });
  await page.waitForFunction(() => /Hold|words/i.test(document.getElementById('main').innerText), null, { timeout: 3000 });
  await page.click('.nav[data-page="settings"]');
  await page.waitForSelector('#boot-retry', { timeout: 3000 });
  assert.match(await mainText(page), /llm worker is down/);
  await page.click('.nav[data-page="dictionary"]');
  await page.waitForSelector('#boot-retry', { timeout: 3000 });
  assert.match(await mainText(page), /dictionary files unreadable/);
  await page.click('.nav[data-page="home"]');
  assert.match(await mainText(page), /Hold|words/i);
  await page.close();
});

test('clicking Settings while the extras are still loading shows a loading card, then the real page', async () => {
  const { page } = await open({ 'llm:status': { delay: 1500 } });
  await page.waitForFunction(() => /Hold|words/i.test(document.getElementById('main').innerText), null, { timeout: 3000 });
  await page.click('.nav[data-page="settings"]');
  assert.match(await mainText(page), /Loading Parakeet Flow/);
  await page.waitForFunction(() => /Hotkey|Microphone|Launch|Voice commands/i.test(document.getElementById('main').innerText), null, { timeout: 6000 });
  assert.strictEqual(await page.locator('#boot-retry').count(), 0);
  await page.close();
});

test('every page is reachable and never blank once everything has loaded', async () => {
  const { page, errors } = await open({});
  await page.waitForFunction(() => /Hold|words/i.test(document.getElementById('main').innerText), null, { timeout: 3000 });
  await page.waitForTimeout(400);
  for (const id of ['dictionary', 'snippets', 'notes', 'meetings', 'style', 'settings', 'home']) {
    await page.click(`.nav[data-page="${id}"]`);
    await page.waitForTimeout(150);
    const t = await mainText(page);
    assert.ok(t.length > 20, id + ' is blank: "' + t + '"');
    assert.strictEqual(await page.locator('#boot-retry').count(), 0, id + ' shows an error: ' + t.slice(0, 120));
  }
  assert.deepStrictEqual(errors, []);
  await page.close();
});

test('Try again recovers: after a failed start, the next try draws the page', async () => {
  const { page } = await open({ 'settings:get': { failFirst: 'engine busy' } });
  await page.waitForSelector('#boot-retry', { timeout: 3000 });
  await page.click('#boot-retry');
  await page.waitForFunction(() => /Hold|words/i.test(document.getElementById('main').innerText), null, { timeout: 3000 });
  assert.strictEqual(await page.locator('#boot-retry').count(), 0);
  await page.close();
});
