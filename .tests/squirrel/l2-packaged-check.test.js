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
