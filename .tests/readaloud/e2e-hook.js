'use strict';
/* Runs INSIDE the real Electron app (PF_TEST_HOOK): the real helper, speaker window, TTS worker and Kokoro voice, muted. Only the selection is faked
   (no key is ever pressed in another app): copySelection returns fixed text. Writes a JSON report to PF_REPORT. */
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = ({ get }) => {
  (async () => {
    const rep = { errors: [], steps: [] };
    const mark = (m) => { rep.step = m; fs.writeFileSync(process.env.PF_REPORT, JSON.stringify(rep, null, 1)); };
    try {
      const g = get();
      const ra = g.readAloud;
      rep.hasRuntime = !!ra;
      const states = [], pills = [];
      ra.service.on('state', (s) => states.push(s.state + (s.note ? ':' + s.note : '')));
      const origSend = g.pillWin.webContents.send.bind(g.pillWin.webContents);
      g.pillWin.webContents.send = (ch, ...a) => { if (ch === 'pill:state') pills.push(a[0].state + ':' + a[0].text); return origSend(ch, ...a); };
      let copies = 0, selection = { ok: true, text: 'Hello, this is the test of reading a selection aloud. It has two sentences.' };
      g.typer.copySelection = async () => { copies++; return selection; };
      const waitIdle = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms && (ra.service.state !== 'idle' || states.length === 0)) await sleep(50); return Date.now() - t0; };

      mark('status');
      rep.enabled = g.store.get().readAloud.enabled;
      rep.chord = g.store.get().readAloud.hotkey.vks;

      mark('read via the helper event');
      g.typer.emit('read');                                      // exactly what the helper's READ line does
      rep.readMs = await waitIdle(90000);
      rep.states1 = states.slice(); rep.pills1 = pills.slice(); rep.copies1 = copies; rep.playedSec1 = ra.service.playedSec; rep.sentSec1 = ra.service.sentSec;

      mark('stop with Esc');
      states.length = 0; pills.length = 0;
      selection = { ok: true, text: Array.from({ length: 25 }, (_, i) => `Sentence number ${i} of a long text that will be stopped part of the way through.`).join(' ') };
      g.typer.emit('read');
      for (let i = 0; i < 400 && ra.service.state !== 'reading'; i++) await sleep(50);
      rep.reachedReading = ra.service.state === 'reading';
      const t0 = Date.now();
      g.typer.emit('esc');
      rep.stopMs = Date.now() - t0; rep.stateAfterEsc = ra.service.state;
      const sent = ra.service.sentSec; await sleep(1500); rep.grewAfterStop = ra.service.sentSec > sent;
      rep.states2 = states.slice(); rep.pills2 = pills.slice();

      mark('same hotkey stops');
      states.length = 0;
      g.typer.emit('read'); for (let i = 0; i < 400 && ra.service.state !== 'reading'; i++) await sleep(50);
      g.typer.emit('read'); await sleep(200);
      rep.stateAfterSecondPress = ra.service.state;

      mark('busy while dictating');
      states.length = 0; pills.length = 0;
      const copiesBefore = copies;
      g.controller.session = { fake: true };
      g.typer.emit('read'); await sleep(300);
      g.controller.session = null;
      rep.busyStates = states.slice(); rep.busyCopies = copies - copiesBefore;

      mark('dictation start stops a reading');
      selection = { ok: true, text: 'Another long reading. '.repeat(20) };
      g.typer.emit('read'); for (let i = 0; i < 400 && ra.service.state !== 'reading'; i++) await sleep(50);
      g.controller.emit('pill', { state: 'listening', text: '' });
      await sleep(100);
      rep.stateAfterDictationStart = ra.service.state;

      mark('selection failure');
      states.length = 0; selection = { ok: false, reason: 'none' };
      g.typer.emit('read'); await sleep(300);
      rep.noneStates = states.slice();
      rep.done = true;
      mark('done');
    } catch (e) { rep.errors.push(String((e && e.stack) || e)); mark('failed'); }
    setTimeout(() => require('electron').app.exit(0), 300);
  })();
};
