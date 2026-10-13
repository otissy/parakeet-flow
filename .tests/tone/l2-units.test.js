'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const T = require(path.join(root, 'src/core/tone.js'));
const { detectLang } = require(path.join(root, 'src/core/lang.js'));
const { normalize } = require(path.join(root, 'src/main/settings.js'));

const prof = (fg, o) => T.resolveProfile(fg, o).profile;

test('built-in table: chat apps casual, mail formal, editors and terminals code', () => {
  assert.equal(prof({ proc: 'Discord.exe', title: 'general | Server - Discord' }), 'casual');
  assert.equal(prof({ proc: 'WhatsApp.exe', title: 'WhatsApp' }), 'casual');
  assert.equal(prof({ proc: 'chrome.exe', title: 'Chat - WhatsApp Web - Google Chrome' }), 'casual');
  assert.equal(prof({ proc: 'OUTLOOK.EXE', title: 'Inbox - Outlook' }), 'formal');
  assert.equal(prof({ proc: 'chrome.exe', title: 'Inbox (3) - otis@gmail.com - Gmail - Google Chrome' }), 'formal');
  assert.equal(prof({ proc: 'Code.exe', title: 'live-typer.js - parakeet-flow - Visual Studio Code' }), 'code');
  assert.equal(prof({ proc: 'WindowsTerminal.exe', title: 'PowerShell' }), 'code');
  assert.equal(prof({ proc: 'cmd.exe', title: 'Command Prompt' }), 'code');
  assert.equal(prof({ proc: 'mintty.exe', title: 'MINGW64:/c/Users' }), 'code');
  assert.equal(prof({ proc: 'notepad.exe', title: 'Untitled - Notepad' }), 'default');
  assert.equal(prof({ proc: 'chrome.exe', title: 'Mailbox cleanup tips' }), 'default');   // "mail" alone is not a signal
});

test('user rows come first, match process or title, and can be switched off', () => {
  const apps = [{ match: 'discord', profile: 'formal' }, { match: 'jira', profile: 'formal' }, { match: 'slack.exe', profile: 'casual' }];
  assert.deepEqual(T.resolveProfile({ proc: 'Discord.exe', title: 'x' }, { apps }), { profile: 'formal', source: 'user', match: 'discord' });
  assert.equal(prof({ proc: 'firefox.exe', title: 'PROJ-12 - Jira' }, { apps }), 'formal');
  assert.equal(prof({ proc: 'slack.exe', title: 'x' }, { apps }), 'casual');
  assert.equal(prof({ proc: 'Discord.exe', title: 'x' }, { enabled: false, apps }), 'default');
  assert.equal(prof(null, { apps }), 'default');
});

test('settings normaliser: only known profiles and non-empty matches survive', () => {
  const s = normalize({ tone: { enabled: true, apps: [{ match: ' Slack ', profile: 'casual' }, { match: '', profile: 'formal' }, { match: 'x', profile: 'pirate' }] } });
  assert.deepEqual(s.tone.apps, [{ match: 'Slack', profile: 'casual' }]);
});

test('casual: no final full stop, lower-case start allowed, I stays a capital', () => {
  assert.equal(T.applyTone('Hello there.', 'casual'), 'hello there');
  assert.equal(T.applyTone("I think so.", 'casual'), 'I think so');
  assert.equal(T.applyTone('See you at ten!', 'casual'), 'see you at ten!');
});

test('formal: contractions and slang expanded, capitals, full stop', () => {
  assert.equal(T.applyTone("i can't make it, gonna be late", 'formal'), 'I cannot make it, going to be late.');
  assert.equal(T.applyTone('yeah thanks for the update', 'formal'), 'Yes thank you for the update.');
  assert.equal(T.applyTone('Dank je wel. ff checken', 'formal'), 'Dank je wel. Even checken.');
  assert.equal(T.applyTone('Already formal.', 'formal'), 'Already formal.');
});

test('code: no auto capital on the first word, no trailing full stop; acronyms and I untouched', () => {
  assert.equal(T.applyTone('Git status.', 'code'), 'git status');
  assert.equal(T.applyTone('NPM install', 'code'), 'NPM install');
  assert.equal(T.applyTone("I'll run it", 'code'), "I'll run it");
  assert.equal(T.applyTone('Clear screen', 'code'), 'clear screen');
});

test('default keeps the text, or applies the global casual style', () => {
  assert.equal(T.applyTone('Hello there.', 'default'), 'Hello there.');
  assert.equal(T.applyTone('Hello there.', 'default', { globalCasual: true }), 'hello there');
  assert.equal(T.applyTone('', 'formal'), '');
});

test('language detector: Dutch vs English vs unsure', () => {
  assert.equal(detectLang('Ik denk dat we morgen om tien uur moeten afspreken'), 'nl');
  assert.equal(detectLang('I think we should meet tomorrow at ten'), 'en');
  assert.equal(detectLang('Kun je me het rapport sturen voor de vergadering'), 'nl');
  assert.equal(detectLang('Amsterdam 2026'), null);
  assert.equal(detectLang(''), null);
});
