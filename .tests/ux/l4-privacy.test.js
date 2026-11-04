'use strict';
/* Findings 6 and 7: the texts about the network must match the code. The allowlist is the source of truth, so every path on it has to
   be covered by a phrase on the screen, and a new path fails here until somebody decides what the screen should say. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { launch, open, root, SYNC_OFF } = require('./util');
const A = require(path.join(root, 'src/sync/allowlist.js'));

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { if (browser) await browser.close(); });

const PHRASE = {
  hotkey: /hotkeys/, toggleOn: /hotkeys/, toggleKey: /hotkeys/, 'notes.noteHotkey': /hotkeys/,
  liveMode: /typing and style preferences/, trailingSpace: /typing and style preferences/, 'style.casual': /typing and style preferences/,
  'typing.newline': /typing and style preferences/, 'typing.enterAfterFinal': /typing and style preferences/, 'typing.live': /typing and style preferences/, 'typing.terminalMethod': /typing and style preferences/, 'typing.otherMethod': /typing and style preferences/,
  'typing.insertApps': /per-app rows/,
  'commands.enabled': /voice commands/, 'commands.carryMs': /voice commands/, 'commands.list': /voice commands/,
  'notes.enabled': /note phrases/, 'notes.triggers': /note phrases/, 'notes.autoRoute': /note phrases/,
  'tone.enabled': /tone/, 'tone.apps': /tone/,
  'translate.enabled': /translate and cleanup/, 'translate.target': /translate and cleanup/,
  fillers: /filler words/, 'cleanup.enabled': /translate and cleanup/, 'cleanup.timeoutMs': /translate and cleanup/, 'cleanup.idleMin': /translate and cleanup/,
  'slang.enabled': /which packs are on/, 'slang.biasing.enabled': /their bias/, 'slang.biasing.score': /their bias/,
};

test('every path on the allowlist is named on the screen, plus Dictionary rows, words and packs', async () => {
  const { page } = await open(browser, { goto: 'settings', sync: SYNC_OFF });
  const t = await page.locator('#sync-card').innerText();
  for (const k of A.SETTING_PATHS) { assert.ok(PHRASE[k], 'decide what the switch text says about ' + k); assert.match(t, PHRASE[k], k); }
  for (const w of [/your Dictionary rows/, /your words in My terms/, /which packs are on/]) assert.match(t, w);
  await page.close();
});

test('the switch text says who else sees it and what never goes', async () => {
  const { page } = await open(browser, { goto: 'settings', sync: SYNC_OFF });
  const t = await page.locator('#sync-card').innerText();
  for (const w of [/random install ID/, /app version/, /server sees your IP address/, /stored unencrypted/, /project's owner can read it/, /linked installs can read and change it/,
    /Sync never sends dictated text, transcript history, notes, meetings, audio, snippets, your Notion token or logs/, /While this is off, sync contacts nothing/]) assert.match(t, w);
  await page.close();
});

test('things that are local only are not claimed to go', () => {
  for (const k of ['snippets', 'userName', 'micId', 'deny', 'historyEnabled', 'provider']) assert.ok(k in A.LOCAL_ONLY, k);
});

test('Settings lists everything that can leave the PC, and when', async () => {
  const { page } = await open(browser, { goto: 'settings', sync: SYNC_OFF });
  assert.match(await page.locator('.sub').first().innerText(), /privacy, sync and updates/);
  const t = await page.locator('#privacy-leaves').innerText();
  for (const w of [/audio never does/, /github\.com/, /on by default/, /Downloads you start/, /Notion, only if you turn it on/, /Sync, only if you turn it on/, /install ID/, /Claude \(MCP\), only if you connect it/]) assert.match(t, w);
  await page.close();
});
