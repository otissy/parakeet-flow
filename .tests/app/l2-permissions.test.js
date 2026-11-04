'use strict';
/* Electron 45 reports desktop capture as display-capture: without it meeting capture fails with "Permission denied" (seen with the real page). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const P = require(path.join(root, 'src/main/permissions.js'));

test('the microphone and desktop capture are allowed, nothing else', () => {
  assert.equal(P.allowed('media'), true);
  assert.equal(P.allowed('display-capture'), true);
  for (const p of ['notifications', 'geolocation', 'openExternal', 'clipboard-read', 'fullscreen', 'pointerLock', 'hid', 'usb', 'serial', '', undefined]) assert.equal(P.allowed(p), false, String(p));
});

test('install sets both handlers and they answer the same way', () => {
  const s = {};
  P.install({ setPermissionRequestHandler: (f) => { s.req = f; }, setPermissionCheckHandler: (f) => { s.chk = f; } });
  for (const [p, want] of [['media', true], ['display-capture', true], ['geolocation', false]]) {
    let got; s.req(null, p, (v) => { got = v; });
    assert.equal(got, want, 'request ' + p);
    assert.equal(s.chk(null, p), want, 'check ' + p);
  }
});

test('the main process uses this module on the default session', () => {
  const main = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
  assert.match(main, /require\('\.\/permissions'\)\.install\(session\.defaultSession\)/);
  assert.doesNotMatch(main, /setPermission(Request|Check)Handler/);
});
