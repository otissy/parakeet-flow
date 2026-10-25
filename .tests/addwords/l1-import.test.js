'use strict';
/* L1: every new or changed file loads alone, without side effects; the page loads the shared bias module; the preload
   allows every channel the new UI invokes. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('bias module loads alone and exposes both directions', () => {
  const B = require(path.join(root, 'src/slang/bias.js'));
  for (const k of ['scoreToPercent', 'percentToScore', 'normPercent', 'normScore', 'parsePercentInput']) assert.equal(typeof B[k], 'function', k);
  assert.equal(globalThis.PFBias, undefined, 'CommonJS load must not leak a global');
});

test('changed main-process modules load', () => {
  for (const f of ['src/slang/hotwords.js', 'src/slang/service.js', 'src/slang/ipc.js', 'src/slang/pack.js', 'src/main/settings.js', 'src/renderer/lib.js']) assert.ok(require(path.join(root, f)), f);
});

test('renderer scripts parse as browser scripts', () => {
  for (const f of ['src/renderer/slang-ui.js', 'src/renderer/app.js', 'src/renderer/lib.js', 'src/slang/bias.js']) assert.doesNotThrow(() => new Function(rd(f)), f);
});

test('app.html loads bias.js before the scripts that use it, from a file that exists', () => {
  const html = rd('src/renderer/app.html');
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const i = srcs.indexOf('../slang/bias.js');
  assert.ok(i >= 0, 'bias.js is loaded');
  assert.ok(i < srcs.indexOf('slang-ui.js') && i < srcs.indexOf('app.js'));
  assert.ok(fs.existsSync(path.join(root, 'src/renderer', srcs[i])));
});

test('preload allows every slang channel the renderer invokes', () => {
  const pre = rd('src/main/preload.js');
  const used = new Set([...rd('src/renderer/slang-ui.js').matchAll(/invoke\('(slang:[a-z-]+)'/g)].map((m) => m[1]));
  assert.ok(used.has('slang:set-bias') && used.has('slang:undo-add') && used.has('slang:add'));
  for (const ch of used) assert.ok(pre.includes(`'${ch}'`), ch + ' is allowed by the preload');
});
