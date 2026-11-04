'use strict';
/* Findings 3, 4 and 11, the Sync section in the real page with a mocked main process. Live sync is not part of this. */
const test = require('node:test');
const assert = require('node:assert');
const { launch, open, calls, SYNC_OFF, SYNC_ON } = require('./util');

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { if (browser) await browser.close(); });
const REFUSED_KEY = { ok: false, error: 'That is a SECRET key (sb_secret_...). Use the publishable key (sb_publishable_...) instead.' };
const inView = (page, sel) => page.locator(sel).evaluate((e) => { const r = e.getBoundingClientRect(), m = document.getElementById('main').getBoundingClientRect(); return r.top >= m.top - 1 && r.bottom <= m.bottom + 1 && r.right <= m.right + 1; });

test('finding 3: the Project row comes before the switch, and the disabled switch says why', async () => {
  const { page } = await open(browser, { goto: 'settings', sync: SYNC_OFF });
  const [project, sw] = await Promise.all(['#sy-url', '#sy-on'].map((s) => page.locator(s).evaluate((e) => e.getBoundingClientRect().top)));
  assert.ok(project < sw, 'Project first');
  assert.ok(await page.locator('#sy-on').isDisabled());
  assert.match(await page.locator('#sy-on-why').innerText(), /Save the project URL and key above first/);
  await page.close();
  const saved = await open(browser, { goto: 'settings', sync: { ...SYNC_OFF, configured: true, url: 'https://a.supabase.co' } });
  assert.equal(await saved.page.locator('#sy-on-why').count(), 0);
  assert.ok(await saved.page.locator('#sy-on').isEnabled());
  await saved.page.close();
});

test('finding 4: a refused Save answers under the Project row, in view', async () => {
  const { page } = await open(browser, { goto: 'settings', sync: SYNC_OFF, answers: { 'sync:configure': REFUSED_KEY } });
  await page.fill('#sy-url', 'https://a.supabase.co'); await page.fill('#sy-key', 'sb_secret_abc');
  await page.click('#sy-save');
  await page.waitForSelector('#sy-msg');
  assert.match(await page.locator('#sy-msg').innerText(), /SECRET key/);
  assert.equal(await page.locator('#sy-msg').evaluate((e) => !!e.closest('.srow').querySelector('#sy-save')), true, 'same row as Save');
  assert.equal(await page.locator('#sy-status').evaluate((e) => /SECRET/.test(e.closest('.srow').innerText)), false, 'not in the Last sync row');
  assert.ok(await inView(page, '#sy-msg'));
  await page.close();
});

test('finding 4: a refused code answers under the Join row, whole and in view at the smallest window', async () => {
  const { page } = await open(browser, { goto: 'settings', sync: SYNC_ON, viewport: { width: 820, height: 560 }, answers: { 'sync:join': { ok: false, refused: true, error: 'That code is invalid, used or expired. Create a new code on the other PC.' } } });
  await page.fill('#sy-join', 'ZZZ-ZZZ');
  await page.click('#sy-join-go');
  await page.waitForSelector('#sy-msg');
  assert.equal(await page.locator('#sy-msg').evaluate((e) => !!e.closest('.srow').querySelector('#sy-join-go')), true);
  assert.ok(await inView(page, '#sy-msg'));
  assert.equal(await page.evaluate(() => { const m = document.getElementById('main'); return m.scrollWidth <= m.clientWidth; }), true, 'nothing cut off at the right');
  await page.close();
});

test('finding 4: each button answers in its own row, and the next press clears the old answer', async () => {
  const { page } = await open(browser, { goto: 'settings', sync: SYNC_ON, answers: { 'sync:create-code': { ok: false, error: 'Code failed.' }, 'sync:now': { ok: false, error: 'Now failed.' } } });
  await page.click('#sy-code');
  await page.waitForFunction(() => /Code failed/.test(document.getElementById('sy-msg')?.innerText || ''));
  assert.equal(await page.locator('#sy-msg').evaluate((e) => !!e.closest('.srow').querySelector('#sy-code')), true);
  await page.click('#sy-now');
  await page.waitForFunction(() => /Now failed/.test(document.getElementById('sy-msg')?.innerText || ''));
  assert.equal(await page.locator('#sy-msg').evaluate((e) => !!e.closest('.srow').querySelector('#sy-now')), true);
  assert.equal(await page.locator('#sy-msg').count(), 1);
  await page.close();
});

test('finding 11: a refused key is gone from the box and from the page, and is not sent twice', async () => {
  const { page } = await open(browser, { goto: 'settings', sync: SYNC_OFF, answers: { 'sync:configure': REFUSED_KEY } });
  await page.fill('#sy-url', 'not a url'); await page.fill('#sy-key', 'sb_secret_abc');
  await page.click('#sy-save');
  await page.waitForSelector('#sy-msg');
  assert.equal(await page.inputValue('#sy-key'), '');
  assert.equal(await page.evaluate(() => XS.key), '');
  assert.equal(await page.inputValue('#sy-url'), 'not a url', 'the URL stays so a typo can be fixed');
  await page.close();
});

test('finding 11: a refused code leaves the Join box; a network failure keeps it so it can be retried', async () => {
  const refused = await open(browser, { goto: 'settings', sync: SYNC_ON, answers: { 'sync:join': { ok: false, refused: true, error: 'No.' } } });
  await refused.page.fill('#sy-join', 'ZZZ-ZZZ');
  await refused.page.click('#sy-join-go');
  await refused.page.waitForSelector('#sy-msg');
  assert.equal(await refused.page.inputValue('#sy-join'), '');
  await refused.page.close();
  const net = await open(browser, { goto: 'settings', sync: SYNC_ON, answers: { 'sync:join': { ok: false, error: 'Could not reach the server.' } } });
  await net.page.fill('#sy-join', 'ABC-234');
  await net.page.click('#sy-join-go');
  await net.page.waitForSelector('#sy-msg');
  assert.equal(await net.page.inputValue('#sy-join'), 'ABC-234');
  assert.deepStrictEqual(await calls(net.page), [['sync:join', 'ABC-234']]);
  await net.page.close();
});

test('finding 12: a linked install shows its name above the ID; without one it says so; a typed name is saved', async () => {
  const members = [{ id: 'a', isMe: true, version: 'v', name: 'Me', machine: '' },
    { id: 'bbbbbbbb-0000-4000-8000-000000000001', isMe: false, version: 'parakeet-flow 0.2.62', name: 'Desk PC', machine: '' },
    { id: 'bbbbbbbb-0000-4000-8000-000000000002', isMe: false, version: 'parakeet-flow 0.2.62', name: '', machine: 'OLD-LAPTOP' },
    { id: 'bbbbbbbb-0000-4000-8000-000000000003', isMe: false, version: 'parakeet-flow 0.2.61', name: '', machine: '' }];
  const { page } = await open(browser, { goto: 'settings', sync: { ...SYNC_ON, linked: true, members } });
  const t = await page.locator('#sync-card').innerText();
  assert.match(t, /Desk PC\s+bbbbbbbb-0000-4000-8000-000000000001/);
  assert.match(t, /OLD-LAPTOP\s+bbbbbbbb-0000-4000-8000-000000000002/);
  assert.match(t, /Unnamed install\s+bbbbbbbb-0000-4000-8000-000000000003/);
  assert.match(t, /Left empty, no name is sent/);
  await page.fill('#sy-name', 'Laptop');
  await page.locator('#sy-name').blur();
  await page.waitForTimeout(60);
  assert.deepStrictEqual(await calls(page), [['sync:set-name', 'Laptop']]);
  await page.close();
});
