'use strict';
/* parakeet-flow main process: tray, windows, helper, engine, IPC. Dictated text only travels through
   memory and (if the user turned history on) history.json; logs carry counts and timings. */
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, clipboard, session, dialog, safeStorage, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(1);
const arg = (name) => { const a = argv.find((x) => x.startsWith('--' + name + '=')); return a ? a.slice(name.length + 3) : null; };
const userDir = arg('user-data') || process.env.PF_USERDATA;
const squirrel = require('./squirrel');
const { mustExit, userDataDir } = squirrel;
app.setName('parakeet-flow');
// always the parakeet-flow folder under AppData/Roaming (models, settings, notes), installed or not, whatever the product name is
app.setPath('userData', userDir || userDataDir(app.getPath('appData')));
if (process.env.PF_OFFSCREEN) {   // tests: keep rendering windows that sit far off-screen
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

const { Store, DEFAULTS } = require('./settings');
const { BUILTIN_APPS } = require('../core/tone');
const { Controller } = require('./controller');
const { RendererMic, WavMic } = require('./mic');
const { Win32Typer } = require('../typer/win32-typer');
const { AsrHost } = require('../asr/asr-host');
const { verify, ensureModels, paths: modelPaths } = require('../asr/model-store');
const { iconPng } = require('./tray-icon');
const { Outbox } = require('../notes/outbox');
const { NotionSync } = require('../notes/notion');
const { NoteService } = require('../notes/service');
const { writeStatus, FILE: MCP_STATUS_FILE } = require('../notes/mcp-status');
const { SecretStore } = require('./secret');
const { LlmWorker } = require('../llm/llm-host');
const { LlmService } = require('../llm/cleanup');
const { SlangService } = require('../slang/service');
const slangIpc = require('../slang/ipc');
const llmStore = require('../llm/llm-store');
const { MeetingStore } = require('../meetings/store');
const { NemoRuntime } = require('../meetings/runtime');
const { MeetingService } = require('../meetings/service');

const R = (f) => path.join(__dirname, '..', 'renderer', f);
const PRELOAD = path.join(__dirname, 'preload.js');
const PILL_W = 480, PILL_H = 110;
const OFF = process.env.PF_OFFSCREEN ? -6000 : 0;   // tests: render windows far off-screen, nothing visible on the desktop

let store, typer, controller, asr = null, tray = null, mainWin = null, pillWin = null, capWin = null, meetingCaptureWin = null, mic;
let outbox, noteService, notion, secrets, slang, llmWorker = null, llmService, llmState = { runtime: false, model: 'unknown', error: '' };
let meetingStore = null, meetingService = null;
let engine = { state: 'loading', error: '' };
let quitting = false, modelsDir, modelsOk = false;

function log(level, msg) {   // counts and timings only
  try {
    const f = path.join(app.getPath('userData'), 'logs', 'app.log');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, `${new Date().toISOString()} ${level} ${msg}\n`);
  } catch (_) { /* logging must never break the app */ }
}

