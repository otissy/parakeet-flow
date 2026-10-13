'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');
for (const f of ['src/asr/segmenter.js', 'src/asr/asr-host.js', 'src/asr/engine-sherpa.js', 'src/core/session.js', 'src/typer/win32-typer.js']) {
  test(`loads alone: ${f}`, () => assert.ok(Object.keys(require(path.join(root, f))).length > 0));
}
test('sherpa-onnx-node native addon loads', () => assert.ok(require('sherpa-onnx-node').OfflineRecognizer));
