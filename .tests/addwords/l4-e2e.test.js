'use strict';
/* L4: the real renderer (app.html, real CSS/JS, real preload) in headless Chromium, bridged to the real slang service,
   settings store, slang IPC and meeting store on a temp user-data folder (see harness.js). Mouse AND keyboard, at
   1920x1080 and at the app's minimum window size 820x560; every check reads back the files on disk or the page state the
   user sees. Screenshots of every state go to PF_SHOTS (default ../pf-add-words-shots). Playwright missing = skipped (UNVERIFIED). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Hn = require('./harness');

const pw = Hn.loadPlaywright();
const skip = pw ? false : 'Playwright (@playwright/test) not found: set PF_PLAYWRIGHT (UNVERIFIED)';
const expect = pw ? pw.expect : null;
const SIZES = [{ width: 1920, height: 1080 }, { width: 820, height: 560 }];
const sz = (v) => `${v.width}x${v.height}`;
fs.mkdirSync(Hn.shotDir, { recursive: true });

let browser;
test.before(async () => { if (pw) browser = await Hn.launch(); });
test.after(async () => { if (browser) await browser.close(); });

const shot = (page, name) => page.screenshot({ path: path.join(Hn.shotDir, `${name}-${page.viewportSize().width}x${page.viewportSize().height}.png`) });
const mine = (ud) => (fs.existsSync(Hn.minePath(ud)) ? Hn.readJson(Hn.minePath(ud)).terms : []);
const settingsFile = (ud) => Hn.readJson(path.join(ud, 'settings.json'));
async function toAddBox(page) { await Hn.go(page, 'dictionary'); await page.locator('#sec-addword').scrollIntoViewIfNeeded(); await page.evaluate(() => { const m = document.querySelector('#main'); m.scrollTop = document.querySelector('#sec-addword').offsetTop - 12; }); }
/** Tab until the element with this id has focus (keyboard only); fails after `max` presses */
async function tabTo(page, id, max = 25, back = false) {
  for (let i = 0; i < max; i++) { if (await page.evaluate(() => document.activeElement && document.activeElement.id) === id) return; await page.keyboard.press(back ? 'Shift+Tab' : 'Tab'); }
  assert.fail(`could not reach #${id} with the keyboard`);
}
/** double-click a word inside an element with the real mouse (selects it like a user does) */
async function dblclickWord(page, containerSel, word) {
  const box = await page.evaluate(([sel, w]) => {
    const el = document.querySelector(sel); const tn = el.firstChild; const i = tn.textContent.indexOf(w);
    const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + w.length); const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, [containerSel, word]);
  await page.mouse.dblclick(box.x, box.y);
}

for (const vp of SIZES) {
  test(`Dictionary "Add a word" by mouse: empty library -> one word -> reload (${sz(vp)})`, { skip }, async () => {
    const a = await Hn.openApp(browser, { viewport: vp });
    try {
      const { page, ud } = a;
      await toAddBox(page);
      await expect(page.locator('#main .note').first()).toContainText('Nothing of yours yet.');
      await shot(page, 'aw-01-empty');
      await page.click('#sl-add-term'); await page.keyboard.type('Zorgle');
      await page.click('#sl-add-var'); await page.keyboard.type('zorg | zorgel');
      await page.click('#sl-add-go');
      await expect(page.locator('#sl-add-msg')).toHaveText('Added "Zorgle" to My terms. Undo');
      assert.deepEqual(mine(ud), [{ term: 'Zorgle', variants: ['zorg', 'zorgel'] }]);
      await expect(page.locator('#sl-add-term')).toHaveValue('');
      await expect(page.locator('#sl-add-term')).toBeFocused();
      await expect(page.locator('#main .note').first()).toContainText('1 terms of yours.');
      await page.fill('#sl-try', 'so the zorgel said hi');
      await expect(page.locator('#sl-try-out')).toHaveText('so the Zorgle said hi');
      await shot(page, 'aw-02-one-word');
      await a.reload(); await toAddBox(page);
      await page.click('#sl-mine-view');
      await expect(page.locator('#sl-view .trow')).toHaveCount(1);
      await expect(page.locator('#sl-view .trow b')).toHaveText('Zorgle');
      assert.deepEqual(a.errors, []);
    } finally { await a.close(); }
  });
}

