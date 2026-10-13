'use strict';
/* ONE short real typing test: the Win32 helper types a line break (Shift+Enter) and deletes it again, into a window THIS
   script creates (a textarea), nothing else. run: electron .tests/features-e2e/real-newline.js   (visible for ~4 s, manual, not in the ladder) */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { Win32Typer } = require(path.join(root, 'src/typer/win32-typer.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const rep = {};
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-real-nl-'));
    const win = new BrowserWindow({ width: 640, height: 220, title: 'parakeet-flow newline test', alwaysOnTop: true, webPreferences: { sandbox: true } });
    await win.loadURL('data:text/html,<body style="margin:0;background:%23141417"><textarea id=t autofocus style="width:100%25;height:100%25;font:22px Segoe UI;background:%23141417;color:%23eee;border:0;padding:16px;box-sizing:border-box"></textarea></body>');
    win.show(); win.focus(); win.webContents.focus();
    const typer = new Win32Typer({ binDir: path.join(dir, 'bin'), test: true });
    await typer.ready;
    const hwnd = win.getNativeWindowHandle().readUInt32LE(0);
    for (let i = 0; i < 60; i++) { typer.queryForeground(); await sleep(80); if (typer.foreground() && typer.foreground().hwnd === hwnd) break; }
    if (!(typer.foreground() && typer.foreground().hwnd === hwnd)) throw new Error('test window never became the foreground window');
    const read = () => win.webContents.executeJavaScript('document.getElementById("t").value');
    typer.type('Dear Anna,', { hwnd }); await sleep(250);
    typer.type('\n\n', { hwnd }); await sleep(250);          // "new paragraph"
    typer.type('Thanks for the report.', { hwnd }); await sleep(300);
    rep.afterType = await read();
    typer.backspace(22, { hwnd }); await sleep(300);          // "delete that" over the last segment
    typer.backspace(1, { hwnd }); await sleep(300);           // "undo that" of one line break
    rep.afterDelete = await read();
    typer.type('é\u{1F99C}\n', { hwnd }); await sleep(300);   // unicode and a line break after it
    rep.afterUnicode = await read();
    const img = await win.webContents.capturePage(); fs.writeFileSync(process.env.PF_SHOT, img.toPNG());
    typer.close();
  } catch (e) { rep.error = String(e.stack || e); }
  fs.writeFileSync(process.env.PF_REPORT, JSON.stringify(rep, null, 1));
  app.exit(0);
});
