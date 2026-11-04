'use strict';
/* Settings rows that changed in the UX review, in the real page with a mocked main process. */
const test = require('node:test');
const assert = require('node:assert');
const { launch, open, calls, SYNC_OFF } = require('./util');

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { if (browser) await browser.close(); });
const settings = (opts = {}) => open(browser, { goto: 'settings', sync: SYNC_OFF, ...opts });

test('finding 8: GPU cannot be chosen, and the row says the build runs on the CPU', async () => {
  const { page } = await settings();
  assert.ok(await page.locator('#prov button[data-v=cuda]').isDisabled());
  assert.match(await page.locator('#prov').evaluate((e) => e.closest('.srow').innerText), /runs on the CPU/);
  await page.locator('#prov button[data-v=cuda]').click({ force: true }).catch(() => {});
  assert.deepStrictEqual(await calls(page), []);
  await page.close();
});

test('finding 8: a GPU choice saved by an older version shows CPU, the truth, and CPU can be saved', async () => {
  const { page } = await settings({ settings: { provider: 'cuda' } });
  assert.match(await page.getAttribute('#prov button[data-v=cpu]', 'class'), /on/);
  assert.doesNotMatch(await page.getAttribute('#prov button[data-v=cuda]', 'class'), /on/);
  await page.click('#prov button[data-v=cpu]');
  await page.waitForTimeout(40);
  assert.deepStrictEqual(await calls(page), [['settings:set', { provider: 'cpu' }]]);
  await page.close();
});

test('finding 9: the dead Language select is gone; what it said is on the Model row', async () => {
  const { page } = await settings();
  const t = await page.locator('#main').innerText();
  assert.doesNotMatch(t, /Auto-detect/);
  assert.match(t, /detects the language itself/);
  await page.close();
});

test('finding 9: Aggressive/Stable shows only under the experimental switch, and still saves', async () => {
  const { page } = await settings();
  assert.equal(await page.locator('#live').count(), 0);
  await page.click('#ty-live');
  await page.waitForSelector('#live');
  const after = await page.evaluate(() => document.getElementById('ty-live').closest('.srow').nextElementSibling.contains(document.getElementById('live')));
  assert.equal(after, true, 'directly under the switch');
  await page.click('#live button[data-v=stable]');
  await page.waitForTimeout(40);
  assert.deepStrictEqual((await calls(page)).at(-1), ['settings:set', { liveMode: 'stable' }]);
  await page.close();
});

test('finding 10: Settings names the tray item as it is called', async () => {
  const fs = require('fs'), path = require('path');
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src/main/main.js'), 'utf8');
  assert.match(main, /label: 'Dictation enabled'/);
  const { page } = await settings();
  const t = await page.locator('#main').innerText();
  assert.match(t, /untick "Dictation enabled" in the tray menu/);
  assert.doesNotMatch(t, /pause dictation in the tray/);
  await page.close();
});

test('finding 14: with automatic checks off the line says so, in every idle state', async () => {
  const { UPDATE } = require('./util');
  const off = { updates: { auto: false } };
  const a = await settings({ settings: off });
  assert.match(await a.page.locator('#up-line').innerText(), /Automatic checks are off/);
  assert.doesNotMatch(await a.page.locator('#up-line').innerText(), /Not checked yet/);
  await a.page.close();
  const b = await settings({ settings: off, update: { ...UPDATE, lastCheckAt: Date.now() } });
  assert.match(await b.page.locator('#up-line').innerText(), /latest version.*Automatic checks are off/);
  await b.page.close();
  const on = await settings();
  assert.equal(await on.page.locator('#up-line').innerText(), 'Not checked yet.');
  await on.page.close();
});

test('finding 15: faint text reaches at least 4:1 on every background it sits on', () => {
  const fs = require('fs'), path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'src/renderer/app.css'), 'utf8');
  const color = (name) => css.match(new RegExp('--' + name + ': (#[0-9a-f]{6})'))[1];
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const bg of ['card', 'bg', 'side']) assert.ok(ratio(color('faint'), color(bg)) >= 4, bg + ': ' + ratio(color('faint'), color(bg)).toFixed(2));
});