test('Dictionary "Add a word" by keyboard only: fields, pack choice, own bias, Enter to add, Undo with the keyboard', { skip }, async () => {
  const a = await Hn.openApp(browser, { seed: { packs: { clan: { format: 1, id: 'clan', name: 'Clan words', terms: [{ term: 'skrrt' }] } } } });
  try {
    const { page, ud } = a;
    await toAddBox(page);
    await page.focus('#sl-add-term');
    await page.keyboard.type('Yoink');
    await page.keyboard.press('Tab'); await page.keyboard.type('yo ink');
    await page.keyboard.press('Tab'); await expect(page.locator('#sl-add-pack')).toBeFocused();
    await expect(page.locator('#sl-add-pack option')).toHaveText(['My terms', 'Clan words'], { useInnerText: true });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab'); await expect(page.locator('#sl-add-bias')).toBeFocused();
    await page.keyboard.type('80');
    await page.keyboard.press('Enter');
    await expect(page.locator('#sl-add-msg')).toContainText('Added "Yoink" to Clan words.');
    const clan = Hn.readJson(path.join(ud, 'dictionary', 'packs', 'clan.json')).terms;
    assert.deepEqual(clan, [{ term: 'skrrt' }, { term: 'Yoink', variants: ['yo ink'], bias: 80 }]);
    assert.deepEqual(mine(ud), [], 'nothing went to My terms');
    await shot(page, 'aw-03-keyboard-added');
    await tabTo(page, 'sl-add-undo');
    await page.keyboard.press('Enter');
    await expect(page.locator('#sl-add-msg')).toHaveText('Undone.');
    assert.deepEqual(Hn.readJson(path.join(ud, 'dictionary', 'packs', 'clan.json')).terms, [{ term: 'skrrt' }]);
    await a.reload(); await toAddBox(page);
    await page.click('[data-sl-view="clan"]');
    await expect(page.locator('#sl-view .trow')).toHaveCount(1);
  } finally { await a.close(); }
});

for (const vp of SIZES) {
  test(`duplicate (any case) merges, invalid input is refused with a message and writes nothing (${sz(vp)})`, { skip }, async () => {
    const a = await Hn.openApp(browser, { viewport: vp, seed: { mine: [{ term: 'rizz', variants: ['riz'] }] } });
    try {
      const { page, ud } = a;
      await toAddBox(page);
      await page.fill('#sl-add-term', 'RIZZ'); await page.fill('#sl-add-var', 'Riz | rits'); await page.click('#sl-add-go');
      await expect(page.locator('#sl-add-msg')).toContainText('Updated "RIZZ" in My terms.');
      assert.deepEqual(mine(ud), [{ term: 'RIZZ', variants: ['riz', 'rits'] }], 'one entry, variants unioned without a case duplicate');
      await shot(page, 'aw-04-duplicate-merged');
      const before = fs.readFileSync(Hn.minePath(ud), 'utf8');
      const cases = [
        ['', '', 'Type a word first.'],
        ['   ', '', 'Type a word first.'],
        ['\u0007\u001b', '', 'Empty term.'],
        ['!!! ???', '', 'No letters or digits.'],
        ['x'.repeat(200), '', 'Term longer than 80 characters.'],
        ['rizz🔥', '', 'Emoji cannot be dictated'],
        ['sigma', '150', 'Bias must be from 1% to 100%.'],
        ['sigma', 'loud', 'Bias must be a number from 1 to 100.'],
      ];
      for (const [term, bias, msg] of cases) {
        await page.fill('#sl-add-term', term); await page.fill('#sl-add-bias', bias);
        await page.click('#sl-add-go');
        await expect(page.locator('#sl-add-msg')).toContainText(msg);
        await expect(page.locator('#sl-add-msg')).toHaveClass(/bad/);
        await expect(page.locator('#sl-add-undo')).toHaveCount(0);
        if (msg.startsWith('Emoji')) await shot(page, 'aw-05-invalid-emoji');
      }
      assert.equal(fs.readFileSync(Hn.minePath(ud), 'utf8'), before, 'no refused input changed the file');
      await expect(page.locator('#sl-add-term')).toHaveValue('sigma', { timeout: 1000 });
    } finally { await a.close(); }
  });
}

