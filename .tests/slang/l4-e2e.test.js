'use strict';
/* L4: the real Electron app (real windows off-screen, real IPC, real files in a temp user-data folder).
   ui      : the Dictionary page driven with real clicks; screenshots at the window's real size (1000x680)
   dictate : Kokoro speech through the real VAD + Parakeet, once with the packs off and once on
   Models, Electron or the Kokoro voice files missing = skipped and reported UNVERIFIED. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..', '..');
const U = require('../asr/util');

const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const proof = process.env.PF_PROOF_DIR || path.join(root, '..', 'pf-proof');
const baseOk = U.modelsPresent() && fs.existsSync(electron);

function runHook(mode, extra = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-slang-'));
  const report = path.join(userData, 'report.json');
  const env = { ...process.env, PF_USERDATA: userData, PF_MODELS: path.join(process.env.APPDATA, 'parakeet-flow', 'models'), PF_OFFSCREEN: '1', PF_NO_LOGIN_ITEM: '1',
    PF_TEST_HOOK: path.join(__dirname, 'hook.js'), PF_MODE: mode, PF_REPORT: report, PF_PROOF_DIR: proof, PF_FIXTURES: U.FIX, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [root], { env, encoding: 'utf8', timeout: 220000 });
  assert.ok(fs.existsSync(report), 'hook wrote a report: ' + (r.stderr || '').slice(0, 300));
  const rep = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.deepEqual(rep.errors, []);
  return rep;
}

function slangFixtures() {
  const need = [1, 2, 3, 4].some((n) => !fs.existsSync(path.join(U.FIX, `slang-${n}.wav`)));
  if (!need) return true;
  const py = path.join(U.CV, '.venv', 'Scripts', 'python.exe');
  if (!fs.existsSync(py)) return false;
  return spawnSync(py, [path.join(U.FIX, 'gen-slang.py'), U.CV, U.FIX], { encoding: 'utf8' }).status === 0;
}

test('Dictionary page: packs, toggles, browse, add / edit / delete, paste and file import, export, delete pack, master switch', { skip: baseOk ? false : 'electron or models missing (UNVERIFIED)', timeout: 240000 }, () => {
  const rep = runHook('ui');
  assert.equal(rep.packRows, 2, 'two built-in packs listed');
  assert.deepEqual(rep.afterToggleOff, { 'starter-nl': false }); assert.equal(rep.nlSwitch, 'false'); assert.deepEqual(rep.afterToggleOn, { 'starter-nl': true });
  assert.equal(rep.viewRows, 120, 'a pack opens with its first 120 terms'); assert.deepEqual(rep.searchRows, ['ceiling shot', 'ceiling shots', 'ceiling reset']);
  assert.equal(rep.mineFileAfterAdd.terms[0].term, 'Zorgle'); assert.deepEqual(rep.mineFileAfterAdd.terms[0].variants, ['zorg', 'zorgel']);
  assert.equal(rep.tryOut, 'so the Zorgle said no cap and rizz and a GG', 'the Try it box uses the new term at once');
  assert.deepEqual(rep.mineAfterEdit[0].variants, ['zorg', 'zorgel', 'zorgul']); assert.equal(rep.mineAfterEdit[0].term, 'Zorgle2'); assert.deepEqual(rep.mineAfterDelete, []);
  assert.match(rep.previewText, /9 terms found/); assert.ok(rep.afterImportFiles.includes('my-pasted-list.json')); assert.match(rep.importResultText, /Imported 9 terms/);
  assert.ok(rep.afterFileImport.includes('evil-name.json'), 'a file import is named from the sanitised file name: ' + rep.afterFileImport);
  for (const f of rep.packFiles) assert.ok(/^[a-z0-9][a-z0-9_-]*\.json$/.test(f), f);
  assert.ok(rep.exportedIsJson, 'export wrote a pack file');
  assert.equal(rep.builtinDeleteButtons, 0, 'built-in packs have no delete button'); assert.ok(!rep.afterDeletePack.includes('evil-name.json'));
  assert.equal(rep.masterOff, false); assert.equal(rep.tryOffText, 'so the zorgel said no kap and riz and a gee gee', 'master off = nothing changes'); assert.equal(rep.masterOn, true);
  for (const [n, s] of Object.entries(rep.shots)) { assert.ok(s.litPixels > 200, n + ' is not blank'); assert.ok(s.w >= 1000 && s.h >= 680, n + ' at real size'); }
});

test('TTS slang fixtures through the real VAD + Parakeet + packs: off vs on', { skip: baseOk && slangFixtures() ? false : 'electron, models or Kokoro voice files missing (UNVERIFIED)', timeout: 240000 }, () => {
  const rep = runHook('dictate');
  const off = rep.results.off, on = rep.results.on;
  fs.writeFileSync(path.join(proof, 'slang-dictation.json'), JSON.stringify(rep.results, null, 1));
  assert.match(off['slang-1'], /\briz\b/i); assert.match(on['slang-1'], /\brizz\b/); assert.match(on['slang-1'], /\bGG\b/);
  assert.match(off['slang-3'], /goaded/); assert.match(on['slang-3'], /goated/); assert.match(on['slang-3'], /skibidi sigma/);
  assert.match(off['slang-4'], /phanom tax/i); assert.match(on['slang-4'], /fanum tax/);
  for (const n of ['slang-1', 'slang-2', 'slang-3', 'slang-4']) assert.ok(on[n].trim().split(/\s+/).length >= 10, 'whole sentence came through: ' + on[n]);
});
