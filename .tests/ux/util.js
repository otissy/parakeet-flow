'use strict';
/* The REAL renderer files in headless Chromium with a fake preload bridge: real clicks and real key presses, everything the main
   process would receive is recorded in window.__calls. No Electron window, no hotkeys, no microphone. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const root = path.join(__dirname, '..', '..');
const { DEFAULTS, normalize } = require(path.join(root, 'src/main/settings.js'));

function chromePath() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const dir = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  return path.join(base, dir, 'chrome-win64', 'chrome.exe');
}
const launch = () => chromium.launch({ executablePath: chromePath(), headless: true, args: ['--disable-gpu', '--mute-audio'] });

const SYNC_OFF = { enabled: false, configured: false, encryption: true, url: '', installId: '', name: '', linked: false, members: [], lastSyncAt: 0, lastError: '', nextRetryAt: 0, pulled: 0, pushed: 0, waiting: 0, conflicts: [], backup: '', notice: '' };
const SYNC_ON = { ...SYNC_OFF, enabled: true, configured: true, url: 'https://example.supabase.co', installId: '11111111-2222-4333-8444-555555555555' };
const UPDATE = { version: '0.2.62', installed: true, auto: true, state: 'idle', lastCheckAt: 0, lastFailed: false };

function bridge({ settings = {}, info = { engine: 'ready', modelsOk: true }, history = [], sync = SYNC_OFF, update = UPDATE, answers = {}, stats = { words: 0, wpm: 0, streak: 0 } }) {
  const merged = normalize(JSON.parse(JSON.stringify({ ...DEFAULTS, ...settings })));
  return `(() => {
    let settings = ${JSON.stringify(merged)};
    window.__info = ${JSON.stringify(info)};
    window.__sync = ${JSON.stringify(sync)};
    window.__update = ${JSON.stringify(update)};
    window.__answers = ${JSON.stringify(answers)};
    const data = { 'stats:get': ${JSON.stringify(stats)}, 'history:get': ${JSON.stringify(history)},
      'llm:status': { runtime: false, model: 'missing', worker: { state: 'stopped' }, last: null }, 'notion:status': { hasToken: false, encryption: true, counts: {} },
      'notes:list': [], 'mcp:info': { serverPath: 'x', dataDir: 'y', installed: false, statusFile: 'z' },
      'slang:state': { enabled: true, biasing: { enabled: false, score: 1.5, percent: 50 }, packs: [{ id: 'gaming', name: 'Gaming', description: 'x', language: 'en', builtin: true, editable: false, count: 3, variants: 1, enabled: true, warnings: [] }], mine: { count: 0 }, problems: [], active: 3 }, 'slang:terms': { total: 0, items: [] }, 'slang:preview': { text: '', hits: [] }, 'meetings:list': [], 'meetings:status': { ready: true } };
    window.__calls = [];
    const listeners = {};
    window.__fire = (ch, ...a) => (listeners[ch] || []).forEach((f) => f(...a));
    window.pf = {
      invoke: (ch, ...a) => {
        const clone = (v) => Promise.resolve(v === undefined ? null : JSON.parse(JSON.stringify(v)));
        if (ch === 'settings:get') return clone(settings);
        if (ch === 'settings:set') { window.__calls.push([ch, ...a]); settings = { ...settings, ...a[0] }; return clone(settings); }
        if (ch === 'app:info') return clone(window.__info);
        if (ch === 'sync:status') return clone(window.__sync);
        if (ch === 'update:status') return clone(window.__update);
        if (ch in window.__answers) { window.__calls.push([ch, ...a]); return clone(window.__answers[ch]); }
        if (ch !== 'history:get' && /^(sync|update|history|models):/.test(ch)) { window.__calls.push([ch, ...a]); return clone({ ok: true }); }
        return clone(data[ch]);
      },
      send: () => {}, on: (ch, f) => { (listeners[ch] = listeners[ch] || []).push(f); return () => {}; },
    };
  })();`;
}

/** rendererRoot: another copy of the repo (used for the before/after screenshots) */
async function open(browser, opts = {}) {
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1000, height: 680 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(bridge(opts));
  await page.goto('file:///' + path.join(opts.rendererRoot || root, 'src', 'renderer', 'app.html').replace(/\\/g, '/'));
  await page.waitForSelector('.wrap', { timeout: 8000 });
  if (opts.goto) {
    await page.click(`.nav[data-page="${opts.goto}"]`);
    if (opts.goto === 'settings') await page.waitForSelector('#sec-sync', { timeout: 8000 });
    else await page.waitForTimeout(80);
  }
  return { page, errors };
}
const calls = (page) => page.evaluate(() => window.__calls);

module.exports = { root, launch, open, calls, SYNC_OFF, SYNC_ON, UPDATE, bridge };