test('many words: 400 terms in My terms; adding still works and the list is capped with a notice', { skip }, async () => {
  const terms = Array.from({ length: 400 }, (_, i) => ({ term: 'word' + String(i).padStart(3, '0') }));
  const a = await Hn.openApp(browser, { seed: { mine: terms } });
  try {
    const { page, ud } = a;
    await toAddBox(page);
    await page.fill('#sl-add-term', 'word401'); await page.keyboard.press('Enter');
    await expect(page.locator('#sl-add-msg')).toContainText('Added "word401"');
    assert.equal(mine(ud).length, 401);
    await page.click('#sl-mine-view');
    await expect(page.locator('#sl-view')).toContainText('Showing the first 120 of 401');
    await page.fill('#sl-q', 'word401');
    await expect(page.locator('#sl-view .trow')).toHaveCount(1);
    await page.evaluate(() => { document.querySelector('#main').scrollTop = document.querySelector('#sl-view').offsetTop - 12; });
    await shot(page, 'aw-06-many-words');
  } finally { await a.close(); }
});

test('engine restart: with biasing on, three quick adds restart the engine ONCE after they settle; the box works while it restarts', { skip }, async () => {
  const a = await Hn.openApp(browser, { seed: { settings: { historyEnabled: true, slang: { biasing: { enabled: true, score: 1.5 } } } }, main: { restartMs: 400, loadingMs: 2500 } });
  try {
    const { page, M, ud } = a;
    await toAddBox(page);
    for (const w of ['alpha1', 'beta2', 'gamma3']) { await page.fill('#sl-add-term', w); await page.keyboard.press('Enter'); await expect(page.locator('#sl-add-msg')).toContainText(`Added "${w}"`); }
    assert.equal(M.restarts, 0, 'not while the edits keep coming');
    await expect(page.locator('#sl-restarting')).toHaveText('Restarting the speech engine', { timeout: 3000 });
    assert.equal(M.restarts, 1);
    await expect(page.locator('#engine')).toContainText('Loading model');
    await page.fill('#sl-add-term', 'delta4'); await page.click('#sl-add-go');
    await expect(page.locator('#sl-add-msg')).toContainText('Added "delta4"');
    await page.evaluate(() => { document.querySelector('#main').scrollTop = document.querySelector('#sl-bias-pct').closest('.srow').offsetTop - 60; });
    await shot(page, 'aw-07-engine-restarting');
    await expect(page.locator('#sl-restarting')).toHaveCount(0, { timeout: 6000 });
    await expect(page.locator('#engine')).toContainText('Ready');
    await page.waitForTimeout(700);
    assert.equal(M.restarts, 2, 'the add during the restart caused exactly one more restart');
    assert.deepEqual(mine(ud).map((t) => t.term), ['alpha1', 'beta2', 'gamma3', 'delta4']);
  } finally { await a.close(); }
});

test('engine restart: with biasing off, adding words never restarts the engine', { skip }, async () => {
  const a = await Hn.openApp(browser, { main: { restartMs: 100 } });
  try {
    await toAddBox(a.page);
    await a.page.fill('#sl-add-term', 'alpha1'); await a.page.keyboard.press('Enter');
    await expect(a.page.locator('#sl-add-msg')).toContainText('Added');
    await a.page.waitForTimeout(500);
    assert.equal(a.M.restarts, 0);
    await expect(a.page.locator('#sl-restarting')).toHaveCount(0);
  } finally { await a.close(); }
});

