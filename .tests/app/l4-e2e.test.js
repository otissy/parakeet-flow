'use strict';
/* The real Electron app: real tray/windows/worker/VAD/Parakeet, synthesised mic, off-screen windows, in-memory typer. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..', '..');
const U = require('../asr/util');

const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const ok = U.modelsPresent() && U.ensureFixtures() && fs.existsSync(electron);
const skip = ok ? false : 'electron, models or fixtures missing (UNVERIFIED)';
const proof = process.env.PF_PROOF_DIR || path.join(root, '..', 'pf-proof');

test('app boots, dictates a pause utterance, hands-free, Esc, and renders every page', { skip, timeout: 240000 }, () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-'));
  const report = path.join(userData, 'report.json');
  const env = { ...process.env, PF_USERDATA: userData, PF_MODELS: path.join(process.env.APPDATA, 'parakeet-flow', 'models'),
    PF_AUDIO: path.join(U.FIX, 'en-pause.wav'), PF_FAKE_MIC: path.join(U.FIX, 'en-pause.wav'), PF_OFFSCREEN: '1', PF_NO_LOGIN_ITEM: '1',
    PF_TEST_HOOK: path.join(__dirname, 'e2e-hook.js'), PF_PROOF_DIR: proof, PF_REPORT: report };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [root], { env, encoding: 'utf8', timeout: 220000 });
  assert.ok(fs.existsSync(report), 'hook wrote a report: ' + (r.stderr || '').slice(0, 400));
  const rep = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.deepEqual(rep.errors, []);
  assert.equal(rep.engine.state, 'ready');

  // 0. Wispr style is the default: nothing typed while talking, ONE insertion on release, no Backspace
  assert.equal(rep.wisprTypedWhileTalking, '', 'nothing typed while the key is held');
  assert.equal(rep.wisprInsertions, 1); assert.equal(rep.wisprBackspaces, 0);
  assert.match(rep.wisprFinal.toLowerCase(), /meeting/); assert.match(rep.wisprFinal.toLowerCase(), /reports/);
  // 1. hold to talk (the opt-in live mode)
  const order = (arr, ...seq) => { let i = -1; return seq.every((s) => (i = arr.indexOf(s, i + 1)) >= 0); };
  assert.ok(order(rep.states1, 'listening', 'processing', 'done', 'idle'), 'pill states: ' + rep.states1);
  assert.ok(rep.typedWhileTalking.length > 10, 'words were typed while still talking: ' + rep.typedWhileTalking.length);
  assert.match(rep.finalText.toLowerCase(), /meeting/); assert.match(rep.finalText.toLowerCase(), /reports/);
  // 2. hands-free
  assert.equal(rep.handsFreeState, 'handsfree');
  assert.ok(order(rep.states2, 'handsfree', 'processing', 'done'), 'hands-free states: ' + rep.states2);
  assert.match(rep.handsFreeText.toLowerCase(), /meeting/);
  // 3. Esc
  assert.ok(rep.beforeEsc.length > 5); assert.equal(rep.afterEsc, ''); assert.ok(rep.states3.includes('cancelled'));
  // 4. screenshots exist, are real size, and are not blank
  for (const n of ['pill-idle', 'pill-listening-partial', 'pill-handsfree', 'pill-processing', 'pill-done', 'main-home', 'main-dictionary', 'main-snippets', 'main-style', 'main-settings']) {
    const s = rep.shots[n]; assert.ok(s, 'shot ' + n); assert.ok(s.litPixels > 200, `${n} is not blank (${s.litPixels})`);
  }
  assert.ok(rep.shots['pill-idle'].w >= 480 && rep.shots['pill-idle'].h >= 110);
  assert.ok(rep.shots['main-home'].w >= 1000 && rep.shots['main-home'].h >= 640);
  assert.ok(rep.summary.words >= 5000 && rep.summary.streak >= 3);
  fs.writeFileSync(path.join(proof, 'e2e-report.json'), JSON.stringify(rep, null, 1));
});
