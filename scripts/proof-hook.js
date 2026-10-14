'use strict';
/* PF_TEST_HOOK for the install proof (scripts/prove-install.js): runs inside the INSTALLED app on its first run.
   Windows are off-screen (PF_OFFSCREEN). Waits for the engine, then writes true-size screenshots of the main window
   and the pill to PF_PROOF_DIR and a small JSON report to DIAG_OUT, then exits. Nothing is typed anywhere. */
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = ({ app, get }) => {
  (async () => {
    const rep = { errors: [], shots: {} };
    const out = process.env.PF_PROOF_DIR;
    try {
      fs.mkdirSync(out, { recursive: true });
      const g = get();
      g.typer.setHotkey([0x7e]);   // F15: this proof run never claims Ctrl+Space system-wide
      const t0 = Date.now();
      for (let i = 0; i < 300 && !['ready', 'error', 'missing'].includes(g.engine().state); i++) await sleep(100);
      Object.assign(rep, { version: app.getVersion(), exe: process.execPath, appPath: app.getAppPath(), userData: app.getPath('userData'), engine: g.engine(), argv: process.argv.slice(1) });
      const shot = async (win, name) => {
        await sleep(500);
        const img = await win.webContents.capturePage();
        const s = img.getSize();
        fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
        rep.shots[name] = { w: s.width, h: s.height };
      };
      await shot(g.mainWin, 'installed-main-home');
      g.mainWin.webContents.send('test:set', { page: 'settings' });
      await shot(g.mainWin, 'installed-main-settings');
      await shot(g.pillWin, 'installed-pill');
      await sleep(Math.max(0, 7000 - (Date.now() - t0)));
      rep.aliveSeconds = Math.round((Date.now() - t0) / 1000);
    } catch (e) { rep.errors.push(String(e.stack || e)); }
    fs.writeFileSync(process.env.DIAG_OUT, JSON.stringify(rep, null, 1));
    app.exit(0);
  })();
};
