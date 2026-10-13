'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const R = (...p) => path.join(root, ...p);

for (const f of ['src/renderer/lib.js', 'src/main/tray-icon.js', 'src/main/settings.js', 'src/main/controller.js', 'src/main/mic.js', 'src/asr/model-store.js']) {
  test(`loads alone: ${f}`, () => assert.ok(Object.keys(require(R(f))).length > 0));
}

test('every script and stylesheet a page references exists', () => {
  for (const page of ['app.html', 'pill.html', 'capture.html']) {
    const html = fs.readFileSync(R('src/renderer', page), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) assert.ok(fs.existsSync(R('src/renderer', m[1])), `${page} -> ${m[1]}`);
  }
});

test('renderer scripts parse', () => {
  for (const f of ['app.js', 'pill.js', 'capture.js', 'worklet.js', 'lib.js']) new Function(fs.readFileSync(R('src/renderer', f), 'utf8')); // eslint-disable-line no-new-func
});

test('main.js and preload.js parse (they need Electron to run)', () => {
  for (const f of ['main.js', 'preload.js']) new Function('require', 'module', fs.readFileSync(R('src/main', f), 'utf8').replace(/^'use strict';/, '')); // eslint-disable-line no-new-func
});

test('the C# helper source is present and has the commands the typer sends', () => {
  const cs = fs.readFileSync(R('src/typer/helper/PfHelper.cs'), 'utf8');
  for (const c of ['"HOTKEY"', '"TYPE"', '"BS"', '"FG"', 'KEYEVENTF_UNICODE', 'GetAsyncKeyState']) assert.ok(cs.includes(c), c);
});
