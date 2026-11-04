'use strict';
/* The Sync section of the REAL renderer files in headless Chromium, with a fake preload bridge. Clicks real controls and checks what the
   main process would receive. No Electron window, nothing visible. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { root } = require('./util');
const { chromium } = require('playwright-core');
const { DEFAULTS, normalize } = require(path.join(root, 'src/main/settings.js'));

const APP = path.join(root, 'src', 'renderer', 'app.html');
function chromePath() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const dir = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  return path.join(base, dir, 'chrome-win64', 'chrome.exe');
}

const BASE = { enabled: false, configured: false, encryption: true, url: '', installId: '', linked: false, members: [], lastSyncAt: 0, lastError: '', nextRetryAt: 0, pulled: 0, pushed: 0, waiting: 0, conflicts: [], backup: '', notice: '' };
function bridge(sync, answers = {}) {
  return `(() => {
    const settings = ${JSON.stringify(normalize(JSON.parse(JSON.stringify(DEFAULTS))))};
    const data = {
      'settings:get': settings, 'stats:get': { words: 0, wpm: 0, streak: 0 }, 'history:get': [], 'app:info': { engine: 'ready', version: '0.2.61' },
      'llm:status': { runtime: false, model: 'missing', worker: { state: 'stopped' }, last: null }, 'notion:status': { hasToken: false, encryption: true, counts: {} },
      'notes:list': [], 'mcp:info': { serverPath: 'x', dataDir: 'y', installed: false, statusFile: 'z' },
      'slang:state': { enabled: true, biasing: { enabled: false, score: 1.5, percent: 50 }, packs: [], mine: { count: 0 }, problems: [], active: 0 }, 'slang:terms': { total: 0, items: [] }, 'meetings:list': [], 'meetings:status': {},
    };
    window.__state = ${JSON.stringify(sync)};
    const answers = ${JSON.stringify(answers)};
    window.__calls = [];
    const listeners = {};
    window.__fire = (ch) => (listeners[ch] || []).forEach((f) => f());
    window.pf = {
      invoke: (ch, ...a) => {
        if (ch === 'sync:status') return window.__state === 'fail' ? Promise.reject(new Error('down')) : Promise.resolve(JSON.parse(JSON.stringify(window.__state)));
        if (ch.startsWith('sync:')) { window.__calls.push([ch, ...a]); return Promise.resolve(answers[ch] || { ok: true }); }
        return Promise.resolve(ch in data ? JSON.parse(JSON.stringify(data[ch])) : null);
      },
      send: () => {}, on: (ch, f) => { (listeners[ch] = listeners[ch] || []).push(f); return () => {}; },
    };
  })();`;
}

let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: chromePath(), headless: true }); });
test.after(async () => { if (browser) await browser.close(); });

async function open(state, answers) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 680 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(bridge(state, answers));
  await page.goto('file:///' + APP.replace(/\\/g, '/'));
  await page.click('.nav[data-page="settings"]');
  await page.waitForSelector('#sync-card, #sec-sync', { timeout: 5000 });
  return { page, errors };
}
const calls = (page) => page.evaluate(() => window.__calls);
const ON = { ...BASE, enabled: true, configured: true, url: 'https://example.supabase.co', installId: '11111111-2222-4333-8444-555555555555' };

test('off by default: says what goes and what never goes; the switch waits for a project; network buttons are disabled', async () => {
  const { page, errors } = await open(BASE);
  const t = await page.locator('#sync-card').innerText();
  assert.match(t, /Off by default/);
  assert.match(t, /Dictated text, notes, meetings, tokens and logs never leave this PC/);
  for (const id of ['#sy-on', '#sy-code', '#sy-join-go', '#sy-now', '#sy-join']) assert.ok(await page.locator(id).isDisabled(), id);
  assert.equal(await page.locator('#sy-unlink').count(), 0);
  assert.match(t, /Sync is off/);
  assert.deepStrictEqual(errors, []);
  await page.close();
});

test('the URL and key go to the main process, and the key box is emptied', async () => {
  const { page } = await open(BASE);
  await page.fill('#sy-url', 'https://example.supabase.co');
  await page.fill('#sy-key', 'sb_publishable_abc');
  await page.click('#sy-save');
  await page.waitForFunction(() => document.getElementById('sy-key').value === '');
  assert.deepStrictEqual(await calls(page), [['sync:configure', { url: 'https://example.supabase.co', key: 'sb_publishable_abc' }]]);
  await page.close();
});

test('a refused key shows the reason, keeps the URL and empties the key box', async () => {
  const { page } = await open(BASE, { 'sync:configure': { ok: false, error: 'That is a SECRET key (sb_secret_...).' } });
  await page.fill('#sy-url', 'https://example.supabase.co');
  await page.fill('#sy-key', 'sb_secret_abc');
  await page.click('#sy-save');
  await page.waitForFunction(() => /SECRET key/.test(document.getElementById('sync-card').innerText));
  assert.equal(await page.inputValue('#sy-url'), 'https://example.supabase.co');
  assert.equal(await page.inputValue('#sy-key'), '');
  assert.equal(await page.evaluate(() => XS.key), '');
  await page.close();
});

test('on: the ID, a link code and joining work through the right channels', async () => {
  const { page, errors } = await open(ON, { 'sync:create-code': { ok: true, code: 'ABC-234', expiresAt: 'x' } });
  assert.match(await page.locator('#sync-card').innerText(), /11111111-2222-4333-8444-555555555555/);
  await page.click('#sy-code');
  await page.waitForFunction(() => /ABC-234/.test(document.getElementById('sync-card').innerText));
  await page.fill('#sy-join', 'xyz-789');
  await page.click('#sy-join-go');
  await page.waitForFunction(() => document.getElementById('sy-join').value === '');
  await page.click('#sy-now');
  await page.waitForTimeout(50);
  assert.deepStrictEqual(await calls(page), [['sync:create-code'], ['sync:join', 'xyz-789'], ['sync:now']]);
  assert.deepStrictEqual(errors, []);
  await page.close();
});

test('linked: the list shows the other install, Unlink calls unlink; conflicts and errors are visible', async () => {
  const { page } = await open({ ...ON, linked: true, lastSyncAt: Date.now() - 120000, pulled: 3, pushed: 2, backup: 'C:/x/backup.json',
    members: [{ id: ON.installId, isMe: true, version: 'parakeet-flow 0.2.61' }, { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', isMe: false, version: 'parakeet-flow 0.2.61' }],
    conflicts: [{ label: 'tone.apps', kept: 'other', lost: '[{"match":"slack"}]', at: 1 }] });
  const t = await page.locator('#sync-card').innerText();
  assert.match(t, /aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/);
  assert.match(t, /1 linked/);
  assert.match(t, /2 min ago: 3 received/);
  assert.match(t, /tone\.apps/); assert.match(t, /slack/); assert.match(t, /kept the other PC/);
  page.on('dialog', (d) => d.accept());
  await page.click('#sy-unlink');
  await page.waitForTimeout(40);
  await page.click('#sy-restore');
  await page.waitForTimeout(60);
  assert.deepStrictEqual((await calls(page)).map((c) => c[0]), ['sync:unlink', 'sync:restore']);
  await page.close();
});

test('the server down: the message says so and that local data is safe', async () => {
  const { page } = await open({ ...ON, lastError: 'Could not reach the server.', nextRetryAt: Date.now() + 60000, waiting: 2 });
  const t = await page.locator('#sy-status').innerText();
  assert.match(t, /Could not reach/); assert.match(t, /safe on this PC/); assert.match(t, /trying again/); assert.match(t, /2 changes waiting/);
  await page.close();
});

test('a status update while typing keeps the text in all three boxes', async () => {
  const { page } = await open(ON);
  await page.fill('#sy-url', 'https://other.supabase.co');
  await page.fill('#sy-key', 'sb_publishable_typing');
  await page.fill('#sy-join', 'abc');
  await page.evaluate(() => window.__fire('sync:changed'));
  await page.waitForTimeout(60);
  assert.equal(await page.inputValue('#sy-url'), 'https://other.supabase.co');
  assert.equal(await page.inputValue('#sy-key'), 'sb_publishable_typing');
  assert.equal(await page.inputValue('#sy-join'), 'abc');
  await page.close();
});

test('the sync status failing leaves the rest of Settings working', async () => {
  const { page, errors } = await open('fail');
  const t = await page.locator('#main').innerText();
  assert.match(t, /could not be read/); assert.match(t, /Voice commands/); assert.match(t, /Keep transcript history/);
  assert.deepStrictEqual(errors, []);
  await page.close();
});

test('text from the server is escaped, never run as HTML', async () => {
  const { page } = await open({ ...ON, lastError: '<img src=x onerror=window.__pwn=1>', conflicts: [{ label: '<b id=evil>x</b>', kept: 'this', lost: '<i id=evil2>', at: 1 }] });
  assert.equal(await page.locator('#evil, #evil2').count(), 0);
  assert.equal(await page.evaluate(() => window.__pwn), undefined);
  await page.close();
});

test('the repo holds no database address or key: no project URL or publishable key in any tracked file', () => {
  const { execFileSync } = require('child_process');
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter((f) => !/\.(png|ico|exe|dll|wav)$/i.test(f) && !f.endsWith('package-lock.json'));
  const hits = [];
  for (const f of files) {
    let t; try { t = fs.readFileSync(path.join(root, f), 'utf8'); } catch (_) { continue; }
    for (const m of t.matchAll(/[a-z0-9]{20}\.supabase\.co|sb_publishable_[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}/g)) hits.push(f + ': ' + m[0].slice(0, 12) + '...');
  }
  assert.deepStrictEqual(hits, []);
});

const builtDir = process.env.PF_BUILT_DIR || path.join(process.env.PF_BUILDS || 'D:/builds/parakeet-flow', require(path.join(root, 'package.json')).version);
const appDir = path.join(builtDir, 'win-unpacked', 'resources', 'app');
test('the built package carries the sync code and no database address or key', { skip: fs.existsSync(path.join(appDir, 'src')) ? false : 'no build at ' + appDir }, () => {
  assert.ok(fs.existsSync(path.join(appDir, 'src', 'sync', 'allowlist.js')));
  assert.ok(fs.existsSync(path.join(appDir, 'src', 'renderer', 'sync-ui.js')));
  const hits = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (/\.(js|json|html|css|md|sql)$/i.test(e.name)) {
        const s = fs.readFileSync(p, 'utf8');
        if (/[a-z0-9]{20}\.supabase\.co|sb_publishable_[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{16,}/.test(s)) hits.push(path.relative(appDir, p));
      }
    }
  })(appDir);
  assert.deepStrictEqual(hits, []);
  assert.ok(!fs.existsSync(path.join(appDir, '.tests')), 'tests are not shipped');
});
