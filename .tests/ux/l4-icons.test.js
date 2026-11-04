'use strict';
/* The app's own icon set (src/renderer/icons.js): one file, filled single-colour shapes on a 24 grid, decorative unless labelled.
   Real pages in headless Chromium; the buttons keep their names. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { launch, open, root } = require('./util');

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { if (browser) await browser.close(); });

const R = path.join(root, 'src', 'renderer');

test('icons live in one file: no other renderer file draws an svg or uses a character as an icon', () => {
  for (const f of fs.readdirSync(R).filter((n) => /\.(js|html|css)$/.test(n) && n !== 'icons.js')) {
    const t = fs.readFileSync(path.join(R, f), 'utf8');
    assert.ok(!/<svg|viewBox|data:image\/svg/.test(t), f + ' still draws its own svg');
  }
  assert.ok(!/stroke/.test(fs.readFileSync(path.join(R, 'icons.js'), 'utf8')), 'filled shapes only');
  assert.ok(!/class=.arrow.>[^$]/.test(fs.readFileSync(path.join(R, 'app.js'), 'utf8')), 'the snippet arrow is an icon, not a character');
  assert.ok(!/const TARGET = .*u(21C4|2192)/.test(fs.readFileSync(path.join(R, 'pill.js'), 'utf8')), 'the translate arrows are icons, not characters');
});

test('every page: each svg is the shared set, filled, decorative, and every icon button still has a name', async () => {
  const settings = { historyEnabled: true, snippets: [{ trigger: 'a', expansion: 'b' }] };
  const history = [{ id: 'h1', ts: Date.now(), text: 'hello there' }];
  for (const goto of [undefined, 'dictionary', 'snippets', 'notes', 'meetings', 'style', 'settings']) {
    const { page, errors } = await open(browser, { goto, settings, history });
    const bad = await page.evaluate(() => [...document.querySelectorAll('svg')].filter((s) => {
      const c = getComputedStyle(s);
      return !s.classList.contains('ic') || s.getAttribute('viewBox') !== '0 0 24 24' || s.getAttribute('aria-hidden') !== 'true'
        || c.stroke !== 'none' || c.fill !== c.color || s.getBoundingClientRect().width < 12;
    }).map((s) => s.outerHTML.slice(0, 120)));
    assert.deepStrictEqual(bad, [], 'page ' + goto);
    const nameless = await page.evaluate(() => [...document.querySelectorAll('.iconbtn, .nav')].filter((b) => !(b.getAttribute('aria-label') || b.title || b.textContent.trim())).map((b) => b.outerHTML.slice(0, 120)));
    assert.deepStrictEqual(nameless, [], 'page ' + goto);
    assert.deepStrictEqual(errors, []);
    await page.close();
  }
});

test('the sidebar has one icon per page, and the select arrow comes from the set', async () => {
  const { page } = await open(browser, { goto: 'settings' });
  assert.equal(await page.locator('.nav svg').count(), 7);
  assert.equal(await page.locator('.brand svg').count(), 1);
  assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('select')).backgroundImage), /^url\("data:image\/svg\+xml,/);
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-icon]').length), 0, 'all placeholders replaced');
  await page.close();
});

test('flow bar: buttons keep their names, the mark shows the right icon per state, translate chips say the arrow out loud', async () => {
  const page = await browser.newPage({ viewport: { width: 520, height: 110 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(`(()=>{const l={};window.__fire=(c,...a)=>(l[c]||[]).forEach(f=>f(...a));window.pf={send(){},invoke:async()=>null,on(c,f){(l[c]=l[c]||[]).push(f);return()=>{}}}})()`);
  await page.goto('file:///' + path.join(R, 'pill.html').split(path.sep).join('/'));
  assert.equal(await page.getAttribute('#cancel', 'aria-label'), 'Cancel');
  assert.equal(await page.getAttribute('#stop', 'aria-label'), 'Stop');
  const shown = () => page.evaluate(() => [...document.querySelectorAll('#mark svg')].filter((s) => s.getBoundingClientRect().width > 0).map((s) => s.classList.contains('ok') ? 'ok' : 'no'));
  for (const [state, want] of [['done', ['ok']], ['cancelled', ['no']], ['error', ['no']], ['listening', []]]) {
    await page.evaluate((s) => window.__fire('pill:state', { state: s }), state);
    assert.deepStrictEqual(await shown(), want, state);
  }
  await page.evaluate(() => window.__fire('pill:state', { state: 'handsfree' }));
  assert.ok(await page.locator('#stop svg').isVisible());
  await page.evaluate(() => window.__fire('pill:flags', { translate: 'en' }));
  assert.equal(await page.getAttribute('#flags .chip svg', 'aria-label'), 'to');
  await page.evaluate(() => window.__fire('pill:flags', { translate: 'swap' }));
  assert.equal(await page.getAttribute('#flags .chip svg', 'aria-label'), 'and');
  assert.deepStrictEqual(errors, []);
  await page.close();
});