for (const vp of SIZES) {
  test(`global bias as a percent: legacy score shows as %, typed % and slider keys are stored as scores, bad input refused, after reload (${sz(vp)})`, { skip }, async () => {
    const a = await Hn.openApp(browser, { viewport: vp, seed: { settings: { slang: { biasing: { enabled: false, score: 1 } } } } });
    try {
      const { page, ud } = a;
      await Hn.go(page, 'dictionary');
      await page.locator('#sl-bias-pct').scrollIntoViewIfNeeded();
      await expect(page.locator('#sl-bias-pct')).toHaveValue('33');
      await expect(page.locator('#sl-bias-range')).toHaveValue('33');
      await expect(page.locator('#sl-add-bias')).toHaveAttribute('placeholder', '33');
      await shot(page, 'aw-08-bias-legacy-33');
      // typed with the keyboard (page.fill would also fire 'change' and hide a broken Enter key)
      const typeInto = async (sel, text) => { await page.click(sel); await page.keyboard.press('Control+A'); await page.keyboard.type(text); };
      await typeInto('#sl-bias-pct', '70'); await page.keyboard.press('Enter');
      await expect(page.locator('#sl-bias-msg')).toHaveText('Bias set to 70%.');
      assert.equal(settingsFile(ud).slang.biasing.score, 2.1);
      await expect(page.locator('#sl-bias-pct')).toBeFocused();
      await page.focus('#sl-bias-range'); await page.keyboard.press('ArrowRight');
      await expect(page.locator('#sl-bias-pct')).toHaveValue('71');
      assert.equal(settingsFile(ud).slang.biasing.score, 2.13);
      await typeInto('#sl-bias-pct', 'abc'); await page.keyboard.press('Enter');
      await expect(page.locator('#sl-bias-msg')).toHaveText('Bias must be a number from 1 to 100.');
      await expect(page.locator('#sl-bias-pct')).toHaveValue('71');
      await typeInto('#sl-bias-pct', '0'); await page.keyboard.press('Tab');           // leaving the box commits it
      await expect(page.locator('#sl-bias-msg')).toHaveText('Bias must be from 1% to 100%.');
      await shot(page, 'aw-09-bias-invalid');
      assert.equal(settingsFile(ud).slang.biasing.score, 2.13);
      // drag the slider with the real mouse to its right end
      const box = await page.locator('#sl-bias-range').boundingBox();
      await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
      await expect(page.locator('#sl-bias-pct')).toHaveValue('100');
      assert.equal(settingsFile(ud).slang.biasing.score, 3);
      await a.reload(); await Hn.go(page, 'dictionary');
      await expect(page.locator('#sl-bias-pct')).toHaveValue('100');
      await expect(page.locator('#sl-add-hint')).toContainText('the global 100% (biasing is off, so bias does nothing yet)');
    } finally { await a.close(); }
  });
}

