'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { amplify, NORMAL_VAD } = require(path.join(root, 'src/main/controller.js'));
const { normalize, DEFAULTS } = require(path.join(root, 'src/main/settings.js'));

test('amplify: scales, clips to +-1, leaves the input alone, gain 1 is the same array', () => {
  const a = Float32Array.from([0.1, -0.2, 0.5, -0.9]);
  const b = amplify(a, 3);
  assert.deepEqual(Array.from(b).map((x) => +x.toFixed(3)), [0.3, -0.6, 1, -1]);
  assert.deepEqual(Array.from(a).map((x) => +x.toFixed(2)), [0.1, -0.2, 0.5, -0.9]);
  assert.equal(amplify(a, 1), a); assert.equal(amplify(a, 0.5), a);
  assert.equal(amplify(new Float32Array(0), 4).length, 0);
});

test('settings: whisper defaults off, gain and threshold are clamped, garbage falls back', () => {
  assert.deepEqual(DEFAULTS.whisper, { enabled: false, gain: 3, vadThreshold: 0.3 });
  assert.equal(NORMAL_VAD, 0.5);
  const w = (x) => normalize({ whisper: x }).whisper;
  assert.deepEqual(w({ enabled: true, gain: 100, vadThreshold: 0.01 }), { enabled: true, gain: 8, vadThreshold: 0.1 });
  assert.deepEqual(w({ enabled: true, gain: 0, vadThreshold: 7 }), { enabled: true, gain: 1, vadThreshold: 0.5 });
  assert.deepEqual(w({ enabled: 'yes', gain: 'loud', vadThreshold: null }), { enabled: true, gain: 3, vadThreshold: 0.3 });
  assert.deepEqual(normalize({}).whisper, DEFAULTS.whisper);
});
