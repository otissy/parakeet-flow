'use strict';
/* L1: every new file loads on its own with no side effects, and the shipped packs parse. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');
const S = (f) => path.join(root, 'src', f);

test('slang modules load without touching the disk or the network', () => {
  const before = fs.readdirSync(root).sort().join();
  for (const m of ['slang/matcher.js', 'slang/import.js', 'slang/pack.js', 'slang/common.js', 'slang/service.js', 'slang/ipc.js']) {
    const x = require(S(m));
    assert.ok(x && Object.keys(x).length, m + ' exports something');
  }
  assert.equal(fs.readdirSync(root).sort().join(), before, 'loading created no files');
});

test('changed files still load', () => {
  for (const m of ['core/postprocess.js', 'core/session.js', 'llm/cleanup.js', 'llm/guard.js', 'main/settings.js', 'main/controller.js']) require(S(m));
});

test('renderer script parses (browser file, checked by compiling it)', () => {
  new vm.Script(fs.readFileSync(S('renderer/slang-ui.js'), 'utf8'), { filename: 'slang-ui.js' });
  new vm.Script(fs.readFileSync(S('renderer/app.js'), 'utf8'), { filename: 'app.js' });
});

test('shipped packs are valid JSON in format 1 and sized as documented', () => {
  const dir = path.join(root, 'src', 'slang', 'packs');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.deepEqual(files.sort(), ['starter-en.json', 'starter-nl.json']);
  const en = JSON.parse(fs.readFileSync(path.join(dir, 'starter-en.json'), 'utf8'));
  const nl = JSON.parse(fs.readFileSync(path.join(dir, 'starter-nl.json'), 'utf8'));
  for (const p of [en, nl]) { assert.equal(p.format, 1); assert.ok(/^[a-z0-9-]+$/.test(p.id)); assert.ok(Array.isArray(p.terms)); }
  assert.ok(en.terms.length >= 400, 'English starter has 400+ terms, has ' + en.terms.length);
  assert.ok(nl.terms.length >= 40, 'Dutch starter set, has ' + nl.terms.length);
});

test('preload exposes every slang channel the page uses', () => {
  const pre = fs.readFileSync(S('main/preload.js'), 'utf8');
  const ui = fs.readFileSync(S('renderer/slang-ui.js'), 'utf8');
  const used = new Set([...ui.matchAll(/'(slang:[a-z-]+)'/g)].map((m) => m[1]));
  assert.ok(used.size >= 10);
  for (const ch of used) assert.ok(pre.includes(`'${ch}'`), ch + ' is whitelisted in preload.js');
  const ipc = fs.readFileSync(S('slang/ipc.js'), 'utf8');
  for (const ch of used) assert.ok(ipc.includes(`'${ch}'`), ch + ' has a handler');
});
