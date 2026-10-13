'use strict';
/* ONE short real typing test: Win32 SendInput helper types into a window THIS script creates (a textarea), nothing else.
   run: electron .tests/app/real-typing.js   (needs a visible window for ~8 s). Not part of the ladder on purpose. */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { Win32Typer } = require(path.join(root, 'src/typer/win32-typer.js'));
const { AsrHost } = require(path.join(root, 'src/asr/asr-host.js'));
const { Controller } = require(path.join(root, 'src/main/controller.js'));
const { Store } = require(path.join(root, 'src/main/settings.js'));
const { WavMic } = require(path.join(root, 'src/main/mic.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODELS = path.join(process.env.APPDATA, 'parakeet-flow', 'models');
const out = process.env.PF_REPORT;

app.whenReady().then(async () => {
  const rep = { steps: [] };
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-real-'));
    const asr = new AsrHost({ modelDir: path.join(MODELS, 'parakeet-tdt-0.6b-v3-int8'), vadPath: path.join(MODELS, 'silero_vad.onnx'), numThreads: 2 });
    await asr.ready();
    const win = new BrowserWindow({ width: 640, height: 220, title: 'parakeet-flow typing test', alwaysOnTop: true, webPreferences: { sandbox: true } });
    await win.loadURL('data:text/html,<body style="margin:0;background:%23141417"><textarea id=t autofocus style="width:100%25;height:100%25;font:22px Segoe UI;background:%23141417;color:%23eee;border:0;padding:16px;box-sizing:border-box"></textarea></body>');
    win.show(); win.focus(); win.webContents.focus();
    const typer = new Win32Typer({ binDir: path.join(dir, 'bin'), test: true });
    await typer.ready;
    const hwnd = win.getNativeWindowHandle().readUInt32LE(0);
    for (let i = 0; i < 60; i++) { typer.queryForeground(); await sleep(80); if (typer.foreground() && typer.foreground().hwnd === hwnd) break; }
    rep.foregroundIsTestWindow = !!(typer.foreground() && typer.foreground().hwnd === hwnd);
    if (!rep.foregroundIsTestWindow) throw new Error('test window never became the foreground window; typing refused by design');
    typer.setHotkey([0x87]);                                        // F24: nobody binds it; pressed by the helper into our own window
    const store = new Store(dir);
    const mic = new WavMic({ file: path.join(root, '.tests', 'fixtures', 'short.wav') });
    const c = new Controller({ getAsr: () => asr, typer, store, mic, ownPid: 1 });
    c.attach();
    const states = []; c.on('pill', (p) => states.push(p.state));
    let result; c.on('result', (r) => { result = r; });
    const read = () => win.webContents.executeJavaScript('document.getElementById("t").value');
    const t0 = Date.now();
    typer.press(0x87, true);                                        // hold
    await sleep(2500); rep.whileTalking = await read();
    await sleep(3300);                                              // audio is 5.4 s
    typer.press(0x87, false);                                       // release
    for (let i = 0; i < 80 && !result; i++) await sleep(50);
    await sleep(300);
    rep.field = await read(); rep.result = result && result.words; rep.states = states; rep.totalMs = Date.now() - t0;
    const img = await win.webContents.capturePage(); fs.writeFileSync(process.env.PF_SHOT, img.toPNG());
    typer.close(); await asr.close();
  } catch (e) { rep.error = String(e.stack || e); }
  fs.writeFileSync(out, JSON.stringify(rep, null, 1));
  app.exit(0);
});
