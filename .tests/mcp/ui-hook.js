'use strict';
/* Runs INSIDE the real Electron app (PF_TEST_HOOK), off-screen: captures the Notes page and the new Settings sections at true window size.
   The notes shown were really written through the MCP server (run-ui-proof.js). Typing is replaced by an in-memory typer. */
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = ({ app, get }) => {
  (async () => {
    const g = get();
    const out = process.env.PF_PROOF_DIR; fs.mkdirSync(out, { recursive: true });
    const rep = { errors: [], shots: {} };
    try {
      await sleep(2500);
      const wc = g.mainWin.webContents;
      const send = (t) => wc.send('test:set', t);
      g.mainWin.setContentSize(1000, 1100);                         // tall enough that a whole section shows
      await sleep(400);
      const shot = async (name) => {
        await sleep(500);
        const img = await wc.capturePage(); fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
        const s = img.getSize(); rep.shots[name] = { w: s.width, h: s.height };
      };
      g.store.set({ historyEnabled: true, mcp: { shareHistory: true } });
      wc.send('settings:changed', g.store.get());
      send({ page: 'notes' }); await shot('ui-notes');
      send({ page: 'settings' }); await sleep(300);
      for (const id of ['sec-routing', 'sec-mcp', 'sec-export', 'sec-typing']) { send({ page: 'settings', scrollTo: '#' + id }); await shot('ui-settings-' + id.slice(4)); }
      rep.settings = { noteHotkey: g.store.get().notes.noteHotkey, typing: g.store.get().typing, mcp: g.store.get().mcp };
    } catch (e) { rep.errors.push(String(e.stack || e)); }
    fs.writeFileSync(process.env.PF_REPORT, JSON.stringify(rep, null, 1));
    app.exit(0);
  })();
};
