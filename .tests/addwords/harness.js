'use strict';
/* Headless harness for the renderer: the REAL renderer files (src/renderer/app.html, file://, real CSP) in headless Chromium
   (Playwright), the REAL preload (src/main/preload.js, evaluated with a shim for require('electron')), bridged to a Node
   router that holds the REAL slang IPC (src/slang/ipc.js) over the REAL SlangService and the REAL settings Store on a temp
   user-data folder, plus the real MeetingStore for meeting transcripts. The engine restart uses the REAL settleRestart
   (src/slang/hotwords.js); only the speech engine itself is a fake that reports loading -> ready.
   No Electron window, no global hotkeys, no helper process. Runs at below-normal priority.
   Playwright: PF_PLAYWRIGHT=<folder containing node_modules/@playwright/test> (default ../pf-add-words-scratch next to the repo). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..', '..');
try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) { /* best effort */ }

function loadPlaywright() {
  const dirs = [process.env.PF_PLAYWRIGHT, path.join(root, '..', 'pf-add-words-scratch'), root].filter(Boolean);
  for (const d of dirs) { try { return require(require.resolve('@playwright/test', { paths: [d] })); } catch (_) { /* next */ } }
  return null;
}

/** a temp user-data folder with optional seed: {settings, history:[text], mine:[terms], packs:{id: packJson}, meetings:[{title, segments}]} */
function makeUserData(seed = {}) {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-addwords-'));
  const packs = path.join(ud, 'dictionary', 'packs');
  fs.mkdirSync(packs, { recursive: true });
  const settings = { historyEnabled: true, ...(seed.settings || {}) };
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(settings));
  if (seed.history) fs.writeFileSync(path.join(ud, 'history.json'), JSON.stringify(seed.history.map((t, i) => ({ id: 'h' + i, ts: Date.now() - i * 60000, text: t, words: t.split(' ').length }))));
  if (seed.mine) fs.writeFileSync(path.join(packs, 'mine.json'), JSON.stringify({ format: 1, id: 'mine', name: 'My terms', terms: seed.mine }));
  for (const [id, p] of Object.entries(seed.packs || {})) fs.writeFileSync(path.join(packs, p.file || id + '.json'), typeof p.text === 'string' ? p.text : JSON.stringify(p));
  return ud;
}

/** the main-process side: router for ipcRenderer.invoke, plus a log of engine restarts */
function makeMain(ud, { restartMs = 250, loadingMs = 1200, seedMeetings = [] } = {}) {
  const { Store } = require(path.join(root, 'src/main/settings.js'));
  const { SlangService } = require(path.join(root, 'src/slang/service.js'));
  const slangIpc = require(path.join(root, 'src/slang/ipc.js'));
  const { settleRestart } = require(path.join(root, 'src/slang/hotwords.js'));
  const { MeetingStore } = require(path.join(root, 'src/meetings/store.js'));
  const store = new Store(ud);
  const slang = new SlangService({ builtinDir: path.join(root, 'src/slang/packs'), userDir: path.join(ud, 'dictionary', 'packs'), getSettings: () => store.get(), setSettings: (p) => store.set(p) });
  const meetings = new MeetingStore(path.join(ud, 'meetings', 'meetings.json'));
  for (const m of seedMeetings) { const c = meetings.create({ title: m.title }); m.segments.forEach((s, i) => meetings.appendSegment(c.id, { start: i * 7, end: i * 7 + 6, speaker: s[0], text: s[1] })); meetings.update(c.id, { status: 'complete' }); }
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on: () => {} };
  const M = { store, slang, handlers, restarts: 0, engine: 'ready', emit: async () => {}, timers: [] };
  const restart = () => {                                   // the fake engine: loading for a while, then ready (like startEngine)
    M.restarts++; M.engine = 'loading'; M.emit('engine:state');
    M.timers.push(setTimeout(() => { M.engine = 'ready'; M.emit('engine:state'); }, loadingMs));
  };
  const onChange = settleRestart({ shouldRestart: () => store.get().slang.biasing.enabled, restart, ms: restartMs });
  slangIpc.register(ipcMain, { service: slang, dialog: { showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }) }, onChange });
  const h = (ch, fn) => handlers.set(ch, fn);
  h('settings:get', () => store.get());
  h('settings:set', (_e, patch) => store.set(patch));
  h('stats:get', () => ({ words: 1234, wpm: 140, streak: 3 }));
  h('history:get', () => (store.get().historyEnabled ? store.history : []));
  h('history:copy', () => true); h('history:clear', () => { store.clearHistory(); return true; });
  h('app:info', () => ({ engine: M.engine, modelsOk: true, version: 'test', gpuAvailable: false }));
  h('llm:status', () => ({ runtime: false, model: 'missing', state: 'off' })); h('notion:status', () => ({ hasToken: false }));
  h('notes:list', () => []); h('mcp:info', () => ({ serverPath: '', installed: false }));
  h('meetings:list', () => meetings.list()); h('meetings:status', () => ({ ready: true }));
  M.invoke = async (ch, args) => {
    const fn = handlers.get(ch);
    if (!fn) throw new Error(`No handler registered for '${ch}'`);
    return fn({ sender: null }, ...args);
  };
  M.close = () => M.timers.forEach(clearTimeout);
  return M;
}

