'use strict';
/* MANUAL real-keys test (not in the ladder): the real helper + SendInput + the real keyboard hook, into ONE window this script
   creates. Every injection is refused unless that window is the foreground window. Visible for ~5 s.
   The caps state is read back with GetKeyState(VK_CAPITAL) through a tiny exe compiled from source here, before and after.
   Steps: A) toggle key claimed: CapsLock presses are swallowed (page sees nothing, state unchanged, one toggle event each);
          B) control, claim off: the same press reaches the page and flips the state (proves the reader and the injection work), then restored;
          C) claim on, helper killed hard, a press from a second helper: the key is normal again (the hook died with the process), restored.
   run: PF_REPORT=<json> PF_SHOT=<png> electron .tests/capslock/real-capslock.js */
const { app, BrowserWindow } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { Win32Typer } = require(path.join(root, 'src/typer/win32-typer.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CAPS = 0x14;
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

app.whenReady().then(async () => {
  const rep = { steps: {} };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-realcaps-'));
  let typer, typer2; let hwnd = 0;
  let initial = null;
  const reader = path.join(dir, 'capsstate.exe');
  try {
    fs.writeFileSync(path.join(dir, 'capsstate.cs'), 'using System;using System.Runtime.InteropServices;static class P{[DllImport("user32.dll")]static extern short GetKeyState(int v);static void Main(){Console.WriteLine(GetKeyState(0x14)&1);}}');
    const b = spawnSync(CSC, ['/nologo', '/out:' + reader, path.join(dir, 'capsstate.cs')], { encoding: 'utf8' });
    if (b.status !== 0) throw new Error('reader build failed ' + b.stdout);
    const caps = () => +spawnSync(reader, [], { encoding: 'utf8' }).stdout.trim();
    initial = caps(); rep.initialCapsState = initial;
    const html = '<body style="margin:0;background:#141417;color:#ddd;font:16px Consolas"><textarea id=t autofocus style="width:100%;height:60px;font:22px Segoe UI;background:#1b1b20;color:#eee;border:0;padding:12px;box-sizing:border-box"></textarea>'
      + '<pre id=log style="margin:8px 12px;white-space:pre-wrap"></pre><script>window.L=[];for(const ty of ["keydown","keyup"])addEventListener(ty,e=>{L.push((ty=="keydown"?"d:":"u:")+e.key+":caps="+(e.getModifierState("CapsLock")?1:0));document.getElementById("log").textContent=L.join("  ")},true)</script>';
    const win = new BrowserWindow({ width: 760, height: 260, title: 'parakeet-flow CapsLock test', alwaysOnTop: true, webPreferences: { sandbox: true } });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.show(); win.focus(); win.webContents.focus();
    typer = new Win32Typer({ binDir: path.join(dir, 'bin'), test: true }); await typer.ready;
    hwnd = win.getNativeWindowHandle().readUInt32LE(0);
    for (let i = 0; i < 80; i++) { typer.queryForeground(); await sleep(80); if (typer.foreground() && typer.foreground().hwnd === hwnd) break; }
    if (!(typer.foreground() && typer.foreground().hwnd === hwnd)) throw new Error('test window never became foreground; nothing was pressed');
    let toggles = 0; typer.on('toggle', () => { toggles++; }); typer.on('line', () => {});
    const log = () => win.webContents.executeJavaScript('window.L.slice()');
    const reset = () => win.webContents.executeJavaScript('window.L.length=0;document.getElementById("t").focus()');
    const tap = async (t) => { t.press(CAPS, true, hwnd); await sleep(60); t.press(CAPS, false, hwnd); await sleep(200); };

    // A: claimed
    typer.setHotkey([0x11, 0x20]); typer.setClaim(true); typer.setToggleKey(CAPS); await sleep(150); await reset();
    for (let i = 0; i < 3; i++) await tap(typer);
    rep.steps.A = { capsAfter: caps(), toggleEvents: toggles, pageSaw: await log() };
    // B: control, claim off
    typer.setToggleKey(0); await sleep(150); await reset(); toggles = 0;
    await tap(typer);
    rep.steps.B = { capsAfterOnePress: caps(), toggleEvents: toggles, pageSaw: await log() };
    await tap(typer);                                                   // restore
    rep.steps.B.capsAfterRestore = caps();
    // C: claimed, then the helper dies hard
    typer.setToggleKey(CAPS); await sleep(150); await reset(); await tap(typer);
    rep.steps.C1 = { capsWhileClaimed: caps(), pageSaw: await log() };
    const pid = typer.proc.pid; spawnSync('taskkill', ['/F', '/PID', String(pid)]); await sleep(400);
    typer2 = new Win32Typer({ binDir: path.join(dir, 'bin'), test: true }); await typer2.ready; typer2.on('line', () => {});
    await reset(); await tap(typer2);
    rep.steps.C2 = { capsAfterPressWithOldHelperDead: caps(), pageSaw: await log() };
    await tap(typer2);                                                  // restore
    rep.steps.C2.capsAfterRestore = caps();
    const img = await win.webContents.capturePage(); fs.writeFileSync(process.env.PF_SHOT, img.toPNG());
  } catch (e) { rep.error = String(e.stack || e); }
  try { if (typer) typer.close(); if (typer2) typer2.close(); } catch (_) { /* gone */ }
  rep.finalCapsState = null;
  try { rep.finalCapsState = +spawnSync(reader, [], { encoding: 'utf8' }).stdout.trim(); } catch (_) { /* no reader */ }
  rep.unchanged = rep.finalCapsState === initial;
  fs.writeFileSync(process.env.PF_REPORT, JSON.stringify(rep, null, 1));
  app.exit(0);
});
