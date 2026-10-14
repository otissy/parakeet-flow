'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { root, tmpDir, Outbox, writeStatus } = require('./util');
const { cleanText, cleanTags } = require(path.join(root, 'src/notes/outbox.js'));
const { readStatus } = require(path.join(root, 'src/notes/mcp-status.js'));
const { exportNote, fileName, slug, render, checkFolder } = require(path.join(root, 'src/notes/export-md.js'));
const { normalize } = require(path.join(root, 'src/main/settings.js'));
const { noteChordError } = require(path.join(root, 'src/main/settings-notes.js'));

test('cleanText: NFC, control characters removed, newlines kept, capped', () => {
  assert.equal(cleanText('  caf\u0065\u0301\u0000 \u0007x\r\nline2  '), 'caf\u00e9 x\nline2');
  assert.equal(cleanText('a'.repeat(30000)).length, 20000);
  assert.equal(cleanText('\u0000\u0001'), '');
});
test('cleanTags: lower-case, de-duplicated, max 10, odd characters dropped', () => {
  assert.deepEqual(cleanTags(['Work', '#work', ' Idea  Box ', 'bad<script>', '', 'a'.repeat(41)]), ['work', 'idea box']);
  assert.equal(cleanTags(Array.from({ length: 30 }, (_, i) => 't' + i)).length, 10);
  assert.deepEqual(cleanTags('nope'), []);
});
test('outbox: a torn last line is closed, not glued to, and never loses the notes before it', () => {
  const f = path.join(tmpDir('torn'), 'notes.jsonl');
  const o = new Outbox(f); o.add('one');
  fs.appendFileSync(f, '{"id":"half","ts":1,"te');                  // a crash in the middle of a write
  assert.equal(o.notes.length, 1);
  o.add('two');
  const o2 = new Outbox(f);
  assert.deepEqual(o2.list().map((n) => n.text).sort(), ['one', 'two']);
});
test('outbox: a stale lock from a crashed process is stolen; a live one is waited for', () => {
  const f = path.join(tmpDir('lock'), 'notes.jsonl');
  const o = new Outbox(f);
  fs.writeFileSync(f + '.lock', '99999'); const old = new Date(Date.now() - 60000); fs.utimesSync(f + '.lock', old, old);
  assert.ok(o.add('after a crash'));
  assert.ok(!fs.existsSync(f + '.lock'), 'lock released');
});
test('outbox: markSynced records destination and url; another process sees it on its next read', () => {
  const f = path.join(tmpDir('sync'), 'notes.jsonl');
  const a = new Outbox(f), b = new Outbox(f);
  const n = a.add('x', { tags: ['t'], source: 'mcp' });
  b.markSynced(n.id, undefined, { destination: 'Notion: Notes', url: 'https://www.notion.so/abc' });
  const got = a.get(n.id);
  assert.equal(got.sync, 'synced'); assert.equal(got.destination, 'Notion: Notes'); assert.equal(got.url, 'https://www.notion.so/abc'); assert.deepEqual(got.tags, ['t']);
});
test('status file: no dictated text unless sharing is on; stale or dead-pid status is "not running"', () => {
  const d = tmpDir('status');
  writeStatus(d, { engine: 'ready', hotkeys: { dictation: 'Ctrl+Space', note: 'Ctrl+Shift+Space' }, shareHistory: false, recent: [{ ts: 1, text: 'SECRET WORDS' }] });
  assert.ok(!fs.readFileSync(path.join(d, 'mcp-status.json'), 'utf8').includes('SECRET'), 'never written when sharing is off');
  assert.equal(readStatus(d).running, true); assert.equal(readStatus(d).engine, 'ready');
  assert.equal(readStatus(d, Date.now() + 120000).running, false, 'stale');
  fs.writeFileSync(path.join(d, 'mcp-status.json'), JSON.stringify({ pid: 2147483000, updatedAt: Date.now(), engine: 'ready', recent: [{ ts: 1, text: 'LEAK' }], shareHistory: false }));
  const s = readStatus(d); assert.equal(s.running, false); assert.deepEqual(s.recent, [], 'a hand-edited file cannot smuggle text past the switch');
  writeStatus(d, { engine: 'ready', shareHistory: true, recent: [{ ts: 5, text: 'shared' }] });
  assert.equal(readStatus(d).recent[0].text, 'shared');
});
test('markdown export: front matter, stable name, safe name, no traversal, idempotent', () => {
  const note = { id: '0123456789abcdef', ts: Date.UTC(2026, 9, 13, 20, 0, 0), text: 'Plan: "Q4" ../../evil\nsecond line', tags: ['work', 'idea'], source: 'mcp', sync: 'local' };
  const name = fileName(note);
  assert.match(name, /^2026-10-13-plan-q4-evil-0123456789abcdef\.md$/);
  const md = render(note);
  assert.ok(md.startsWith('---\ntitle: "Plan: \\"Q4\\" ../../evil"\nid: "0123456789abcdef"\ncreated: 2026-10-13T20:00:00.000Z\ntags: ["work", "idea"]\nsource: "mcp"\n---\n\nPlan: "Q4" ../../evil\nsecond line\n'));
  const dir = tmpDir('md');
  assert.equal(exportNote(note, dir).name, name); assert.equal(exportNote(note, dir).name, name);
  assert.deepEqual(fs.readdirSync(dir), [name]);
  assert.equal(slug('CON'), 'note'); assert.equal(slug('\u00e9\u00e0 caf\u00e9!'), 'ea-cafe');
  assert.ok(fileName({ id: '../../x', ts: 0, text: 'a' }).indexOf('/') < 0 && fileName({ id: '..\\x', ts: 0, text: 'a' }).indexOf('\\') < 0);
  assert.equal(checkFolder('relative/path').ok, false); assert.equal(checkFolder('C:\\').ok, false); assert.equal(checkFolder('').ok, false);
});
test('settings: note hotkey must be modifiers + one key and may not hide the dictation chord; defaults for the new keys', () => {
  const n = normalize({});
  assert.deepEqual(n.notes.noteHotkey.vks, [0x11, 0x10, 0x20]); assert.equal(n.notes.autoRoute, true); assert.equal(n.mcp.shareHistory, false);
  assert.deepEqual(n.typing, { newline: 'auto', enterAfterFinal: false, live: false, terminalMethod: 'burst', otherMethod: 'burst', insertApps: [] }); assert.equal(n.notes.export.enabled, false);
  assert.equal(normalize({ notes: { noteHotkey: { vks: [0x11, 0x20] } } }).notes.noteHotkey.vks.length, 3, 'same as dictation hotkey: rejected');
  assert.deepEqual(normalize({ notes: { noteHotkey: { vks: [0x12, 0x4E], label: 'Alt + N' } } }).notes.noteHotkey.vks, [0x12, 0x4E]);
  assert.ok(noteChordError([0x20]) && noteChordError([0x11, 0x10]) && noteChordError([1, 2, 3, 4, 5]));
  assert.equal(normalize({ mcp: { shareHistory: 'yes' } }).mcp.shareHistory, false, 'only a real true switches sharing on');
  assert.equal(normalize({ typing: { newline: 'rm -rf' } }).typing.newline, 'auto');
});
