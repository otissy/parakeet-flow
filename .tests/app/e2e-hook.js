'use strict';
/* Runs INSIDE the real Electron app (PF_TEST_HOOK). Everything is off-screen, typing goes to an in-memory typer
   (never to a real window), audio is a synthesised utterance played in real time through the real
   VAD + Parakeet worker. Writes screenshots to PF_PROOF_DIR and a JSON report to PF_REPORT. */
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = ({ app, get }) => {
  (async () => {
    const g = get();
    const out = process.env.PF_PROOF_DIR; fs.mkdirSync(out, { recursive: true });
    const rep = { errors: [], shots: {}, pills: [], notes: [] };
    const root = path.join(__dirname, '..', '..');
    const { MemoryTyper } = require(path.join(root, 'src/typer/typer.js'));
    const { WavMic } = require(path.join(root, 'src/main/mic.js'));
    const mark = (m) => { rep.step = m; fs.writeFileSync(process.env.PF_REPORT, JSON.stringify(rep, null, 1)); };
    const shot = async (win, name, css) => {
      mark('shot ' + name);
      if (css) await win.webContents.insertCSS(css);
      await sleep(120);
      const img = await win.webContents.capturePage();
      const f = path.join(out, name + '.png'); fs.writeFileSync(f, img.toPNG());
      const s = img.getSize(); const bm = img.toBitmap(); let nz = 0; for (let i = 0; i < bm.length; i += 4) if (bm[i + 3] && (bm[i] | bm[i + 1] | bm[i + 2])) nz++;
      rep.shots[name] = { file: f, w: s.width, h: s.height, litPixels: nz };
    };
    try {
      mark('wait engine');
      for (let i = 0; i < 300 && g.engine().state !== 'ready'; i++) await sleep(100);
      rep.engine = g.engine();
      if (rep.engine.state !== 'ready') throw new Error('engine not ready: ' + JSON.stringify(rep.engine));

      const mem = new MemoryTyper({ pid: 4242 });
      g.controller.typer = mem;                                  // typing can never reach a real window in this run
      g.controller.mic = new WavMic({ file: process.env.PF_AUDIO });
      g.controller.on('pill', (p) => rep.pills.push(p.state));
      g.controller.on('note', (n) => rep.notes.push(n.note));
      const { fsm } = g.controller;
      const BACKDROP = 'html{background:linear-gradient(135deg,#2f3347,#3d4260) !important}';

      // demo data so Home has something to show (real Store, real render)
      const st = g.store;
      st.set({ historyEnabled: true, userName: 'Otis' });
      const day = (n, h, m) => new Date(Date.now() - n * 864e5 + (h - new Date().getHours()) * 36e5 + m * 6e4);
      [[0, 0, 1240, 520], [1, 0, 2310, 960], [2, 0, 800, 330], [3, 0, 1500, 620]].forEach(([n, , w, s]) => st.addUsage({ words: w, speechSec: s, date: day(n, 12, 0) }));
      const seed = [[1, 17, 42, 'Can you send me the report before the stand-up tomorrow? I would like to read it first.'], [1, 9, 15, 'Remind me to call the dentist on Thursday morning.'],
        [2, 20, 3, 'Ik ben er over tien minuten, begin maar zonder mij.']];
      for (const [n, h, m, t] of seed) st.addHistory(t, day(n, h, m));

      mark('reload');
      const wc = g.mainWin.webContents;
      wc.on('did-fail-load', (_e, code, desc) => rep.notes.push('fail-load ' + code + ' ' + desc));
      wc.on('render-process-gone', (_e, d) => rep.notes.push('gone ' + d.reason));
      wc.on('console-message', (_e, lvl, msg) => { if (lvl >= 2) rep.notes.push('console: ' + msg.slice(0, 200)); });
      rep.loading = wc.isLoading(); rep.visible = g.mainWin.isVisible(); rep.bounds = g.mainWin.getBounds();
      mark('reload2');
      await Promise.race([new Promise((r) => { wc.once('did-finish-load', r); wc.reload(); }), sleep(8000)]);
      await sleep(600);
      await shot(g.pillWin, 'pill-idle', BACKDROP);

      // 1. hold-to-talk with live partials
      const t0 = Date.now();
      fsm.down(t0);
      await sleep(1700); await shot(g.pillWin, 'pill-listening-partial');
      rep.typedWhileTalking = mem.text;
      await sleep(3300); await shot(g.pillWin, 'pill-listening-later');
      const wait = async (pred, ms) => { for (let i = 0; i < ms / 50 && !pred(); i++) await sleep(50); };
      await wait(() => !g.controller.mic.timer, 12000);          // audio finished
      fsm.up(Date.now());
      await sleep(30); await shot(g.pillWin, 'pill-processing');
      await wait(() => rep.pills.includes('done'), 5000);
      await shot(g.pillWin, 'pill-done');
      rep.finalText = mem.text;
      await wait(() => g.controller.pillState === 'idle', 3000);
      rep.states1 = rep.pills.slice();

      // 2. hands-free (CapsLock toggle), then stop with the next press
      mem.log.length = 0; rep.pills.length = 0;
      const m2 = new WavMic({ file: process.env.PF_AUDIO }); g.controller.mic = m2;
      fsm.toggle();
      await sleep(2000); await shot(g.pillWin, 'pill-handsfree');
      rep.handsFreeState = g.controller.pillState;
      // simulate the mouse moving over the stop button (click-through toggles off) and clicking it
      fsm.toggle();
      await wait(() => rep.pills.includes('done') || g.controller.pillState === 'idle', 6000);
      rep.states2 = rep.pills.slice(); rep.handsFreeText = mem.text;

      // 3. Esc cancels
      mem.log.length = 0; rep.pills.length = 0;
      g.controller.mic = new WavMic({ file: process.env.PF_AUDIO });
      fsm.down(Date.now()); await sleep(1900);
      rep.beforeEsc = mem.text; fsm.esc(); await sleep(300);
      rep.afterEsc = mem.text; rep.states3 = rep.pills.slice();

      // 4. main window pages at true size
      const send = (t) => g.mainWin.webContents.send('test:set', t);
      await sleep(500);
      for (const p of ['home', 'dictionary', 'snippets', 'style', 'settings']) {
        if (p === 'dictionary') st.set({ dictionary: [{ from: 'parakeet flow', to: 'Parakeet Flow' }, { from: 'kubernetes', to: 'Kubernetes' }, { from: 'o tis', to: 'Otis' }] });
        if (p === 'snippets') st.set({ snippets: [{ trigger: 'my email', expansion: 'otis.blees@gmail.com' }, { trigger: 'sign off', expansion: 'Kind regards, Otis' }] });
        g.mainWin.webContents.send('settings:changed', st.get());
        send({ page: p });
        await sleep(450);
        await shot(g.mainWin, 'main-' + p);
      }
      rep.mainSize = g.mainWin.getContentSize();
      rep.summary = st.summary();
    } catch (e) { rep.errors.push(String(e.stack || e)); }
    fs.writeFileSync(process.env.PF_REPORT, JSON.stringify(rep, null, 1));
    app.exit(0);
  })();
};
