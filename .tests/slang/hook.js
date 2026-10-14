'use strict';
/* Runs INSIDE the real Electron app (PF_TEST_HOOK). Off-screen windows, an in-memory typer (never a real window), user data in a temp folder.
   PF_MODE=ui       drives the Dictionary page with real clicks, real IPC and real files; screenshots at the window's real size
   PF_MODE=dictate  the slang fixtures (Kokoro speech) through the real VAD + Parakeet, once with the packs off and once on
   Writes PF_REPORT (json) and PNGs to PF_PROOF_DIR. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = ({ app, get }) => {
  (async () => {
    const g = get();
    const root = path.join(__dirname, '..', '..');
    const out = process.env.PF_PROOF_DIR; fs.mkdirSync(out, { recursive: true });
    const rep = { errors: [], shots: {}, mode: process.env.PF_MODE };
    const mark = (m) => { rep.step = m; fs.writeFileSync(process.env.PF_REPORT, JSON.stringify(rep, null, 1)); };
    const ud = app.getPath('userData');
    const packsDir = path.join(ud, 'dictionary', 'packs');
    const wc = g.mainWin.webContents;
    const js = (s) => wc.executeJavaScript(s);
    const shot = async (name) => {
      mark('shot ' + name); await sleep(350);
      const img = await g.mainWin.webContents.capturePage();
      fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
      const s = img.getSize(); const bm = img.toBitmap(); let nz = 0; for (let i = 0; i < bm.length; i += 4) if (bm[i + 3] && (bm[i] | bm[i + 1] | bm[i + 2])) nz++;
      rep.shots[name] = { w: s.width, h: s.height, litPixels: nz };
    };
    try {
      for (let i = 0; i < 300 && g.engine().state !== 'ready'; i++) await sleep(100);
      rep.engine = g.engine();
      if (process.env.PF_MODE === 'ui') {
        wc.on('console-message', (_e, lvl, msg) => { if (lvl >= 2) (rep.console ||= []).push(msg.slice(0, 200)); });
        for (let i = 0; i < 100 && !(await js("typeof SL !== 'undefined' && !!SL.state && !!S.settings")); i++) await sleep(100);
        const { dialog } = require('electron');
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-slang-ui-'));
        const q = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e; })()`);
        const click = async (sel) => { const ok = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`); if (!ok) throw new Error('no element ' + sel); await sleep(450); };
        const setVal = async (sel, v, ev = 'input') => { const ok = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event(${JSON.stringify(ev)}, { bubbles: true })); return true; })()`); if (!ok) throw new Error('no element ' + sel); await sleep(450); };
        const text = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText : null; })()`);
        const scrollTo = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) document.querySelector('#main').scrollTop = e.offsetTop - 14; })()`);
        await js("S.page = 'dictionary'; S.settings.dictionary = [{ from: 'parakeet flow', to: 'Parakeet Flow' }, { from: 'o tis', to: 'Otis' }]; render();");
        g.store.set({ dictionary: [{ from: 'parakeet flow', to: 'Parakeet Flow' }, { from: 'o tis', to: 'Otis' }] });
        await js("window.pf.invoke('settings:get').then((s) => { S.settings = s; render(); })"); await sleep(400);
        rep.initialState = await js("window.pf.invoke('slang:state')");
        rep.packRows = await js("document.querySelectorAll('[id^=sl-pk-]').length");
        await shot('slang-1-dictionary-top');
        await scrollTo('#sec-slang'); await shot('slang-2-packs');

        // 1. switch a pack off and on again: the setting is saved and the page follows
        await click('#sl-pk-starter-nl');
        rep.afterToggleOff = g.store.get().slang.packs;
        rep.nlSwitch = await js("document.querySelector('#sl-pk-starter-nl').getAttribute('aria-checked')");
        await click('#sl-pk-starter-nl');
        rep.afterToggleOn = g.store.get().slang.packs;

        // 2. browse a pack's terms and search
        await click('[data-sl-view="starter-en"]');
        rep.viewRows = await js("document.querySelectorAll('#sl-view .trow').length");
        await setVal('#sl-q', 'ceiling');
        rep.searchRows = await js("Array.from(document.querySelectorAll('#sl-view .trow')).map((r) => r.querySelector('b').innerText)");
        await scrollTo('#sl-view'); await shot('slang-3-terms');
        await click('[data-sl-view="starter-en"]');

        // 3. add a term in one step
        await setVal('#sl-add-term', 'Zorgle'); await setVal('#sl-add-var', 'zorg | zorgel');
        await click('#sl-add-go');
        rep.mineFileAfterAdd = JSON.parse(fs.readFileSync(path.join(packsDir, 'mine.json'), 'utf8'));
        rep.mineCountText = await text('#main .note');
        // the Try it box uses the new term at once
        await setVal('#sl-try', 'so the zorgel said no kap and riz and a gee gee');
        rep.tryOut = await text('#sl-try-out');
        // 4. edit and delete it
        await click('#sl-mine-view');
        await click('[data-sl-edit="Zorgle"]');
        await setVal('#sl-ed-term', 'Zorgle2'); await setVal('#sl-ed-var', 'zorg | zorgel | zorgul');
        await click('#sl-ed-save');
        rep.mineAfterEdit = JSON.parse(fs.readFileSync(path.join(packsDir, 'mine.json'), 'utf8')).terms;
        await click('[data-sl-del="Zorgle2"]');
        rep.mineAfterDelete = JSON.parse(fs.readFileSync(path.join(packsDir, 'mine.json'), 'utf8')).terms;

        // 5. import: paste a plain list (what an Urban Dictionary word list looks like), see the preview, import as a new pack
        const pasted = 'rizzler\nsigma\nno cap,no kap|no cab\n"fanum tax",fanum tacks\nbussin\nGyatt,gyat|jayet\nglazing\nlooksmaxxing\nrizz\n';
        await click('#sl-imp-open');
        await setVal('#sl-imp-text', pasted);
        rep.previewText = await text('#sl-import');
        await setVal('#sl-imp-name', 'My pasted list');
        await scrollTo('#sl-import'); await shot('slang-4-import-dialog');
        await click('#sl-imp-go');
        rep.afterImportFiles = fs.readdirSync(packsDir);
        rep.importResultText = await text('#sl-import');
        // import a file through the open dialog (a CSV with a header, quotes and a hostile name)
        const csv = path.join(tmp, '..\\..\\evil name.csv');
        const real = path.join(tmp, 'evil name.csv');
        fs.writeFileSync(real, 'term,variants,category\r\n"no cap, fr",no kap fr,slang\r\nflibbertigibbet,flibber ti gibbet,test\r\n');
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [real] });
        await setVal('#sl-imp-name', ''); await click('#sl-imp-file');
        rep.afterFileImport = fs.readdirSync(packsDir);
        void csv;
        // export a pack through the save dialog
        const saved = path.join(tmp, 'exported.csv');
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: saved });
        await click('#sl-imp-close');
        await click('[data-sl-export="my-pasted-list"]');
        rep.exportedHead = fs.existsSync(saved) ? fs.readFileSync(saved, 'utf8').slice(0, 200) : null;
        rep.exportedIsJson = rep.exportedHead && rep.exportedHead.trim().startsWith('{');
        // delete a user pack (confirm() answered yes), the built-in packs have no delete button
        rep.builtinDeleteButtons = await js("document.querySelectorAll('[data-sl-delpack=\"starter-en\"]').length");
        await js('window.confirm = () => true');
        await click('[data-sl-delpack="evil-name"]');
        rep.afterDeletePack = fs.readdirSync(packsDir);
        // 6. master switch
        await click('#sl-all');
        rep.masterOff = g.store.get().slang.enabled;
        rep.tryOffText = await text('#sl-try-out');
        await click('#sl-all');
        rep.masterOn = g.store.get().slang.enabled;
        // 7. the proof screenshots: packs with the imported pack, an example before and after
        await setVal('#sl-try', 'no kap that was bussin, he got the goaded ceiling shot and the flip reset. gee gee riz');
        await scrollTo('#sec-slang'); await shot('slang-5-packs-after-import');
        await scrollTo('#sl-try'); await js("document.querySelector('#main').scrollTop = document.querySelector('#main').scrollHeight");
        await shot('slang-6-try-it');
        rep.mainSize = g.mainWin.getContentSize();
        rep.settingsFile = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).slang;
        rep.packFiles = fs.readdirSync(packsDir);
      }

      if (process.env.PF_MODE === 'dictate') {
        const { MemoryTyper } = require(path.join(root, 'src/typer/typer.js'));
        const { WavMic } = require(path.join(root, 'src/main/mic.js'));
        const c = g.controller; const { fsm } = c;
        const mem = new MemoryTyper({ pid: 4242 });
        c.typer = mem;
        const wait = async (pred, ms) => { for (let i = 0; i < ms / 50 && !pred(); i++) await sleep(50); };
        const hold = async (wav) => {
          mem.log.length = 0; c.carry = null;
          c.mic = new WavMic({ file: wav });
          fsm.down(Date.now());
          await sleep(400);
          await wait(() => !c.mic.timer, 40000);
          fsm.up(Date.now());
          await wait(() => c.pillState === 'idle' && !c.session, 8000);
          await sleep(300);
          return mem.text;
        };
        g.store.set({ historyEnabled: false, commands: { ...g.store.get().commands, enabled: false }, notes: { ...g.store.get().notes, enabled: false }, tone: { enabled: false, apps: [] } });
        rep.results = {};
        for (const mode of ['off', 'on']) {
          g.store.set({ slang: { enabled: mode === 'on', packs: {} } });
          rep.results[mode] = {};
          for (const n of [1, 2, 3, 4]) rep.results[mode]['slang-' + n] = await hold(path.join(process.env.PF_FIXTURES, 'slang-' + n + '.wav'));
        }
      }
    } catch (e) { rep.errors.push(String(e.stack || e)); }
    mark('done');
    app.exit(0);
  })();
};
