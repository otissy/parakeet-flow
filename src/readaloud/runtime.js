'use strict';
/* Electron side of "read aloud": the hidden speaker window (plays the audio), the voice download, the hotkey chord and the IPC the Settings page
   uses. Everything that decides anything lives in service.js / settings.js / model-store.js (all unit-tested without Electron). */
const { ReadAloud } = require('./service');
const { TtsHost } = require('./tts-host');
const store = require('./model-store');
const { VOICES } = require('./voices');
const { readChordError } = require('./settings');

const SIZE_MB = Math.round(store.PACK.bytes / 1e6);

/** deps: BrowserWindow, ipcMain, settings (the Store), modelsDir, preload, speakerFile, getMainWin, send(win, ch, ...a), pill(state obj), log, busy() -> '' | reason, getTyper(), offscreen */
function install(d) {
  const { ipcMain, settings, modelsDir, log } = d;
  let speakerWin = null, speakerLoaded = Promise.resolve(), chain = Promise.resolve(), host = null, voiceOk = false, flashTimer = null;
  const voice = { downloading: false, phase: '', pct: 0, error: '' };
  const files = () => store.paths(modelsDir);
  const refreshVoice = async () => { try { voiceOk = (await store.status(modelsDir, { quick: true })).ok; } catch (_) { voiceOk = false; } return voiceOk; };
  refreshVoice();

  const ensureSpeaker = () => {
    if (speakerWin && !speakerWin.isDestroyed()) return speakerWin;
    speakerWin = new d.BrowserWindow({ show: false, width: 100, height: 100, x: d.offscreen ? -6000 : undefined, y: d.offscreen ? 0 : undefined,
      webPreferences: { preload: d.preload, contextIsolation: true, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
    speakerLoaded = new Promise((r) => speakerWin.webContents.once('did-finish-load', r));
    speakerWin.loadFile(d.speakerFile);
    return speakerWin;
  };
  const toSpeaker = (ch, payload) => {
    const w = ensureSpeaker();
    chain = chain.then(() => speakerLoaded).then(() => { if (!w.isDestroyed()) w.webContents.send(ch, payload); }).catch(() => {});
  };
  const player = {
    chunk: (gen, samples, rate) => toSpeaker('speak:chunk', { gen, samples, rate }),
    end: (gen) => toSpeaker('speak:end', { gen }),
    stop: () => { if (speakerWin && !speakerWin.isDestroyed()) toSpeaker('speak:stop', {}); },
  };
  const getHost = () => (host ||= new TtsHost({ files: files(), numThreads: 2 }));
  const tts = { speak: (t, o) => getHost().speak(t, o), cancel: () => { if (host) host.cancel(); } };

  const service = new ReadAloud({
    getSettings: () => settings.get(), tts, player, log,
    busy: () => d.busy(), voiceReady: () => voiceOk,
    copySelection: () => { const t = d.getTyper(); return t ? t.copySelection() : Promise.resolve({ ok: false, reason: 'helper-gone' }); },
  });
  service.on('state', ({ state, note }) => {
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    if (state === 'preparing' || state === 'reading') d.pill({ state: 'reading', text: 'Reading…', note });
    else if (state === 'error') { d.pill({ state: 'error', text: note, note: '' }); flashTimer = setTimeout(() => { flashTimer = null; if (!service.active()) d.pill({ state: 'idle', text: '', note: '' }); }, 2400); }
    else d.pill({ state: 'idle', text: '', note: '' });
    d.send(d.getMainWin(), 'readaloud:changed');
  });

  const fromMain = (e) => { if (e.sender !== d.getMainWin()?.webContents) throw new Error('Read aloud action is not allowed from this page'); };
  const fromSpeaker = (e) => !!speakerWin && !speakerWin.isDestroyed() && e.sender === speakerWin.webContents;
  ipcMain.on('speak:progress', (e, p) => { if (fromSpeaker(e) && p) service.progress(Number(p.gen), Number(p.playedSec) || 0); });
  ipcMain.on('speak:finished', (e, g) => { if (fromSpeaker(e)) service.playerFinished(Number(g)); });
  ipcMain.on('speak:error', (e, m) => { if (fromSpeaker(e)) log('error', 'speaker: ' + String(m).slice(0, 120)); });

  const status = () => ({ enabled: !!settings.get().readAloud.enabled, voiceOk, sizeMB: SIZE_MB, ...voice, state: service.state, loaded: !!(host && host.loaded()), voices: VOICES.map((v) => ({ id: v.id, label: v.label })) });
  ipcMain.handle('readaloud:status', (e) => { fromMain(e); return status(); });
  ipcMain.handle('readaloud:download', async (e) => {
    fromMain(e);
    if (voice.downloading) return status();
    Object.assign(voice, { downloading: true, phase: 'download', pct: 0, error: '' });
    const note = () => d.send(d.getMainWin(), 'readaloud:progress', { ...voice });
    try {
      await store.ensure(modelsDir, { onProgress: (p) => { voice.phase = p.phase; voice.pct = Math.round(p.pct); note(); } });
      voiceOk = true; log('info', 'read-aloud voice installed');
    } catch (err) { voice.error = String(err.message || err).slice(0, 160); log('error', 'read-aloud voice download failed: ' + voice.error); }
    Object.assign(voice, { downloading: false, phase: '', pct: 0 });
    await refreshVoice();
    note(); d.send(d.getMainWin(), 'readaloud:changed');
    return status();
  });
  ipcMain.handle('readaloud:remove', async (e) => {
    fromMain(e);
    service.stop(); if (host) { host.close(); host = null; }
    store.remove(modelsDir); voiceOk = false;
    d.send(d.getMainWin(), 'readaloud:changed');
    return status();
  });
  ipcMain.handle('readaloud:sample', (e) => { fromMain(e); service.sample().catch(() => {}); return { ok: true }; });
  ipcMain.handle('readaloud:stop', (e) => { fromMain(e); return { ok: service.stop() }; });
  ipcMain.handle('readaloud:check-hotkey', (e, vks) => {
    fromMain(e);
    const s = settings.get();
    return readChordError((Array.isArray(vks) ? vks : []).map(Number), { hold: s.hotkey.vks, note: s.notes.noteHotkey.vks, toggle: s.toggleKey.vks[0] });
  });

  return {
    service,
    active: () => service.active(),
    stop: () => service.stop(),
    trigger: () => service.trigger().catch((err) => log('error', 'read aloud: ' + String(err.message || err).slice(0, 120))),
    /** the chord the helper listens for: nothing while the feature is off or while a hotkey picker is open (the keys must reach the page) */
    chord: (capturing) => { const r = settings.get().readAloud; return r.enabled && !capturing ? r.hotkey.vks : []; },
    prepare: () => { if (settings.get().readAloud.enabled) ensureSpeaker(); },       // the hidden speaker page is loaded before the first reading
    close: () => { service.stop(); if (host) host.close(); if (speakerWin && !speakerWin.isDestroyed()) speakerWin.destroy(); },
  };
}

module.exports = { install, SIZE_MB };
