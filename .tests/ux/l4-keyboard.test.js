'use strict';
/* Finding 2: the sidebar and the switches work from the keyboard. Real key presses in the real page. */
const test = require('node:test');
const assert = require('node:assert');
const { launch, open, calls } = require('./util');

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { if (browser) await browser.close(); });
const active = (page, attr) => page.evaluate((a) => document.activeElement.getAttribute(a), attr);

test('Tab goes through every page in the sidebar in order, with a visible focus ring', async () => {
  const { page, errors } = await open(browser);
  const seen = [];
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Tab');
    seen.push(await active(page, 'data-page'));
    assert.equal(await active(page, 'role'), 'tab');
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none', 'focus ring on ' + seen[i]);
  }
  assert.deepStrictEqual(seen, ['home', 'dictionary', 'snippets', 'notes', 'meetings', 'style', 'settings']);
  assert.deepStrictEqual(errors, []);
  await page.close();
});

test('Enter and Space open the focused page and aria-selected follows; the arrow keys move between pages', async () => {
  const { page } = await open(browser);
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Dictionary/.test(document.querySelector('#main h1')?.innerText || ''));
  assert.equal(await page.getAttribute('.nav[data-page=dictionary]', 'aria-selected'), 'true');
  assert.equal(await page.getAttribute('.nav[data-page=home]', 'aria-selected'), 'false');
  await page.keyboard.press('ArrowDown');
  assert.equal(await active(page, 'data-page'), 'snippets');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => /Snippets/.test(document.querySelector('#main h1').innerText));
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  assert.equal(await active(page, 'data-page'), 'settings', 'wraps around');
  await page.close();
});

test('every switch on Settings and Dictionary has a name, and they are the row titles', async () => {
  const { page } = await open(browser, { goto: 'settings' });
  const names = await page.locator('[role=switch]').evaluateAll((els) => els.map((e) => [e.id, e.getAttribute('aria-label')]));
  assert.ok(names.length >= 19, 'switches: ' + names.length);
  for (const [id, name] of names) assert.ok(name && name.trim().length > 2, 'no name on ' + id);
  await page.getByRole('switch', { name: 'Trailing space', exact: true }).waitFor();
  await page.getByRole('switch', { name: 'Type while I speak', exact: true }).waitFor();
  await page.click('.nav[data-page=dictionary]');
  await page.waitForSelector('#sl-all');
  const dict = await page.locator('[role=switch]').evaluateAll((els) => els.map((e) => [e.id, e.getAttribute('aria-label')]));
  assert.ok(dict.length >= 3);
  for (const [id, name] of dict) assert.ok(name && name.trim(), 'no name on ' + id);
  await page.close();
});

test('real Tab presses reach a switch, Space flips it, and focus stays on it after the page redraws', async () => {
  const { page } = await open(browser, { goto: 'settings' });
  let hit = false;
  for (let i = 0; i < 60 && !hit; i++) { await page.keyboard.press('Tab'); hit = (await page.evaluate(() => document.activeElement.id)) === 'trail'; }
  assert.ok(hit, 'Tab never reached the Trailing space switch');
  const before = await page.getAttribute('#trail', 'aria-checked');
  await page.keyboard.press('Space');
  await page.waitForFunction((b) => document.getElementById('trail').getAttribute('aria-checked') !== b, before);
  assert.equal((await calls(page)).at(-1)[0], 'settings:set');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'trail');
  await page.close();
});