/* the preload, run in the page before its scripts: real file, shimmed require('electron') */
const preloadSrc = fs.readFileSync(path.join(root, 'src/main/preload.js'), 'utf8');
const INIT = `(() => {
  const listeners = {};
  const electron = {
    contextBridge: { exposeInMainWorld: (k, v) => { window[k] = v; } },
    ipcRenderer: {
      invoke: (ch, ...a) => window.__pfInvoke(ch, a),
      send: () => {},
      on: (ch, l) => { (listeners[ch] = listeners[ch] || []).push(l); },
      removeListener: (ch, l) => { listeners[ch] = (listeners[ch] || []).filter((x) => x !== l); },
    },
  };
  window.__pfEmit = (ch, ...a) => { for (const l of listeners[ch] || []) l({}, ...a); };
  const require = (m) => { if (m === 'electron') return electron; throw new Error('preload may only require electron'); };
  ${preloadSrc}
})();`;

/** start a browser (once per test file) */
async function launch() {
  const pw = loadPlaywright();
  if (!pw) return null;
  const browser = await pw.chromium.launch({ headless: true, args: ['--disable-gpu', '--mute-audio'] });
  return browser;
}

/** open the real app page against a main-process side; returns {page, M, ud, reload} */
async function openApp(browser, { seed = {}, viewport = { width: 1920, height: 1080 }, main = {} } = {}) {
  const ud = makeUserData(seed);
  const M = makeMain(ud, { ...main, seedMeetings: seed.meetings || [] });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.exposeBinding('__pfInvoke', async (_src, ch, args) => M.invoke(ch, args));
  M.emit = async (ch, ...a) => { try { await page.evaluate(([c, x]) => window.__pfEmit(c, ...x), [ch, a]); } catch (_) { /* page gone */ } };
  await page.addInitScript(INIT);
  const url = pathToFileURL(path.join(root, 'src/renderer/app.html')).href;
  const load = async () => {
    await page.goto(url);
    try { await page.waitForFunction(() => typeof S !== 'undefined' && S.settings && typeof SL !== 'undefined' && SL.state, null, { timeout: 15000 }); }
    catch (e) { throw new Error('app did not load: ' + errors.join(' | ')); }
  };
  await load();
  return { page, M, ud, ctx, errors, reload: load, close: async () => { M.close(); await ctx.close(); fs.rmSync(ud, { recursive: true, force: true }); } };
}

const go = async (page, name) => { await page.click(`.nav[data-page="${name}"]`); };
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const minePath = (ud) => path.join(ud, 'dictionary', 'packs', 'mine.json');
const shotDir = process.env.PF_SHOTS || path.join(root, '..', 'pf-add-words-shots');

module.exports = { loadPlaywright, launch, openApp, makeUserData, makeMain, go, readJson, minePath, shotDir, root };
