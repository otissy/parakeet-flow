'use strict';
/* The easier Sync setup in the real page (headless Chromium, mocked main process): steps in order with the reason a control is off,
   one pasted Sync code, the confirmation before it changes anything, the answer under the pressed button, the five badge words.
   PF_SHOTS=<folder> also saves screenshots of the section. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { launch, open, calls, SYNC_OFF, SYNC_ON } = require('./util');

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { if (browser) await browser.close(); });
const SHOTS = process.env.PF_SHOTS;
const shot = async (page, name, sel = '#sec-sync') => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.locator(sel).evaluate((e) => e.scrollIntoView({ block: 'start' })); await page.waitForTimeout(60); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
const inView = (page, sel) => page.locator(sel).evaluate((e) => { const r = e.getBoundingClientRect(), m = document.getElementById('main').getBoundingClientRect(); return r.top >= m.top - 1 && r.bottom <= m.bottom + 1 && r.right <= m.right + 1; });
const top = (page, sel) => page.locator(sel).evaluate((e) => e.getBoundingClientRect().top);
async function press(page, selector, answer) {
  const shown = [];
  const fn = (d) => { shown.push(d.message()); return answer ? d.accept() : d.dismiss(); };
  page.on('dialog', fn);
  await page.click(selector);
  await page.waitForTimeout(80);
  page.off('dialog', fn);
  return shown;
}
const CODE = 'PFS1-eyJ1IjoiaHR0cHM6Ly94LnN1cGFiYXNlLmNvIn0.abcdef';

test('steps run in order: paste box, project, switch on, link; each disabled control says why beside it', async () => {
  const { page, errors } = await open(browser, { goto: 'settings', sync: SYNC_OFF, viewport: { width: 820, height: 560 } });
  const order = await Promise.all(['#sy-paste', '#sy-url', '#sy-on', '#sy-setup', '#sy-name', '#sy-now'].map((s) => top(page, s)));
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order, 'top to bottom in step order');
  const t = await page.locator('#sync-card').innerText();
  for (const w of [/Step 1 · Project/, /Step 2 · Sync my customization/, /Step 3 · Link another PC/, /Already set up on another PC/]) assert.match(t, w);
  assert.ok(await page.locator('#sy-on').isDisabled());
  assert.match(await page.locator('#sy-on-why').innerText(), /Save the project URL and key above first/);
  assert.ok(await page.locator('#sy-setup').isDisabled());
  assert.match(await page.locator('#sy-setup-why').innerText(), /Save the project \(step 1\) and switch sync on \(step 2\) first/);
  assert.match(await page.locator('#sy-now-why').innerText(), /first/);
  assert.ok(await page.locator('#sy-paste').isEnabled(), 'pasting a code needs no earlier step');
  assert.equal(await page.evaluate(() => { const m = document.getElementById('main'); return m.scrollWidth <= m.clientWidth; }), true);
  await shot(page, 'sync-off-820x560-top');
  await shot(page, 'sync-off-820x560-steps', '#sy-on');
  assert.deepStrictEqual(errors, []);
  await page.close();
  const saved = await open(browser, { goto: 'settings', sync: { ...SYNC_OFF, configured: true, url: 'https://a.supabase.co' } });
  assert.equal(await saved.page.locator('#sy-on-why').count(), 0);
  assert.match(await saved.page.locator('#sy-setup-why').innerText(), /Switch sync on first \(step 2\)/);
  await saved.page.close();
});

test('the on-state needs no explanations and the advanced short codes are folded away', async () => {
  const { page } = await open(browser, { goto: 'settings', sync: { ...SYNC_ON, lastSyncAt: Date.now() } });
  assert.equal(await page.locator('#sy-setup-why, #sy-now-why, #sy-on-why').count(), 0);
  assert.ok(await page.locator('#sy-setup').isEnabled());
  assert.equal(await page.locator('#sy-adv').evaluate((e) => e.open), false);
  assert.equal(await page.locator('#sy-code').isVisible(), false);
  await page.click('#sy-adv summary');
  assert.ok(await page.locator('#sy-code').isVisible());
  assert.ok(await page.locator('#sy-join').isVisible());
  await page.close();
});

test('Create Sync code shows the one string and when it stops working; the answer sits in the Step 3 row', async () => {
  const exp = Date.now() + 600000;
  const { page } = await open(browser, { goto: 'settings', sync: SYNC_ON, answers: { 'sync:create-setup-code': { ok: true, setupCode: CODE, code: 'ABC-234', expiresAtMs: exp } } });
  await page.click('#sy-setup');
  await page.waitForSelector('#sy-setup-code');
  assert.equal(await page.inputValue('#sy-setup-code'), CODE);
  const note = await page.locator('#sy-setup-code').evaluate((e) => e.parentElement.innerText);
  assert.match(note, /works once/);
  assert.match(note, /10 minutes/);
  assert.match(note, /publishable key/);
  assert.deepStrictEqual(await calls(page), [['sync:create-setup-code']]);
  await shot(page, 'sync-code-created-default', '#sy-setup');
  await page.close();
});

test('a failed Create answers in its own row; a code that has expired on screen says so', async () => {
  const { page } = await open(browser, { goto: 'settings', sync: SYNC_ON, answers: { 'sync:create-setup-code': { ok: false, error: 'Could not reach the server.' } } });
  await page.click('#sy-setup');
  await page.waitForSelector('#sy-msg');
  assert.equal(await page.locator('#sy-msg').evaluate((e) => !!e.closest('.srow').querySelector('#sy-setup')), true);
  assert.match(await page.locator('#sy-msg').innerText(), /Could not reach/);
  await page.close();
  const old = await open(browser, { goto: 'settings', sync: SYNC_ON, answers: { 'sync:create-setup-code': { ok: true, setupCode: CODE, code: 'ABC-234', expiresAtMs: Date.now() - 5 } } });
  await old.page.click('#sy-setup');
  await old.page.waitForSelector('#sy-setup-expired');
  assert.equal(await old.page.locator('#sy-setup-code').count(), 0);
  await old.page.close();
});

test('confirmation before the paste does anything: Cancel sends nothing; OK sends the code once and clears the box', async () => {
  const { page } = await open(browser, { goto: 'settings', sync: SYNC_OFF, answers: { 'sync:join-setup': { ok: true } } });
  await page.fill('#sy-paste', CODE);
  const asked = await press(page, '#sy-paste-go', false);
  assert.equal(asked.length, 1);
  for (const w of [/backup of your customization is saved first/, /leaves its current link/, /replace yours on this PC/, /works once/]) assert.match(asked[0], w);
  assert.deepStrictEqual(await calls(page), []);
  await press(page, '#sy-paste-go', true);
  await page.waitForSelector('#sy-msg');
  assert.deepStrictEqual(await calls(page), [['sync:join-setup', CODE]]);
  assert.equal(await page.inputValue('#sy-paste'), '');
  assert.match(await page.locator('#sy-msg').innerText(), /Linked\. This PC is set up and syncing/);
  assert.equal(await page.locator('#sy-msg').evaluate((e) => !!e.closest('.srow').querySelector('#sy-paste-go')), true);
  await page.close();
});

test('an empty paste is answered without a question or a call; a refused code answers under the paste box, whole, at 820x560', async () => {
  const { page } = await open(browser, { goto: 'settings', sync: SYNC_OFF, viewport: { width: 820, height: 560 }, answers: { 'sync:join-setup': { ok: false, refused: true, error: 'This Sync code has expired (they last 10 minutes). Create a new one on the other PC.', expired: true } } });
  const none = await press(page, '#sy-paste-go', true);
  assert.deepStrictEqual(none, []);
  assert.match(await page.locator('#sy-msg').innerText(), /Paste the Sync code/);
  assert.deepStrictEqual(await calls(page), []);
  await page.fill('#sy-paste', CODE);
  await press(page, '#sy-paste-go', true);
  await page.waitForFunction(() => /expired/.test(document.getElementById('sy-msg')?.innerText || ''));
  assert.equal(await page.locator('#sy-msg').evaluate((e) => !!e.closest('.srow').querySelector('#sy-paste-go')), true);
  assert.ok(await inView(page, '#sy-msg'));
  assert.equal(await page.inputValue('#sy-paste'), '', 'a rejected code does not stay in the box');
  await shot(page, 'sync-paste-expired-820x560');
  await page.close();
});

test('the PC name box shows the Windows name as a name, and saving goes through set-name', async () => {
  const { page } = await open(browser, { goto: 'settings', sync: { ...SYNC_ON, name: 'DESKTOP-OTIS', nameIsDefault: true } });
  assert.equal(await page.inputValue('#sy-name'), 'DESKTOP-OTIS');
  assert.match(await page.locator('#sync-card').innerText(), /starts as this computer's Windows name \(that name is what is sent now\)/);
  await page.fill('#sy-name', '');
  await page.locator('#sy-name').blur();
  await page.waitForFunction(() => /Saved/.test(document.getElementById('sy-msg')?.innerText || ''));
  assert.deepStrictEqual(await calls(page), [['sync:set-name', '']]);
  await page.close();
});

test('wording: the switch text names what the README names, including install ID and app version', async () => {
  const { page } = await open(browser, { goto: 'settings', sync: SYNC_ON });
  const t = await page.locator('#sync-card').innerText();
  for (const w of [/filler words/, /Dictionary rows/, /random install ID, the app version and this PC's name/, /IP address/, /project's owner can read it/, /never sends dictated text/]) assert.match(t, w);
  await page.close();
});

for (const [word, state] of [['Off', SYNC_OFF], ['Up to date', { ...SYNC_ON, lastSyncAt: Date.now() }], ['Syncing', { ...SYNC_ON, syncing: true }],
  ['Offline', { ...SYNC_ON, lastError: 'Could not reach the server.', offline: true }], ['Failed', { ...SYNC_ON, lastError: 'The server had a problem (error 500).' }]]) {
  test('badge reads ' + word, async () => {
    const { page } = await open(browser, { goto: 'settings', sync: state });
    assert.equal(await page.locator('#sec-sync #sy-badge').innerText(), word);
    await page.close();
  });
}

test('screenshots of a linked, up-to-date PC (default size)', async () => {
  const members = [{ id: 'a', isMe: true, version: 'v', name: 'DESKTOP-OTIS', machine: '' }, { id: 'bbbbbbbb-0000-4000-8000-000000000001', isMe: false, version: 'parakeet-flow 0.2.64', name: 'LAPTOP-OTIS', machine: '' }];
  const { page } = await open(browser, { goto: 'settings', sync: { ...SYNC_ON, name: 'DESKTOP-OTIS', nameIsDefault: true, linked: true, members, lastSyncAt: Date.now() - 30000, pulled: 2 } });
  await shot(page, 'sync-linked-default-top');
  await shot(page, 'sync-linked-default-bottom', '#sy-now');
  assert.equal(await page.locator('#sy-badge').innerText(), 'Up to date');
  await page.close();
});

test('unlink, restore and a project change still ask first', async () => {
  const { page } = await open(browser, { goto: 'settings', sync: { ...SYNC_ON, linked: true, backup: 'C:/x/backup.json' } });
  for (const [sel, ch] of [['#sy-unlink', 'sync:unlink'], ['#sy-restore', 'sync:restore']]) {
    assert.equal((await press(page, sel, false)).length, 1);
    assert.deepStrictEqual(await calls(page), []);
    assert.equal((await press(page, sel, true)).length, 1);
    assert.equal((await calls(page)).pop()[0], ch);
    await page.evaluate(() => { window.__calls.length = 0; });
  }
  await page.fill('#sy-url', 'https://other.supabase.co');
  await page.fill('#sy-key', 'sb_publishable_zzz');
  const asked = await press(page, '#sy-save', false);
  assert.match(asked[0], /Switch to a different Supabase project/);
  assert.match(asked[0], /what was uploaded stays in the old project/);
  assert.deepStrictEqual(await calls(page), []);
  await page.close();
});
