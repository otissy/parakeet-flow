'use strict';
/* A test copy of the app runs the real helper with its real low-level keyboard hook. With default settings it would claim the
   user's Ctrl+Space, Ctrl+Shift+Space and CapsLock while the test runs. Every test that starts the app seeds this first:
   hold key F15, no CapsLock toggle, note chord Ctrl+F15. The tests drive dictation through the state machine, not through keys. */
const fs = require('fs');
const path = require('path');

const SAFE = { hotkeyV: 2, gestureV: 3, hotkey: { vks: [0x7e], label: 'F15' }, toggleOn: false, notes: { noteHotkey: { vks: [0x11, 0x7e], label: 'Ctrl+F15' } } };

function seedSafeKeys(userData) {
  fs.mkdirSync(userData, { recursive: true });
  const f = path.join(userData, 'settings.json');
  let old = {};
  try { old = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { /* a new folder */ }
  fs.writeFileSync(f, JSON.stringify({ ...old, ...SAFE, notes: { ...(old.notes || {}), ...SAFE.notes } }));
}

module.exports = { seedSafeKeys, SAFE };
