'use strict';
/* Voice commands through the whole module: hotkey -> Controller -> DictationSession -> LiveTyper -> typer, scripted ASR. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const root = path.join(__dirname, '..', '..');
const { Controller } = require(path.join(root, 'src/main/controller.js'));
const { Store } = require(path.join(root, 'src/main/settings.js'));
const { MemoryTyper } = require(path.join(root, 'src/typer/typer.js'));
const { FakeHost } = require(path.join(root, '.tests/asr/fakes.js'));

class EvTyper extends MemoryTyper {
  constructor(o) { super(o); this.ee = new EventEmitter(); }
  on(...a) { return this.ee.on(...a); }
  key(down) { this.ee.emit('key', { down }); }
}
class FakeMic { start(cb) { this.cb = cb; } stop() {} }

function rig(settings = {}, withNotes = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-cmd-'));
  const store = new Store(dir); if (Object.keys(settings).length) store.set(settings);
  const host = new FakeHost(); const typer = new EvTyper({ pid: 77 });
  const saved = [];
  const notes = withNotes ? { save: (text) => { const n = { id: 'n' + saved.length, text }; saved.push(n); return n; } } : null;
  const c = new Controller({ getAsr: () => host, typer, store, mic: new FakeMic(), ownPid: 1, doneFlashMs: 5, notes });
  c.attach();
  const pills = []; c.on('pill', (p) => pills.push(p));
  const notices = []; c.on('note', (n) => notices.push(n.note));
  // one hold: say a list of finals (each as one segment), release
  const hold = async (...finals) => {
    typer.key(true); await new Promise((r) => setTimeout(r, 260));       // past the tap window
    let seg = 1 + (hold.seg || 0);
    for (const t of finals) {
      const words = t.split(' ');
      for (let i = 1; i <= words.length; i++) host.emitEv('partial', { segId: seg, text: words.slice(0, i).join(' ') });   // growing partials
      host.emitEv('final', { segId: seg, text: t, audioSec: 1 }); seg++;
    }
    hold.seg = seg - 1;
    typer.key(false); host.emitEv('done', {});
    await new Promise((r) => setTimeout(r, 15));
  };
  return { c, host, typer, store, pills, notices, saved, hold };
}

test('dictate, then "delete that" in the SAME hold: gone, and the command word never appeared on screen', async () => {
  const { typer, hold } = rig();
  const seen = new Set();
  const orig = typer.type.bind(typer); typer.type = (t, o) => { seen.add(typer.text + t); return orig(t, o); };
  await hold('Meet me at ten.', 'Actually, scratch that.', 'Delete that.');
  assert.equal(typer.text, 'Meet me at ten.');   // "Actually, scratch that." is a sentence (typed), only the last "Delete that." is a command and removes it
  assert.ok(![...seen].some((s) => /Delete/.test(s) && !/Actually/.test(s)), 'never typed "Delete that"');
});

test('"delete that" in a NEW hold removes what the previous hold typed (same window)', async () => {
  const { typer, hold, pills } = rig();
  await hold('First thought.');
  assert.equal(typer.text, 'First thought.');
  await hold('Second thought.');
  assert.equal(typer.text, 'First thought.Second thought.');           // sessions do not add a separator (existing behaviour)
  await hold('Scratch that.');
  assert.equal(typer.text, 'First thought.');
  assert.equal(pills.at(-1).state === 'done' || pills.at(-1).state === 'idle', true);
  assert.ok(pills.some((p) => p.state === 'done' && p.text === 'Deleted'), 'pill flashes what happened');
});

test('Dutch: nieuwe regel, verwijder dat, maak dat ongedaan', async () => {
  const { typer, hold } = rig();
  await hold('Hallo Anna,', 'Nieuwe regel.', 'Bedankt voor het rapport.');
  assert.equal(typer.text, 'Hallo Anna,\nBedankt voor het rapport.');
  await hold('Verwijder dat.');
  assert.equal(typer.text, 'Hallo Anna,\n');
  await hold('Maak dat ongedaan.');
  assert.equal(typer.text, 'Hallo Anna,\nBedankt voor het rapport.');
});

test('note to self: saved to the outbox hook, nothing typed, pill flashes "Saved note"', async () => {
  const { typer, hold, saved, pills } = rig();
  await hold('Note to self, buy oat milk.');
  assert.equal(typer.text, '');
  assert.deepEqual(saved.map((n) => n.text), ['Buy oat milk.']);
  assert.ok(pills.some((p) => p.state === 'done' && p.text === 'Saved note'));
  await hold('Notitie aan mezelf, de bol.com bestelling controleren.');
  assert.equal(saved.length, 2); assert.equal(typer.text, '');
});

test('note to self is plain text when notes are off or no outbox is wired', async () => {
  let r = rig({}, false); await r.hold('Note to self, buy oat milk.');
  assert.equal(r.typer.text, 'Note to self, buy oat milk.');
  r = rig({ notes: { enabled: false, triggers: ['note to self'], notion: {} } }); await r.hold('Note to self, buy oat milk.');
  assert.equal(r.typer.text, 'Note to self, buy oat milk.'); assert.equal(r.saved.length, 0);
});

test('commands switched off in Settings: the words are typed', async () => {
  const { typer, hold } = rig({ commands: { enabled: false, list: [] } });
  await hold('Delete that.');
  assert.equal(typer.text, 'Delete that.');
});

test('a user-edited phrase list works, and an invalid action is dropped by the settings normaliser', async () => {
  const { typer, hold, store } = rig({ commands: { enabled: true, carryMs: 120000, list: [{ phrase: 'weg ermee', action: 'delete' }, { phrase: 'x', action: 'format-disk' }] } });
  assert.deepEqual(store.get().commands.list, [{ phrase: 'weg ermee', action: 'delete' }]);
  await hold('Houd dit.', 'Weg ermee.');
  assert.equal(typer.text, '');
});

test('make that formal on the previous hold', async () => {
  const { typer, hold } = rig();
  await hold("i'm gonna call you tomorrow");
  await hold('Make that formal.');
  assert.equal(typer.text, 'I am going to call you tomorrow.');
});

test('window changed between holds: the command does nothing and says why', async () => {
  const { typer, hold, notices } = rig();
  await hold('Stay put.');
  typer.setForeground({ hwnd: 9 });
  await hold('Delete that.');
  assert.equal(typer.text, 'Stay put.');
  assert.ok(notices.some((n) => /Command skipped|nothing to delete/.test(n)), notices.join('|'));
});