for (const vp of SIZES) {
  test(`quick add from transcript history by mouse: double-click a word, button, edit the spelling, the heard text is kept, undo (${sz(vp)})`, { skip }, async () => {
    const a = await Hn.openApp(browser, { viewport: vp, seed: { history: ['so the riz was crazy, no cap', 'gg everyone'] } });
    try {
      const { page, ud } = a;
      const firstTx = '.row[data-qa-line] [data-qa-src]';
      await expect(page.locator(firstTx).first()).toHaveText('so the riz was crazy, no cap');
      await dblclickWord(page, firstTx, 'riz');
      await expect(page.locator('#qa-btn')).toBeVisible();
      await shot(page, 'aw-10-history-selection-button');
      await page.click('#qa-btn');
      await expect(page.locator('#qa-pop')).toBeVisible();
      await expect(page.locator('#qa-term')).toHaveValue('riz');
      await expect(page.locator('#qa-term')).toBeFocused();
      await page.fill('#qa-term', 'rizz');
      await expect(page.locator('#qa-hint')).toContainText('"riz" is kept as "heard as"');
      const pb = await page.locator('#qa-pop').boundingBox();
      assert.ok(pb.x >= 0 && pb.y >= 0 && pb.x + pb.width <= vp.width && pb.y + pb.height <= vp.height, 'popover fits the window: ' + JSON.stringify(pb));
      await shot(page, 'aw-11-history-popover');
      await page.click('#qa-go');
      await expect(page.locator('#qa-msg')).toContainText('Added "rizz" to My terms.');
      assert.deepEqual(mine(ud), [{ term: 'rizz', variants: ['riz'] }]);
      await shot(page, 'aw-12-history-added');
      await page.click('#qa-undo');
      await expect(page.locator('#qa-msg')).toHaveText('Undone.');
      assert.deepEqual(mine(ud), []);
      await page.mouse.click(5, vp.height - 5);   // click outside closes it
      await expect(page.locator('#qa-pop')).toBeHidden();
      assert.deepEqual(a.errors, []);
    } finally { await a.close(); }
  });
}

