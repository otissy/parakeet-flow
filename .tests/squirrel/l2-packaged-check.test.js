'use strict';
/* The build fails when the packaged app lacks a file it cannot start without (0.2.64 shipped without sherpa-onnx-win-x64). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkPackagedApp, REQUIRED } = require('../../scripts/build-installer.js');

const make = (skip = []) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-pk-'));
  for (const r of REQUIRED) if (!skip.includes(r)) { fs.mkdirSync(path.dirname(path.join(d, r)), { recursive: true }); fs.writeFileSync(path.join(d, r), 'x'); }
  return d;
};

test('a complete package passes', () => { assert.deepStrictEqual(checkPackagedApp(make()), []); });
test('a package without the sherpa platform package is named as missing', () => {
  const skip = REQUIRED.filter((r) => r.includes('sherpa-onnx-win-x64'));
  const miss = checkPackagedApp(make(skip));
  assert.deepStrictEqual(miss, skip);
  assert.ok(miss.some((m) => m.endsWith('sherpa-onnx.node')));
});
test('a VC++ DLL or the helper missing is named', () => {
  assert.deepStrictEqual(checkPackagedApp(make(['vcruntime140.dll', 'resources/app/src/typer/helper/bin/pf-helper.exe'])).length, 2);
});
test('a native file of the reference build that the new package lacks is named', () => {
  const ref = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ref-'));
  fs.mkdirSync(path.join(ref, 'node_modules', 'other'), { recursive: true });
  fs.writeFileSync(path.join(ref, 'node_modules', 'other', 'x.node'), 'x');
  const miss = checkPackagedApp(make(), ref);
  assert.deepStrictEqual(miss, ['resources/app/node_modules/other/x.node (shipped by the reference build)']);
});
test('read aloud: its code and speaker page are required in the package, the 350 MB voice is not (downloaded on first use), and every named source exists in the repo', () => {
  const ra = REQUIRED.filter((r) => /readaloud|speaker\./.test(r));
  assert.ok(ra.some((r) => r.endsWith('src/readaloud/tts-worker.js')) && ra.some((r) => r.endsWith('src/readaloud/bunzip2.js')) && ra.some((r) => r.endsWith('src/renderer/speaker.html')));
  assert.ok(!REQUIRED.some((r) => /\.onnx|voices\.bin|espeak/.test(r)), 'no model file is expected in the installer');
  for (const r of ra) assert.ok(fs.existsSync(path.join(__dirname, '..', '..', r.replace(/^resources\/app\//, ''))), r);
  const skip = ra.filter((r) => r.endsWith('tts-worker.js'));
  assert.deepStrictEqual(checkPackagedApp(make(skip)), skip, 'a package without the voice worker is named as missing');
});
test('the packaged llama binaries must be exactly win-x64; the installer may not grow more than 15% over 0.2.65 without the override', () => {
  const B = require('../../scripts/build-installer.js');
  const mk = (names) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ll-')); for (const n of names) fs.mkdirSync(path.join(d, 'resources/app/llm-runtime/node_modules/@node-llama-cpp', n), { recursive: true }); return d; };
  assert.deepStrictEqual(B.checkLlamaSet(mk(['win-x64'])), []);
  assert.deepStrictEqual(B.checkLlamaSet(mk(['win-x64', 'win-x64-cuda', 'win-arm64'])), ['unexpected @node-llama-cpp/win-arm64', 'unexpected @node-llama-cpp/win-x64-cuda']);
  assert.deepStrictEqual(B.checkLlamaSet(mk([])), ['missing @node-llama-cpp/win-x64']);
  assert.equal(B.checkSize(213302784 + 1000), '');
  assert.match(B.checkSize(547366912), /over 0\.2\.65/);
  assert.equal(B.checkSize(547366912, { override: true }), '');
  assert.ok(B.checkSize(Math.round(213302784 * 1.16)) !== '' && B.checkSize(Math.round(213302784 * 1.14)) === '');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  for (const n of ['win-arm64', 'win-x64-cuda', 'win-x64-cuda-ext', 'win-x64-vulkan']) assert.ok(pkg.build.files.some((f) => f.startsWith('!') && f.includes(n)), n + ' is excluded from packaging');
});
