'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const m = require(path.join(__dirname, '..', '..', 'src', 'main', 'single-instance.js'));

test('loads alone, no side effects, exports the four functions', () => {
  for (const k of ['handoverData', 'waitForTakeover', 'onSecondInstance', 'relaunchAsNewest']) assert.strictEqual(typeof m[k], 'function', k);
  assert.strictEqual(typeof m.HANDOVER, 'string');
});

test('main.js wires the module in and the old show-only handler is gone', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(src, /require\('\.\/single-instance'\)/);
  assert.match(src, /singleInstance\.waitForTakeover/);
  assert.match(src, /singleInstance\.onSecondInstance/);
  assert.match(src, /requestSingleInstanceLock\(singleInstance\.handoverData\(\)\)/);
  assert.doesNotMatch(src, /app\.on\('second-instance', \(\) =>/);
});
