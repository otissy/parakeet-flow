'use strict';
/* The real Electron app with the real voice (muted): the hotkey event reads a (faked) selection through the worker and the speaker window,
   Esc and the same hotkey stop it, a dictation in progress blocks it and starting one stops it. Scratch user-data folder, models folder that
   holds only the voice, no login item, windows off-screen, hotkeys moved to safe keys. Needs the unpacked pack: PF_TTS_PACK_DIR. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..', '..');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const PACK = process.env.PF_TTS_PACK_DIR || 'C:/builds/parakeet-flow/_ttsmodel/x3/kokoro-multi-lang-v1_0';
const skip = fs.existsSync(path.join(PACK, 'model.onnx')) && fs.existsSync(electron) ? false : 'no unpacked Kokoro pack or no electron (set PF_TTS_PACK_DIR)';

test('read aloud end to end inside the real app', { skip, timeout: 240000 }, () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ra-e2e-'));
  const models = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ra-models-'));
  fs.mkdirSync(path.join(models, 'tts'), { recursive: true });
  const link = path.join(models, 'tts', 'kokoro-multi-lang-v1_0');
  fs.symlinkSync(path.resolve(PACK), link, 'junction');                      // a link to the unpacked pack: no 380 MB copy
  const report = path.join(userData, 'report.json');
  const { seedSafeKeys } = require('../features-e2e/safe-keys');
  seedSafeKeys(userData);
  const f = path.join(userData, 'settings.json');
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.writeFileSync(f, JSON.stringify({ ...s, readAloud: { enabled: true, hotkey: { vks: [0x11, 0x12, 0x7F], label: 'Ctrl+Alt+F16' }, voice: 'bm_george', speed: 1.25 } }));
  const env = { ...process.env, PF_USERDATA: userData, PF_MODELS: models, PF_OFFSCREEN: '1', PF_NO_LOGIN_ITEM: '1', PF_MUTE_AUDIO: '1', PF_TEST_HOOK: path.join(__dirname, 'e2e-hook.js'), PF_REPORT: report };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const r = spawnSync(electron, [root], { env, encoding: 'utf8', timeout: 220000 });
    assert.ok(fs.existsSync(report), 'hook wrote a report: ' + (r.stderr || '').slice(0, 400));
    const rep = JSON.parse(fs.readFileSync(report, 'utf8'));
    assert.deepEqual(rep.errors, []);
    assert.equal(rep.done, true);
    assert.equal(rep.enabled, true);
    assert.deepEqual(rep.chord, [0x11, 0x12, 0x7F]);
    // 1. the helper's READ event reads the selection: preparing -> reading -> idle, audio really played by the speaker page
    assert.equal(rep.copies1, 1);
    assert.ok(rep.states1[0] === 'preparing' && rep.states1.some((x) => x === 'reading') && rep.states1.at(-1) === 'idle', 'states ' + rep.states1);
    assert.ok(rep.pills1.some((p) => /^reading:Reading/.test(p)), 'the flow bar says Reading: ' + rep.pills1);
    assert.equal(rep.pills1.at(-1).split(':')[0], 'idle');
    assert.ok(rep.sentSec1 > 3, 'seconds of audio made: ' + rep.sentSec1);
    assert.ok(rep.playedSec1 > rep.sentSec1 * 0.8, `the speaker page played it (${rep.playedSec1} of ${rep.sentSec1} s)`);
    // 2. Esc stops it at once and nothing more is made
    assert.equal(rep.reachedReading, true);
    assert.equal(rep.stateAfterEsc, 'idle'); assert.ok(rep.stopMs < 300, 'stopped in ' + rep.stopMs + ' ms');
    assert.equal(rep.grewAfterStop, false, 'no audio is made after the stop');
    assert.ok(rep.states2.includes('idle'));
    // 3. the same hotkey stops it
    assert.equal(rep.stateAfterSecondPress, 'idle');
    // 4. busy: dictating blocks it, no selection is copied
    assert.ok(rep.busyStates.some((x) => x === 'error:Finish dictating first'), 'busy: ' + rep.busyStates);
    assert.equal(rep.busyCopies, 0);
    // 5. a dictation starting stops a reading
    assert.equal(rep.stateAfterDictationStart, 'idle');
    // 6. nothing selected says so
    assert.ok(rep.noneStates.some((x) => /Nothing selected/.test(x)), 'none: ' + rep.noneStates);
  } finally {
    try { fs.unlinkSync(link); } catch (_) { /* junction already gone */ }
    fs.rmSync(userData, { recursive: true, force: true });
    if (!fs.existsSync(link)) fs.rmSync(models, { recursive: true, force: true });      // never delete through a link that is still there
  }
});
