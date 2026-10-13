'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');

test('tone modules load alone', () => {
  const t = require(path.join(root, 'src/core/tone.js'));
  for (const k of ['resolveProfile', 'applyTone', 'formal', 'codeTone', 'BUILTIN_APPS', 'PROFILES']) assert.ok(t[k], k);
  assert.equal(typeof require(path.join(root, 'src/core/lang.js')).detectLang, 'function');
});
