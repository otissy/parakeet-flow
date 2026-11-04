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
