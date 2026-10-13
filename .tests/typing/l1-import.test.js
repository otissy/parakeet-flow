'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');

for (const f of ['src/typer/typer.js', 'src/core/deny.js', 'src/core/postprocess.js', 'src/core/hotkey-fsm.js',
                 'src/core/live-typer.js', 'src/asr/segmenter.js']) {
  test(`loads alone: ${f}`, () => {
    const m = require(path.join(root, f));
    assert.ok(m && Object.keys(m).length > 0);
  });
}
