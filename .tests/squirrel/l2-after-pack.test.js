'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const hook = require(path.join(root, 'scripts/after-pack.js'));
const pkg = require(path.join(root, 'package.json'));

test('electron_wer.dll takes the name of the exe; nothing happens when it is absent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-wer-'));
  try {
    assert.equal(hook.renameWerHelper(dir, 'Parakeet Flow'), false);
    fs.writeFileSync(path.join(dir, 'electron_wer.dll'), 'x');
    await hook({ appOutDir: dir, packager: { appInfo: { productFilename: 'Parakeet Flow' } } });
    assert.deepEqual(fs.readdirSync(dir), ['Parakeet Flow_wer.dll']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the build runs the hook', () => {
  assert.equal(pkg.build.afterPack, 'scripts/after-pack.js');
});

const built = process.env.PF_BUILT_DIR && path.join(process.env.PF_BUILT_DIR, 'win-unpacked');
test('the built package carries the helper under the exe name', { skip: built && fs.existsSync(built) && /^(0\.2\.6[3-9]|0\.[3-9]|[1-9])/.test(path.basename(process.env.PF_BUILT_DIR)) ? false : 'no build of this version (UNVERIFIED)' }, () => {
  assert.ok(fs.existsSync(path.join(built, 'Parakeet Flow_wer.dll')));
  assert.ok(!fs.existsSync(path.join(built, 'electron_wer.dll')));
});
