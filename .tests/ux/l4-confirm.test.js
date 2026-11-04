'use strict';
/* Finding 5: nothing is lost without a question that says what is lost. Real clicks, real dialogs, mocked main process. */
const test = require('node:test');
const assert = require('node:assert');
const { launch, open, calls, SYNC_ON } = require('./util');

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { if (browser) await browser.close(); });

async function press(page, selector, answer) {
  const shown = [];
  const fn = (d) => { shown.push(d.message()); return answer ? d.accept() : d.dismiss(); };
  page.on('dialog', fn);
  await page.click(selector);
  await page.waitForTimeout(60);
  page.off('dialog', fn);
  return shown;
}
const LINKED = { ...SYNC_ON, linked: true, backup: 'C:/x/backup.json' };
const CASES = [
  ['Unlink', LINKED, '#sy-unlink', 'sync:unlink', [/stops sharing/, /new code/, /stays on this PC/]],
  ['Restore backup', LINKED, '#sy-restore', 'sync:restore', [/replaces your current customization/, /linked installs/, /no undo/]],
];
for (const [name, sync, sel, channel, words] of CASES) {
  test(name + ': Cancel changes nothing; OK does it; the question says what is lost', async () => {
    const { page } = await open(browser, { goto: 'settings', sync });
    const asked = await press(page, sel, false);
    assert.equal(asked.length, 1);
    for (const w of words) assert.match(asked[0], w);
    assert.deepStrictEqual(await calls(page), []);
    await press(page, sel, true);
    assert.deepStrictEqual((await calls(page)).map((c) => c[0]), [channel]);
    await page.close();
  });
}

test('Clear history: Cancel keeps the list; OK clears it', async () => {
  const history = [{ id: 'a', ts: Date.now(), text: 'hello there' }];
  const { page } = await open(browser, { goto: 'settings', sync: SYNC_ON, history, settings: { historyEnabled: true } });
  const asked = await press(page, '#hist-clear', false);
  assert.match(asked[0], /cannot be undone/);
  assert.deepStrictEqual(await calls(page), []);
  assert.equal(await page.evaluate(() => S.history.length), 1);
  await press(page, '#hist-clear', true);
  assert.deepStrictEqual(await calls(page), [['history:clear']]);
  assert.equal(await page.evaluate(() => S.history.length), 0);
  await page.close();
});

test('saving another project URL asks first and says what is dropped; Cancel keeps the typed text and sends nothing', async () => {
  const { page } = await open(browser, { goto: 'settings', sync: SYNC_ON });
  await page.fill('#sy-url', 'https://other.supabase.co');
  const asked = await press(page, '#sy-save', false);
  assert.match(asked[0], /drops its link/); assert.match(asked[0], /new install ID/); assert.match(asked[0], /stays on this PC/);
  assert.deepStrictEqual(await calls(page), []);
  assert.equal(await page.inputValue('#sy-url'), 'https://other.supabase.co');
  await press(page, '#sy-save', true);
  assert.equal((await calls(page))[0][0], 'sync:configure');
  await page.close();
});

test('no question for the same project, a first project, or a URL that will be refused anyway', async () => {
  const same = await open(browser, { goto: 'settings', sync: SYNC_ON });
  await same.page.fill('#sy-url', 'https://example.supabase.co/');
  assert.deepStrictEqual(await press(same.page, '#sy-save', true), []);
  await same.page.fill('#sy-url', 'not a url');
  assert.deepStrictEqual(await press(same.page, '#sy-save', true), []);
  await same.page.fill('#sy-url', 'http://example.com');
  assert.deepStrictEqual(await press(same.page, '#sy-save', true), []);
  assert.equal((await calls(same.page)).length, 3);
  await same.page.close();
});
