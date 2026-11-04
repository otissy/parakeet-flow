'use strict';
/* Finding 1: first run has a way forward on Home. */
const test = require('node:test');
const assert = require('node:assert');
const { launch, open, calls } = require('./util');

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { if (browser) await browser.close(); });
const MISSING = { engine: 'missing', error: '', modelsOk: false };

test('first run: the Download card is on Home; pressing it asks for the model and shows progress until the engine is ready', async () => {
  const { page, errors } = await open(browser, { info: MISSING });
  assert.ok(await page.locator('#model-card').isVisible());
  assert.match(await page.locator('#model-card').innerText(), /670 MB/);
  await page.click('#dl-home');
  assert.deepStrictEqual(await calls(page), [['models:download']]);
  assert.ok(await page.locator('#dl-home').isDisabled(), 'no second download while one runs');
  await page.evaluate(() => window.__fire('models:progress', { pct: 42.4 }));
  await page.waitForFunction(() => /42%/.test(document.getElementById('dl-home').innerText));
  assert.equal(await page.locator('#model-card .progress i').getAttribute('style'), 'width:42%');
  await page.evaluate(() => { window.__fire('models:progress', { done: true, pct: 100 }); window.__info = { engine: 'ready', modelsOk: true }; window.__fire('engine:state'); });
  await page.waitForSelector('#model-card', { state: 'detached' });
  assert.deepStrictEqual(errors, []);
  await page.close();
});

test('a failed download keeps the card, says why and can be tried again', async () => {
  const { page } = await open(browser, { info: { engine: 'error', error: 'Could not download the model', modelsOk: false } });
  assert.match(await page.locator('#model-card').innerText(), /Could not download the model/);
  assert.ok(await page.locator('#dl-home').isEnabled());
  await page.close();
});

for (const [name, info] of [['ready', { engine: 'ready', modelsOk: true }], ['loading', { engine: 'loading', modelsOk: false }], ['an engine error with good model files', { engine: 'error', error: 'x', modelsOk: true }]]) {
  test(`no Download card while ${name}`, async () => {
    const { page } = await open(browser, { info });
    assert.equal(await page.locator('#model-card').count(), 0);
    await page.close();
  });
}