/* ---------------- windows ---------------- */
function createMain({ show = true } = {}) {
  mainWin = new BrowserWindow({
    width: 1000, height: 680, minWidth: 820, minHeight: 560, show: false, backgroundColor: '#141417', title: 'Parakeet Flow', x: OFF || undefined, y: OFF ? 0 : undefined,
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#141417', symbolColor: '#cfcfd6', height: 36 }, autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  mainWin.setMenu(null);
  mainWin.loadFile(R('app.html'));
  mainWin.once('ready-to-show', () => { if (show) mainWin.show(); });
  mainWin.on('close', (e) => { if (!quitting) { e.preventDefault(); mainWin.hide(); } });
}

function placePill() {
  if (!pillWin) return;
  const wa = screen.getPrimaryDisplay().workArea;
  pillWin.setBounds({ x: Math.round(wa.x + (wa.width - PILL_W) / 2) + OFF, y: wa.y + wa.height - PILL_H, width: PILL_W, height: PILL_H });
}
function createPill() {
  pillWin = new BrowserWindow({
    width: PILL_W, height: PILL_H, frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, show: false, fullscreenable: false, backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  pillWin.setAlwaysOnTop(true, 'screen-saver');
  pillWin.setIgnoreMouseEvents(true, { forward: true });
  pillWin.setVisibleOnAllWorkspaces(true);
  placePill();
  pillWin.loadFile(R('pill.html'));
  pillWin.once('ready-to-show', () => pillWin.showInactive());
  screen.on('display-metrics-changed', placePill);
}
function createCapture() {
  capWin = new BrowserWindow({ show: false, width: 200, height: 100, webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  capWin.loadFile(R('capture.html'));
}
function createMeetingCapture() {
  meetingCaptureWin = new BrowserWindow({ show: false, width: 200, height: 100, webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  meetingCaptureWin.loadFile(path.join(__dirname, '..', 'meetings', 'capture.html'));
}

function createTray() {
  tray = new Tray(nativeImage.createFromBuffer(iconPng(32)));
  tray.setToolTip('Parakeet Flow');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open Parakeet Flow', click: () => { mainWin.show(); mainWin.focus(); } },
    { label: 'Dictation enabled', type: 'checkbox', checked: controller ? controller.enabled : true, click: (i) => controller.setEnabled(i.checked) },
    { label: 'Whisper mode', type: 'checkbox', checked: !!(store && store.get().whisper.enabled), click: (i) => patchSettings({ whisper: { ...store.get().whisper, enabled: i.checked } }) },
    { label: 'Translate Dutch <-> English (experimental)', type: 'checkbox', checked: !!(store && store.get().translate.enabled), click: (i) => patchSettings({ translate: { ...store.get().translate, enabled: i.checked } }) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu());
  tray.on('click', () => { mainWin.show(); mainWin.focus(); });
  tray.on('right-click', () => tray.setContextMenu(menu()));
}

/* ---------------- engine ---------------- */
async function startEngine() {
  const s = store.get();
  engine = { state: 'loading', error: '' }; send(mainWin, 'engine:state');
  try {
    const v = await verify(modelsDir);
    modelsOk = v.ok;
    if (!v.ok) { engine = { state: v.bad.length ? 'error' : 'missing', error: v.bad.length ? 'Model file failed its SHA-256 check' : '' }; send(mainWin, 'engine:state'); return; }
    const p = modelPaths(modelsDir);
    if (asr) await asr.close();
    let hotwords = null;                      // contextual biasing toward the enabled slang terms (off by default; docs/slang-packs.md)
    if (s.slang.biasing.enabled) { try { hotwords = require('../slang/hotwords').build({ tokensFile: path.join(p.modelDir, 'tokens.txt'), terms: slang.enabledTerms(), dir: path.join(app.getPath('userData'), 'dictionary', 'hotwords'), score: s.slang.biasing.score }); } catch (e) { log('error', 'hotwords: ' + String(e.message).slice(0, 80)); } }
    asr = new AsrHost({ modelDir: p.modelDir, vadPath: p.vadPath, numThreads: s.threads, provider: s.provider, partialIntervalMs: s.partialMs, endpointMs: s.endpointMs, hotwords });
    if (hotwords) log('info', `hotwords on terms=${hotwords.count} score=${hotwords.hotwordsScore}`);
    asr.on('error', (e) => { engine = { state: 'error', error: String(e.message || e).slice(0, 120) }; send(mainWin, 'engine:state'); });
    const t0 = Date.now();
    await asr.ready();
    log('info', `engine ready in ${Date.now() - t0} ms provider=${s.provider} threads=${s.threads}`);
    engine = { state: 'ready', error: '' };
  } catch (e) {
    engine = { state: 'error', error: String(e.message || e).slice(0, 120) };
    log('error', 'engine failed: ' + engine.error);
  }
  send(mainWin, 'engine:state');
  writeMcpStatus();
}

const send = (win, ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };

/* ---------------- local model (optional cleanup / translate) ---------------- */
async function refreshLlmState() {
  llmState.runtime = llmStore.runtimeInstalled();
  try { const v = await llmStore.verify(modelsDir, { quick: true }); llmState.model = v.ok ? 'ready' : v.missing ? 'missing' : 'bad'; } catch (_) { llmState.model = 'bad'; }
  send(mainWin, 'llm:state');
}
/** the worker is created on first use and recreated when its settings change; it loads the model lazily and frees it when idle */
function getLlmWorker() {
  const c = store.get().cleanup;
  if (llmWorker && (llmWorker.threads !== c.threads || llmWorker.idleMs !== c.idleMin * 60000)) { llmWorker.stop('settings'); llmWorker = null; }
  if (!llmWorker) llmWorker = new LlmWorker({ entry: llmStore.RUNTIME_ENTRY, modelPath: llmStore.modelPath(modelsDir), threads: c.threads, idleMs: c.idleMin * 60000 });
  return llmWorker;
}
const llmAdapter = {
  chat: (o) => (llmState.runtime && llmState.model === 'ready' ? getLlmWorker().chat(o) : Promise.reject(new Error('local model not installed'))),
  warm: () => { if (llmState.runtime && llmState.model === 'ready') getLlmWorker().warm(); },
};
function patchSettings(patch) {
  const now = store.set(patch);
  controller.applySettings();
  send(mainWin, 'settings:changed', now);
  return now;
}
const notesApi = { save: (text, opts) => noteService.save(text, opts) };      // note-mode, the desktop fallback and "note to self" all land here (src/notes/service.js)

/** the small file the MCP server reads (src/notes/mcp-status.js): engine, hotkey labels, and recent dictation only if sharing is on */
function writeMcpStatus() {
  try {
    const s = store.get();
    const share = !!s.mcp.shareHistory;
    writeStatus(app.getPath('userData'), {
      pid: process.pid, version: app.getVersion(), engine: engine.state, hotkeys: { dictation: s.hotkey.label, note: s.notes.noteHotkey.label },
      shareHistory: share, recent: share && s.historyEnabled ? store.history.slice(0, 50) : [],
    });
  } catch (_) { /* the status file is a courtesy, never a failure */ }
}
/** push the hotkeys and the newline choice to the helper */
function applyTyperSettings(s) {
  typer.setHotkey(s.hotkey.vks);
  typer.setHotkey2(s.notes.noteHotkey.vks);
  typer.setNewline(s.typing.newline);
}

/* ---------------- IPC ---------------- */
function wireIpc() {
  const assertMainWindow = (event) => {
    if (event.sender !== mainWin?.webContents) throw new Error('Meeting action is not allowed from this page');
    if (!meetingService) throw new Error('Local meeting storage is unavailable');
  };
  ipcMain.handle('settings:get', (_e, what) => (what === 'defaults' ? DEFAULTS : store.get()));
  ipcMain.handle('settings:set', async (_e, patch) => {
    const before = store.get();
    const now = store.set(patch);
    applyTyperSettings(now);
    controller.applySettings();
    writeMcpStatus();
    const engineKeys = ['threads', 'provider', 'partialMs', 'endpointMs'];
    if (engineKeys.some((k) => before[k] !== now[k])) startEngine();
    return now;
  });
  ipcMain.handle('stats:get', () => store.summary());
  ipcMain.handle('history:get', () => (store.get().historyEnabled ? store.history : []));
  ipcMain.handle('history:copy', (_e, text) => { clipboard.writeText(String(text)); return true; });
  ipcMain.handle('history:clear', () => { store.clearHistory(); return true; });
  ipcMain.handle('models:status', () => verify(modelsDir, { quick: true }));
  ipcMain.handle('models:download', async () => {
    try {
      await ensureModels(modelsDir, { onProgress: (p) => send(mainWin, 'models:progress', { pct: p.total ? (p.got / p.total) * 100 : 0, file: p.file }) });
      send(mainWin, 'models:progress', { done: true, pct: 100 });
      await startEngine();
    } catch (e) {
      send(mainWin, 'models:progress', { done: true, pct: 0 });
      engine = { state: 'error', error: String(e.message).slice(0, 120) }; send(mainWin, 'engine:state');
    }
  });
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), engine: engine.state, error: engine.error, modelsOk: engine.state === 'ready' || modelsOk, gpuAvailable: false, userData: app.getPath('userData'), builtinApps: BUILTIN_APPS }));
  ipcMain.handle('notes:list', () => outbox.list());
  ipcMain.handle('export:choose', async () => {            // Markdown export folder picker (a native folder dialog; the page never sees a file)
    const r = await dialog.showOpenDialog(mainWin, { title: 'Folder for exported notes', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    patchSettings({ notes: { ...store.get().notes, export: { ...store.get().notes.export, folder: r.filePaths[0] } } });
    return { ok: true, folder: r.filePaths[0] };
  });
  ipcMain.handle('export:run', () => noteService.exportAll());
  ipcMain.handle('mcp:info', () => ({ serverPath: path.join(app.getAppPath(), 'mcp', 'server.js'), dataDir: app.getPath('userData'), installed: fs.existsSync(path.join(app.getAppPath(), 'mcp', 'node_modules', '@modelcontextprotocol')), statusFile: MCP_STATUS_FILE }));
  ipcMain.handle('notes:copy', (_e, id) => { const n = outbox.get(String(id)); if (n) clipboard.writeText(n.text); return !!n; });
  ipcMain.handle('notes:resend', async (_e, id) => { await notion.resend(String(id)).catch(() => {}); return outbox.get(String(id)); });
  ipcMain.handle('notes:delete', (_e, id) => { const ok = outbox.remove(String(id)); send(mainWin, 'notes:changed'); return ok; });
  ipcMain.handle('notion:status', () => ({ hasToken: secrets.has('notion'), encryption: secrets.available(), counts: outbox.counts() }));
  ipcMain.handle('notion:set-token', (_e, token) => {      // the token is stored encrypted and never sent back to any page
    try { secrets.set('notion', String(token || '')); return { ok: true, hasToken: secrets.has('notion') }; } catch (e) { return { ok: false, error: String(e.message || 'could not save').slice(0, 120) }; }
  });
  ipcMain.handle('notion:clear-token', () => { secrets.clear('notion'); return { ok: true, hasToken: false }; });
  ipcMain.handle('llm:status', async () => { await refreshLlmState(); return { ...llmState, worker: llmWorker ? llmWorker.status() : { state: 'stopped' }, last: llmService.last ? { kind: llmService.last.kind, used: llmService.last.used, reason: llmService.last.reason, ms: llmService.last.ms } : null }; });
  ipcMain.handle('llm:download', async () => {
    try {
      await llmStore.ensureModel(modelsDir, { onProgress: (p) => send(mainWin, 'llm:progress', { pct: p.total ? (p.got / p.total) * 100 : 0 }) });
      send(mainWin, 'llm:progress', { done: true, pct: 100 });
    } catch (e) { send(mainWin, 'llm:progress', { done: true, pct: 0 }); llmState.error = String(e.message).slice(0, 120); }
    await refreshLlmState();
  });
  ipcMain.handle('meetings:list', (event) => { assertMainWindow(event); return meetingStore.list(); });
  ipcMain.handle('meetings:status', (event) => { assertMainWindow(event); return meetingService.status(); });
  ipcMain.handle('meetings:setup', (event) => { assertMainWindow(event); return meetingService.setup(); });
  ipcMain.handle('meetings:start', (event, options) => { assertMainWindow(event); return meetingService.start(options || {}); });
  ipcMain.handle('meetings:stop', (event, options) => { assertMainWindow(event); return meetingService.stop(options?.id); });
  ipcMain.handle('meetings:update', (event, options) => { assertMainWindow(event); return meetingService.update(options?.id, options?.patch); });
  ipcMain.handle('meetings:delete', (event, value) => { assertMainWindow(event); return meetingService.delete(value && typeof value === 'object' ? value.id : value); });
  ipcMain.handle('meetings:summarize', (event, value) => { assertMainWindow(event); return meetingService.summarize(value && typeof value === 'object' ? value.id : value); });
  ipcMain.on('meeting:audio-chunk', (event, chunk) => {
    if (event.sender !== meetingCaptureWin?.webContents || !meetingService) return;
    try { meetingService.audioChunk(chunk); } catch (error) {
      log('error', 'meeting capture failed: ' + String(error.message || error).slice(0, 120));
      meetingService.captureError(error).catch((failure) => log('error', 'meeting capture cleanup failed: ' + String(failure.message || failure).slice(0, 120)));
    }
  });
  ipcMain.on('meeting:capture-ready', (event) => { if (event.sender === meetingCaptureWin?.webContents && meetingService) meetingService.captureReady(); });
  ipcMain.on('meeting:capture-stopped', (event) => { if (event.sender === meetingCaptureWin?.webContents && meetingService) meetingService.captureStopped(); });
  ipcMain.on('meeting:capture-error', (event, error) => {
    if (event.sender !== meetingCaptureWin?.webContents || !meetingService) return;
    meetingService.captureError(error).catch((failure) => log('error', 'meeting capture failure: ' + String(failure.message || failure).slice(0, 120)));
  });
  let slangTimer = null;       // the hotword list is read when the engine starts: a changed list restarts it (once, after the edits settle)
  slangIpc.register(ipcMain, { service: slang, dialog, getWindow: () => mainWin, onChange: () => { if (!store.get().slang.biasing.enabled && !asr?.opts?.hotwords) return; clearTimeout(slangTimer); slangTimer = setTimeout(() => startEngine(), 2500); } });
  ipcMain.handle('login:set', (_e, on) => {
    if (!process.env.PF_NO_LOGIN_ITEM) app.setLoginItemSettings({ openAtLogin: !!on });
    return store.set({ launchAtLogin: !!on });
  });
  ipcMain.on('hotkey:capture', (_e, on) => { if (controller) controller.setCapturing(!!on); });   // picker open: pass Ctrl+Space through, never start dictation
  ipcMain.on('pill:mouse', (_e, over) => { if (pillWin) pillWin.setIgnoreMouseEvents(!over, { forward: true }); });
  ipcMain.on('pill:action', (_e, a) => { if (a === 'cancel') controller.fsm.esc(); else if (a === 'stop') controller.fsm.down(Date.now()); });
}

/* ---------------- boot ---------------- */
const squirrelExit = mustExit(argv);   // Update.exe runs the app with --squirrel-install/-updated/-uninstall/-obsolete: exit at once
const lock = squirrelExit ? false : app.requestSingleInstanceLock();
if (squirrelExit) squirrel.handle(squirrel.squirrelEvent(argv), { execPath: process.execPath, spawn: require('child_process').spawn, exists: fs.existsSync, log: (t) => log('info', t) }, () => app.exit(0));
else if (!lock) app.quit();
else {
  app.on('second-instance', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } });
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
    session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media');
    store = new Store(app.getPath('userData'));
    modelsDir = process.env.PF_MODELS || path.join(app.getPath('userData'), 'models');
    outbox = new Outbox(path.join(app.getPath('userData'), 'notes.jsonl'));
    secrets = new SecretStore(path.join(app.getPath('userData'), 'secrets.json'), safeStorage);
    notion = new NotionSync({ outbox, base: process.env.PF_NOTION_BASE, getConfig: () => store.get().notes.notion, getToken: () => secrets.get('notion'),
      onChange: () => send(mainWin, 'notes:changed') });
    notion.start();
    slang = new SlangService({ builtinDir: path.join(__dirname, '..', 'slang', 'packs'), userDir: path.join(app.getPath('userData'), 'dictionary', 'packs'), getSettings: () => store.get(), setSettings: (p) => store.set(p) });
    noteService = new NoteService({ outbox, getSettings: () => store.get(), notion, hasToken: () => secrets.has('notion'), onChange: () => send(mainWin, 'notes:changed'), log });
    noteService.watch();
    llmService = new LlmService({ llm: llmAdapter, getSettings: () => store.get(), getVocab: (t) => slang.vocab(t) });
    refreshLlmState();
    try {
      meetingStore = new MeetingStore(path.join(app.getPath('userData'), 'meetings.json'));
      const runtime = new NemoRuntime({ userData: app.getPath('userData') });
      meetingService = new MeetingService({
        store: meetingStore,
        runtime,
        userData: app.getPath('userData'),
        getCaptureWindow: () => meetingCaptureWin,
        getSystemSource: async () => {
          const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
          const primaryId = String(screen.getPrimaryDisplay().id);
          return (sources.find((source) => source.display_id === primaryId) || sources[0])?.id || '';
        },
        getMicId: () => store.get().micId,
        llm: llmAdapter,
        summaryReady: () => llmState.runtime && llmState.model === 'ready',
        onChange: () => send(mainWin, 'meetings:changed'),
        onProgress: (progress) => send(mainWin, 'meetings:progress', progress),
        onState: (state) => send(mainWin, 'meetings:state', state),
      });
    } catch (error) {
      log('error', 'meeting storage unavailable: ' + String(error.message || error).slice(0, 120));
    }
    wireIpc();
    createCapture();
    createMeetingCapture();
    createMain({ show: !argv.includes('--hidden') });
    createPill();
    createTray();
    startEngine();
    // The helper child process is spawned only after the pages have loaded: started earlier it stalls
    // Chromium's renderer launch on this machine (pages never reach dom-ready).
    await Promise.all([mainWin, pillWin, capWin, meetingCaptureWin].map((w) => new Promise((r) => { if (!w.webContents.isLoading()) r(); else w.webContents.once('did-finish-load', r); })));
    typer = new Win32Typer({ binDir: path.join(app.getPath('userData'), 'bin') });
    await typer.ready;
    applyTyperSettings(store.get());
    typer.queryForeground();

    const fake = arg('fake-mic') || process.env.PF_FAKE_MIC;
    mic = fake ? new WavMic({ file: fake }) : new RendererMic({ ipcMain, getWindow: () => capWin, getSettings: () => store.get() });
    controller = new Controller({ getAsr: () => (engine.state === 'ready' ? asr : null), typer, store, mic, llm: llmService, notes: notesApi, slang });
    controller.attach();
    typer.on('refused', () => { if (controller.session) controller.session.live._halt('refused'); });
    typer.on('exit', () => log('error', 'helper exited'));
    controller.on('pill', (p) => send(pillWin, 'pill:state', p));
    controller.on('note', (n) => send(pillWin, 'pill:state', { state: controller.pillState, text: '', ...n }));
    controller.on('level', (v) => send(pillWin, 'pill:level', v));
    controller.on('history', (h) => { send(mainWin, 'app:history', h); writeMcpStatus(); });
    controller.on('flags', (f) => send(pillWin, 'pill:flags', f));
    controller.on('notes', () => send(mainWin, 'notes:changed'));
    send(pillWin, 'pill:flags', controller.flags());
    writeMcpStatus(); setInterval(writeMcpStatus, 15000).unref();
    controller.on('result', (r) => { log('info', `dictation done words=${r.words} chars=${r.chars} finals=${r.finals} insertions=${r.insertions} duplicateFinals=${r.duplicateFinals}`); send(mainWin, 'app:stats', store.summary()); });

    if (process.env.PF_TEST_HOOK) require(process.env.PF_TEST_HOOK)({ app, get: () => ({ store, typer, controller, mainWin, pillWin, asr: () => asr, mic, engine: () => engine, meetings: meetingService }) });
  });
  app.on('before-quit', () => { quitting = true; try { fs.unlinkSync(path.join(app.getPath('userData'), MCP_STATUS_FILE)); } catch (_) { /* none */ } if (meetingService) { try { meetingService.close(); } catch (e) { log('error', 'meeting shutdown failed: ' + String(e.message || e).slice(0, 120)); } } if (typer) typer.close(); if (llmWorker) llmWorker.stop('quit'); if (notion) notion.stop(); });
  app.on('window-all-closed', () => { /* stay in the tray */ });
}
