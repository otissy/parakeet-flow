'use strict';
/* MANUAL real-keys test (not in the ladder): the real helper + SendInput + the real keyboard hook, into ONE window this script
   creates (a textarea that logs every key event the page receives). Ctrl and Space are injected by the helper (PRESS) and every
   injection is refused unless that window is the foreground window. Visible for ~6 s.
   run: PF_REPORT=<json> PF_SHOT=<png> electron .tests/ctrlspace/real-ctrl-space.js */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { Win32Typer } = require(path.join(root, 'src/typer/win32-typer.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CTRL = 0x11, SPACE = 0x20;

app.whenReady().then(async () => {
  const rep = { steps: {} };
  let typer; let hwnd = 0;
  const press = (vk, down) => typer.press(vk, down, hwnd);
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-realcs-'));
    const html = '<body style="margin:0;background:#141417;color:#ddd;font:16px Consolas"><textarea id=t autofocus style="width:100%;height:90px;font:22px Segoe UI;background:#1b1b20;color:#eee;border:0;padding:12px;box-sizing:border-box"></textarea>'
      + '<pre id=log style="margin:8px 12px;white-space:pre-wrap"></pre><script>window.L=[];for(const ty of ["keydown","keyup"])addEventListener(ty,e=>{L.push((ty=="keydown"?"d:":"u:")+e.key+":"+(e.ctrlKey?1:0));document.getElementById("log").textContent=L.join("  ")},true)</script>';
    const win = new BrowserWindow({ width: 760, height: 330, title: 'parakeet-flow Ctrl+Space test', alwaysOnTop: true, webPreferences: { sandbox: true } });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.show(); win.focus(); win.webContents.focus();
    typer = new Win32Typer({ binDir: path.join(dir, 'bin'), test: true });
    await typer.ready;
    hwnd = win.getNativeWindowHandle().readUInt32LE(0);
    for (let i = 0; i < 80; i++) { typer.queryForeground(); await sleep(80); if (typer.foreground() && typer.foreground().hwnd === hwnd) break; }
    if (!(typer.foreground() && typer.foreground().hwnd === hwnd)) throw new Error('test window never became foreground; nothing was pressed');
    const keys = []; typer.on('key', (e) => keys.push(e.down ? 'down' : 'up'));
    typer.on('line', () => {});
    typer.setHotkey([CTRL, SPACE]); typer.setClaim(true);
    const val = () => win.webContents.executeJavaScript('document.getElementById("t").value');
    const log = () => win.webContents.executeJavaScript('window.L.slice()');
    const reset = () => win.webContents.executeJavaScript('document.getElementById("t").value="";window.L.length=0;document.getElementById("t").focus()');
    const opts = { hwnd };

    // A: lone Space and lone Ctrl never start dictation, and both reach the app
    await reset(); press(SPACE, true); press(SPACE, false); await sleep(120); press(CTRL, true); press(CTRL, false); await sleep(200);
    rep.steps.A = { value: await val(), log: await log(), keys: keys.slice() };
    // B: Space first, Ctrl second: not the chord
    await reset(); keys.length = 0; press(SPACE, true); await sleep(80); press(CTRL, true); await sleep(150); press(CTRL, false); press(SPACE, false); await sleep(150);
    rep.steps.B = { log: await log(), keys: keys.slice() };
    // C: the chord with corrections while held
    await reset(); keys.length = 0;
    press(CTRL, true); await sleep(60); press(SPACE, true); await sleep(60); press(SPACE, true); await sleep(150);   // second Space down = auto-repeat
    rep.steps.C0 = { keysAfterChord: keys.slice() };
    typer.type('hello world foo', opts); await sleep(250);
    rep.steps.C1 = { typed: await val() };
    typer.backspace(2, opts); await sleep(250);
    rep.steps.C2 = { afterBackspace2: await val() };
    typer.type('X', opts); await sleep(250);
    rep.steps.C3 = { final: await val() };
    press(SPACE, false); await sleep(80); press(CTRL, false); await sleep(250);
    rep.steps.C4 = { keys: keys.slice(), log: await log() };
    // D: the control experiment, the release switched off: the same correction is a word-delete
    await reset(); typer.raw('NORELEASE 1'); keys.length = 0;
    press(CTRL, true); await sleep(60); press(SPACE, true); await sleep(150);
    typer.type('aa bb cc', opts); await sleep(250); typer.backspace(2, opts); await sleep(250);
    rep.steps.D = { afterBackspace2_noRelease: await val() };
    press(SPACE, false); await sleep(80); press(CTRL, false); await sleep(200);
    // E: afterwards Ctrl is not stuck: a plain key reaches the page with ctrlKey false
    typer.raw('NORELEASE 0'); await reset(); typer.type('ok', opts); await sleep(200);
    rep.steps.E = { value: await val() };
    const img = await win.webContents.capturePage(); fs.writeFileSync(process.env.PF_SHOT, img.toPNG());
  } catch (e) { rep.error = String(e.stack || e); }
  try { if (typer) { typer.raw('NORELEASE 0'); typer.press(SPACE, false); typer.press(CTRL, false); await sleep(150); typer.close(); } } catch (_) { /* gone */ }
  fs.writeFileSync(process.env.PF_REPORT, JSON.stringify(rep, null, 1));
  app.exit(0);
});