test('quick add from transcript history by keyboard: row button, word buttons, Enter adds, Esc closes and focus returns', { skip }, async () => {
  const a = await Hn.openApp(browser, { seed: { history: ['the goaded ceiling shot', 'gg everyone'] } });
  try {
    const { page, ud } = a;
    // Tab from the start of the page to the first row's add button
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    let found = false;
    for (let i = 0; i < 30 && !found; i++) { await page.keyboard.press('Tab'); found = await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-qa-row')); }
    assert.ok(found, 'the row button is reachable by Tab');
    await page.keyboard.press('Enter');
    await expect(page.locator('#qa-pop')).toBeVisible();
    await expect(page.locator('#qa-pop [data-qa-word]')).toHaveText(['the', 'goaded', 'ceiling', 'shot']);
    await expect(page.locator('#qa-term')).toHaveValue('');
    await shot(page, 'aw-13-history-keyboard-words');
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');        // word field -> back to the last word buttons
    await expect(page.locator('#qa-pop [data-qa-word="ceiling"]')).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Enter');            // "goaded"
    await expect(page.locator('#qa-term')).toHaveValue('goaded'); await expect(page.locator('#qa-term')).toBeFocused();
    await page.keyboard.press('Control+A'); await page.keyboard.type('goated');
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.type('75');
    await page.keyboard.press('Enter');
    await expect(page.locator('#qa-msg')).toContainText('Added "goated" to My terms.');
    assert.deepEqual(mine(ud), [{ term: 'goated', variants: ['goaded'], bias: 75 }]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#qa-pop')).toBeHidden();
    assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-qa-row')), true, 'focus is back on the row button');
  } finally { await a.close(); }
});

test('quick add with an invalid pick (emoji) is refused inside the popover, nothing written', { skip }, async () => {
  const a = await Hn.openApp(browser, { seed: { history: ['that was fire 🔥🔥 honestly'] } });
  try {
    const { page, ud } = a;
    const tx = '.row[data-qa-line] [data-qa-src]';
    // drag-select with the mouse from the start of `from` to the end of `to`
    const drag = async (from, to) => {
      const pts = await page.evaluate(([sel, f, t]) => {
        const tn = document.querySelector(sel).firstChild, s = tn.textContent; const r = document.createRange();
        r.setStart(tn, s.indexOf(f)); r.setEnd(tn, s.indexOf(f) + 1); const a = r.getBoundingClientRect();
        const e = s.indexOf(t) + t.length; r.setStart(tn, e - 1); r.setEnd(tn, e); const b = r.getBoundingClientRect();
        return { x1: a.left + 1, y: a.top + a.height / 2, x2: b.right - 1 };
      }, [tx, from, to]);
      await page.mouse.move(pts.x1, pts.y); await page.mouse.down(); await page.mouse.move(pts.x2, pts.y, { steps: 6 }); await page.mouse.up();
    };
    await drag('fire', '🔥🔥');                    // trailing emoji are trimmed off the pick like punctuation
    await page.click('#qa-btn');
    await expect(page.locator('#qa-term')).toHaveValue('fire');
    await page.keyboard.press('Escape');
    await drag('fire', 'honestly');                // an emoji inside the pick stays, and the service refuses it
    await expect(page.locator('#qa-btn')).toBeVisible();
    await page.click('#qa-btn');
    await expect(page.locator('#qa-term')).toHaveValue('fire 🔥🔥 honestly');
    await page.keyboard.press('Enter');
    await expect(page.locator('#qa-msg')).toContainText('Emoji cannot be dictated');
    await shot(page, 'aw-14-popover-invalid-emoji');
    assert.deepEqual(mine(ud), []);
  } finally { await a.close(); }
});

test('history off: no quick-add buttons and no selection button', { skip }, async () => {
  const a = await Hn.openApp(browser, { seed: { settings: { historyEnabled: false } } });
  try {
    await expect(a.page.locator('#hist-on')).toBeVisible();
    await expect(a.page.locator('[data-qa-row]')).toHaveCount(0);
    await expect(a.page.locator('#qa-btn')).toBeHidden();
  } finally { await a.close(); }
});

for (const vp of SIZES) {
  test(`quick add from a finished meeting transcript: mouse selection and keyboard row button (${sz(vp)})`, { skip }, async () => {
    const a = await Hn.openApp(browser, { viewport: vp, seed: { meetings: [{ title: 'Scrim review', segments: [['Speaker 1', 'that flip reset was goaded'], ['Speaker 2', 'yeah the riz is real, no kap']] }] } });
    try {
      const { page, ud } = a;
      await Hn.go(page, 'meetings');
      const line2 = '.transcript-entry:nth-of-type(3) [data-qa-src]';
      await expect(page.locator('.transcript-entry [data-qa-src]')).toHaveText(['that flip reset was goaded', 'yeah the riz is real, no kap']);
      await page.locator('.transcript-entry').nth(1).scrollIntoViewIfNeeded();
      const sel2 = await page.evaluate(() => { const e = document.querySelectorAll('.transcript-entry [data-qa-src]')[1]; e.id = 'tline2'; return '#tline2'; });
      void line2;
      await dblclickWord(page, sel2, 'kap');
      await expect(page.locator('#qa-btn')).toBeVisible();
      await page.click('#qa-btn');
      await expect(page.locator('#qa-term')).toHaveValue('kap');
      await page.fill('#qa-term', 'no cap'); await page.fill('#qa-var', 'no kap');
      await shot(page, 'aw-15-meeting-popover');
      await page.keyboard.press('Enter');
      await expect(page.locator('#qa-msg')).toContainText('Added "no cap" to My terms.');
      assert.deepEqual(mine(ud), [{ term: 'no cap', variants: ['no kap', 'kap'] }]);
      await page.keyboard.press('Escape');
      await expect(page.locator('#qa-pop')).toBeHidden();
      // keyboard: the first line's row button
      await page.locator('.transcript-entry [data-qa-row]').first().focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#qa-pop [data-qa-word]')).toHaveText(['that', 'flip', 'reset', 'was', 'goaded']);
      await page.locator('#qa-pop [data-qa-word="goaded"]').focus(); await page.keyboard.press('Enter');
      await page.keyboard.press('Control+A'); await page.keyboard.type('goated'); await page.keyboard.press('Enter');
      await expect(page.locator('#qa-msg')).toContainText('Added "goated"');
      assert.deepEqual(mine(ud)[1], { term: 'goated', variants: ['goaded'] });
      // after a reload the word is in the Dictionary
      await a.reload(); await Hn.go(page, 'dictionary'); await page.click('#sl-mine-view');
      await expect(page.locator('#sl-view .trow b')).toHaveText(['no cap', 'goated']);
      assert.deepEqual(a.errors, []);
    } finally { await a.close(); }
  });
}
