'use strict';
/* Runs INSIDE the real Electron app (PF_TEST_HOOK). Off-screen windows, typing into an in-memory typer (never a real window),
   audio = synthesised speech played in real time through the real VAD + Parakeet. PF_MODE:
     commands : cmd-en.wav and cmd-nl.wav through hold-to-talk; records every on-screen state and the notes file
     notes    : real safeStorage token, real IPC, notes -> mock Notion (PF_NOTION_BASE); screenshots of Settings, Notes, the pill
   Writes PF_REPORT (json) and PNGs to PF_PROOF_DIR. */
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = ({ app, get }) => {
  (async () => {
    const g = get();
    const root = path.join(__dirname, '..', '..');
    const out = process.env.PF_PROOF_DIR; fs.mkdirSync(out, { recursive: true });
    const rep = { errors: [], shots: {}, mode: process.env.PF_MODE };
    const mark = (m) => { rep.step = m; fs.writeFileSync(process.env.PF_REPORT, JSON.stringify(rep, null, 1)); };
    const { MemoryTyper } = require(path.join(root, 'src/typer/typer.js'));
    const { WavMic } = require(path.join(root, 'src/main/mic.js'));
    const ud = app.getPath('userData');
    const shot = async (win, name, css) => {
      mark('shot ' + name);
      if (css) await win.webContents.insertCSS(css);
      await sleep(250);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
      const s = img.getSize(); const bm = img.toBitmap(); let nz = 0; for (let i = 0; i < bm.length; i += 4) if (bm[i + 3] && (bm[i] | bm[i + 1] | bm[i + 2])) nz++;
      rep.shots[name] = { w: s.width, h: s.height, litPixels: nz };
    };
    const readNotes = () => { try { return fs.readFileSync(path.join(ud, 'notes.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch (_) { return []; } };
    try {
      for (let i = 0; i < 300 && g.engine().state !== 'ready'; i++) await sleep(100);
      rep.engine = g.engine();
      if (rep.engine.state !== 'ready') throw new Error('engine not ready');
      const c = g.controller; const { fsm } = c;
      const mem = new MemoryTyper({ pid: 4242 });
      c.typer = mem;
      const states = [];
      const origType = mem.type.bind(mem), origBs = mem.backspace.bind(mem);
      mem.type = (t, o) => { const r = origType(t, o); states.push(mem.text); return r; };
      mem.backspace = (n, o) => { const r = origBs(n, o); states.push(mem.text); return r; };
      c.on('pill', (p) => { (rep.pills ||= []).push({ state: p.state, text: p.text, note: p.note }); });
      c.on('note', (n) => { (rep.notices ||= []).push(n.note); });
      const wait = async (pred, ms) => { for (let i = 0; i < ms / 50 && !pred(); i++) await sleep(50); };
      const hold = async (wav) => {
        mem.log.length = 0; states.length = 0; c.carry = null;
        c.mic = new WavMic({ file: wav });
        fsm.down(Date.now());
        await sleep(400);
        await wait(() => !c.mic.timer, 40000);
        fsm.up(Date.now());
        await wait(() => c.pillState === 'idle' && !c.session, 8000);
        await sleep(300);
        return { text: mem.text, states: states.slice(), ops: mem.log.map((o) => ({ op: o.op, n: o.n, text: o.text })) };
      };

      if (process.env.PF_MODE === 'commands') {
        g.store.set({ historyEnabled: false });
        rep.en = await hold(process.env.PF_AUDIO_EN);
        rep.enNotes = readNotes().map((n) => n.text);
        rep.nl = await hold(process.env.PF_AUDIO_NL);
        rep.allNotes = readNotes().map((n) => n.text);
      }

      if (process.env.PF_MODE === 'notes') {
        const wc = g.mainWin.webContents;
        wc.on('console-message', (_e, lvl, msg) => { if (lvl >= 2) (rep.console ||= []).push(msg.slice(0, 200)); });
        const inv = (ch, ...a) => wc.executeJavaScript(`window.pf.invoke(${JSON.stringify(ch)}${a.map((x) => ',' + JSON.stringify(x)).join('')})`);
        await Promise.race([new Promise((r) => { wc.once('did-finish-load', r); wc.reload(); }), sleep(8000)]);
        await sleep(600);
        // 1. local-only note first (Notion off)
        c.notes.save('Remind me to water the plants on Friday.');
        // 2. the token goes in through the real IPC and the real safeStorage
        const TOKEN = process.env.PF_TEST_TOKEN;
        rep.setToken = await inv('notion:set-token', TOKEN);
        rep.status = await inv('notion:status');
        g.store.set({ notes: { ...g.store.get().notes, notion: { enabled: true, targetType: 'database', targetId: '0123456789abcdef0123456789abcdef', titleProperty: 'Name' } } });
        c.notes.save('Buy oat milk on the way home.');
        await sleep(500);
        c.notes.save('Call the bank about the new card.');            // the mock fails the second request
        await sleep(500);
        c.notes.save('Bel de tandarts morgen om negen uur.');
        await sleep(600);
        rep.notesAfter = readNotes().map((n) => ({ text: n.text, sync: n.sync, attempts: n.attempts, error: n.error }));
        rep.secretsFile = fs.readFileSync(path.join(ud, 'secrets.json'), 'utf8');
        rep.settingsFile = fs.readFileSync(path.join(ud, 'settings.json'), 'utf8');
        try { rep.logFile = fs.readFileSync(path.join(ud, 'logs', 'app.log'), 'utf8'); } catch (_) { rep.logFile = ''; }
        // Resend on the failed one: the mock accepts from now on
        const sendEarly = (t) => g.mainWin.webContents.send('test:set', t);
        g.mainWin.webContents.send('settings:changed', g.store.get());
        sendEarly({ page: 'notes' }); await sleep(600); await shot(g.mainWin, 'notes-page-failed');
        const failed = readNotes().find((n) => n.sync === 'failed');
        rep.failedBefore = failed && failed.text;
        if (failed) { await inv('notes:resend', failed.id); await sleep(500); }
        rep.afterResend = readNotes().map((n) => ({ text: n.text, sync: n.sync }));
        // 3. screenshots at true size (1000x680 window)
        g.store.set({ whisper: { enabled: true, gain: 3, vadThreshold: 0.3 }, translate: { enabled: true, target: 'swap' } });
        c.applySettings();
        const send = (t) => g.mainWin.webContents.send('test:set', t);
        g.mainWin.webContents.send('settings:changed', g.store.get());
        // make the failed note fail again so the Notes page shows a retry state
        await sleep(300);
        send({ page: 'notes' }); await sleep(500); await shot(g.mainWin, 'notes-page');
        for (const [id, name] of [['#sec-commands', 'settings-commands'], ['#sec-tone', 'settings-tone'], ['#sec-translate', 'settings-translate'], ['#sec-cleanup', 'settings-cleanup'], ['#sec-notes', 'settings-notes']]) {
          send({ page: 'settings', scrollTo: id }); await sleep(500); await shot(g.mainWin, name);
        }
        send({ page: 'settings', scrollTo: '#nn-token', center: true }); await sleep(500); await shot(g.mainWin, 'settings-notes-token');
        rep.mainSize = g.mainWin.getContentSize();
        const BACKDROP = 'html{background:linear-gradient(135deg,#2f3347,#3d4260) !important}';
        c._pill('idle'); await sleep(300); await shot(g.pillWin, 'pill-flags-idle', BACKDROP);
        c._pill('listening', { text: 'new paragraph and then the meeting notes', note: 'Tone: casual' }); await sleep(300); await shot(g.pillWin, 'pill-flags-listening', BACKDROP);
        c._pill('done', { text: 'Saved note' }); await sleep(300); await shot(g.pillWin, 'pill-saved-note', BACKDROP);
        rep.pillSize = g.pillWin.getContentSize();
      }
    } catch (e) { rep.errors.push(String(e.stack || e)); }
    mark('done');
    app.exit(0);
  })();
};
