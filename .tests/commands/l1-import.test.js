'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');

test('voice-command modules load with no side effects', () => {
  const c = require(path.join(root, 'src/core/commands.js'));
  for (const k of ['matchCommand', 'matchNote', 'isCommandPrefix', 'transformFor', 'DEFAULT_COMMANDS', 'DEFAULT_NOTE_TRIGGERS', 'ACTIONS']) assert.ok(c[k], k);
  const { LiveTyper } = require(path.join(root, 'src/core/live-typer.js'));
  assert.equal(typeof LiveTyper, 'function');
  assert.equal(typeof require(path.join(root, 'src/core/session.js')).DictationSession, 'function');
  assert.equal(typeof require(path.join(root, 'src/core/lang.js')).detectLang, 'function');
});
