'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const C = require(path.join(root, 'src/core/commands.js'));
const { LiveTyper } = require(path.join(root, 'src/core/live-typer.js'));
const { MemoryTyper } = require(path.join(root, 'src/typer/typer.js'));
const { formal } = require(path.join(root, 'src/core/tone.js'));
const { casual } = require(path.join(root, 'src/core/postprocess.js'));

const act = (t) => (C.matchCommand(t) || {}).action;
const CMD = { enabled: true, list: C.DEFAULT_COMMANDS, notes: { enabled: true, triggers: C.DEFAULT_NOTE_TRIGGERS } };

test('matcher: English phrases, punctuation and case do not matter', () => {
  assert.equal(act('Delete that.'), 'delete'); assert.equal(act('scratch that'), 'delete'); assert.equal(act('  SCRATCH   THAT!  '), 'delete');
  assert.equal(act('New line.'), 'newline'); assert.equal(act('Newline'), 'newline'); assert.equal(act('New paragraph.'), 'paragraph');
  assert.equal(act('Undo that.'), 'undo'); assert.equal(act('Capitalize that.'), 'capitalize'); assert.equal(act('All caps that'), 'allcaps');
  assert.equal(act('Make that formal.'), 'formal'); assert.equal(act('Make that casual'), 'casual');
});

test('matcher: Dutch phrases', () => {
  assert.equal(act('Verwijder dat.'), 'delete'); assert.equal(act('Wis dat'), 'delete'); assert.equal(act('Schrap dat!'), 'delete');
  assert.equal(act('Nieuwe regel.'), 'newline'); assert.equal(act('Nieuwe alinea'), 'paragraph'); assert.equal(act('Maak dat ongedaan.'), 'undo');
  assert.equal(act('Maak dat formeel'), 'formal'); assert.equal(act('Maak dat informeel.'), 'casual'); assert.equal(act('Kapitaliseer dat'), 'capitalize');
});

test('matcher: only the WHOLE segment is a command (a sentence that mentions one is text)', () => {
  for (const t of ['Please delete that file.', 'I said new line of products.', 'Delete that and this', 'Do not scratch that', '', '   ', 'undo the changes', 'new']) assert.equal(C.matchCommand(t), null, t);
});

test('matcher: a custom phrase list replaces the defaults; unknown actions never match', () => {
  const list = [{ phrase: 'zap that', action: 'delete' }, { phrase: 'boom', action: 'nope' }];
  assert.equal(C.matchCommand('Zap that.', list).action, 'delete');
  assert.equal(C.matchCommand('Delete that.', list), null);
  assert.equal(C.matchCommand('boom', list), null);
});

test('note matcher: English and Dutch triggers, body keeps its words, trigger alone arms the next segment', () => {
  assert.deepEqual(C.matchNote('Note to self, buy milk.'), { text: 'Buy milk.', trigger: 'note to self' });
  assert.equal(C.matchNote('Notitie aan mezelf: bel de tandarts morgen').text, 'Bel de tandarts morgen');
  assert.equal(C.matchNote('note to myself pick up the keys').text, 'Pick up the keys');
  assert.equal(C.matchNote('Note to self.').text, '');
  for (const t of ['Take a note to self later', 'Notes to self', 'I will note to self', 'note', '']) assert.equal(C.matchNote(t), null, t);
});

test('prefix check: a partial that may become a command is held, ordinary text is not', () => {
  for (const t of ['del', 'Delete', 'Delete that', 'New', 'new l', 'Verwijder', 'nieuwe re', 'Note', 'note to', 'Note to self', 'note to self buy milk', 'Notitie aan', 'make that']) assert.equal(C.isCommandPrefix(t), true, t);
  for (const t of ['Hello', 'Delete the file from the folder', 'New line of products', 'I want to delete', 'notes', 'Note that the meeting moved', 'Verwijder alles uit de map nu']) assert.equal(C.isCommandPrefix(t), false, t);
  // partials are guesses: a mis-heard trigger must not let the note body onto the screen
  for (const t of ['Note to the first', 'Note to the first, buy oat milk on the way home', 'Notitie aan me zelf bel de tandarts', 'Delete the', 'New lion']) assert.equal(C.isCommandPrefix(t), true, t);
  assert.equal(C.isCommandPrefix('note to', { notes: false }), false);
});

test('transforms', () => {
  assert.equal(C.transformFor('capitalize', 'hello big world.'), 'Hello Big World.');
  assert.equal(C.transformFor('allcaps', 'hello'), 'HELLO');
  assert.equal(C.transformFor('formal', "i'm gonna go", { formal }), 'I am going to go.');
  assert.equal(C.transformFor('casual', 'Hello there.', { casual }), 'hello there');
});

/* ---- LiveTyper: edits through MemoryTyper ---- */
function mk(extra = {}) {
  const typer = new MemoryTyper({ pid: 77 });
  let t = 1000;
  const lt = new LiveTyper({ typer, now: () => t, ownPid: 1, formal, casual, prepare: (x) => x, tone: (x) => x, commands: CMD, ...extra });
  const ev = []; lt.on('command', (e) => ev.push(e)); const notes = []; lt.on('note', (e) => notes.push(e.text));
  assert.equal(lt.begin(), true);
  return { typer, lt, ev, notes, adv: (ms) => { t += ms; } };
}

test('a command phrase is never typed: not as a partial, not as a final', () => {
  const { typer, lt } = mk();
  lt.hypothesis(1, 'Delete'); lt.hypothesis(1, 'Delete that');
  assert.deepEqual(typer.log, []);
  lt.final(1, 'Delete that.');
  assert.deepEqual(typer.log, []);
  for (const p of ['New line.', 'Nieuwe regel.', 'Verwijder dat.', 'Undo that.', 'Capitalize that.']) { lt.hypothesis(9, p.slice(0, 6)); lt.final(9, p); }
  assert.ok(!/delete|verwijder|undo|capital|nieuwe/i.test(typer.text), typer.text);
});

test('delete that / scratch that / verwijder dat remove the last segment only', () => {
  for (const phrase of ['Delete that.', 'Scratch that.', 'Verwijder dat.']) {
    const { typer, lt } = mk();
    lt.hypothesis(1, 'Hello world'); lt.final(1, 'Hello world.');
    lt.hypothesis(2, 'Second one'); lt.final(2, 'Second one.');
    assert.equal(typer.text, 'Hello world. Second one.');
    lt.final(3, phrase);
    assert.equal(typer.text, 'Hello world.', phrase);
  }
});

test('a misheard partial of the command segment is removed too, then the command runs', () => {
  const { typer, lt } = mk();
  lt.final(1, 'Hello world.');
  lt.hypothesis(2, 'Eliminate that');
  assert.equal(typer.text, 'Hello world. Eliminate that');
  lt.final(2, 'Delete that.');
  assert.equal(typer.text, '');
});

test('new line / new paragraph: a break is typed, the next sentence follows without a leading space', () => {
  const { typer, lt } = mk();
  lt.final(1, 'Dear Anna,'); lt.final(2, 'New paragraph.'); lt.final(3, 'Thanks for the report.'); lt.final(4, 'Nieuwe regel.'); lt.final(5, 'Kind regards.');
  assert.equal(typer.text, 'Dear Anna,\n\nThanks for the report.\nKind regards.');
});

test('rewrite commands touch only the last segment and only the part that changes', () => {
  const { typer, lt } = mk();
  lt.final(1, 'First sentence.'); lt.final(2, 'hello big world.');
  lt.final(3, 'Capitalize that.');
  assert.equal(typer.text, 'First sentence. Hello Big World.');
  lt.final(4, 'All caps that.');
  assert.equal(typer.text, 'First sentence. HELLO BIG WORLD.');
  const n = typer.log.length;
  lt.final(5, 'All caps that.');                                   // already upper: no change, nothing typed
  assert.equal(typer.log.length, n);
});

test('make that formal / casual use the style rules', () => {
  const { typer, lt } = mk();
  lt.final(1, "i'm gonna go now");
  lt.final(2, 'Make that formal.');
  assert.equal(typer.text, 'I am going to go now.');
  lt.final(3, 'Maak dat informeel.');
  assert.equal(typer.text, 'I am going to go now');   // casual: no full stop, a leading I stays a capital
});

test('undo that: reverses delete, rewrite, new line and a typed segment, last first', () => {
  const { typer, lt } = mk();
  lt.final(1, 'alpha beta.');
  lt.final(2, 'Capitalize that.');   assert.equal(typer.text, 'Alpha Beta.');
  lt.final(3, 'Undo that.');          assert.equal(typer.text, 'alpha beta.');
  lt.final(4, 'Delete that.');        assert.equal(typer.text, '');
  lt.final(5, 'Undo that.');          assert.equal(typer.text, 'alpha beta.');
  lt.final(6, 'New line.');           assert.equal(typer.text, 'alpha beta.\n');
  lt.final(7, 'Maak dat ongedaan.');  assert.equal(typer.text, 'alpha beta.');
  lt.final(8, 'Undo that.');          assert.equal(typer.text, '');          // undoes the typed segment itself
  lt.final(9, 'Undo that.');          assert.equal(typer.text, '');          // nothing left to undo: harmless
});

test('commands never act when focus changed, and never reach into another window', () => {
  const { typer, lt, ev } = mk();
  lt.final(1, 'Secret text.');
  const before = typer.log.length;
  typer.setForeground({ hwnd: 2 });
  lt.final(2, 'Delete that.');
  assert.equal(typer.log.length, before);
  assert.equal(ev.at(-1).ok, false); assert.match(ev.at(-1).reason, /focus/);
});

test('a command that would need more than 400 backspaces is refused', () => {
  const { typer, lt, ev } = mk();
  lt.final(1, 'word '.repeat(100).trim() + '.');                  // 500 chars
  lt.final(2, 'Delete that.');
  assert.ok(typer.text.length > 400, 'still on screen');
  assert.equal(ev.at(-1).ok, false); assert.match(ev.at(-1).reason, /too long/);
  lt.final(3, 'Capitalize that.');
  assert.ok(typer.text.startsWith('word word'), 'capitalize needs more than 400 backspaces: refused');
});

test('note to self: saved, never typed, partials held back; works where typing is off; a lone trigger arms the next segment', () => {
  const { typer, lt, notes } = mk();
  lt.hypothesis(1, 'Note to self'); lt.hypothesis(1, 'Note to self buy'); lt.hypothesis(1, 'Note to self buy milk');
  assert.deepEqual(typer.log, []);
  lt.final(1, 'Note to self, buy milk.');
  assert.deepEqual(notes, ['Buy milk.']); assert.deepEqual(typer.log, []);
  lt.final(2, 'Notitie aan mezelf, bel de tandarts.'); assert.deepEqual(notes.at(-1), 'Bel de tandarts.');
  lt.final(3, 'Note to self.'); lt.hypothesis(4, 'Call mom'); lt.final(4, 'Call mom tomorrow.');
  assert.deepEqual(notes.at(-1), 'Call mom tomorrow.'); assert.equal(notes.length, 3); assert.deepEqual(typer.log, []);
  // a password-manager window: nothing is typed, but a note is still just saved
  const d = new MemoryTyper({ pid: 77, proc: 'keepass.exe' });
  const lt2 = new LiveTyper({ typer: d, ownPid: 1, prepare: (x) => x, tone: (x) => x, commands: CMD });
  const notes2 = []; lt2.on('note', (n) => notes2.push(n.text));
  assert.equal(lt2.begin(), false); lt2.final(1, 'Note to self, rotate the key.'); lt2.final(2, 'Delete that.');
  assert.deepEqual(notes2, ['Rotate the key.']); assert.deepEqual(d.log, []);
});

test('with commands off (or null) the same words are plain text', () => {
  for (const commands of [null, { enabled: false, list: C.DEFAULT_COMMANDS, notes: { enabled: false } }]) {
    const { typer, lt } = mk({ commands });
    lt.hypothesis(1, 'Delete that'); lt.final(1, 'Delete that.');
    assert.equal(typer.text, 'Delete that.');
  }
});

test('a custom phrase list is used', () => {
  const { typer, lt } = mk({ commands: { enabled: true, list: [{ phrase: 'zap that', action: 'delete' }], notes: { enabled: false } } });
  lt.final(1, 'Keep me.'); lt.final(2, 'Second.'); lt.final(3, 'Zap that.');
  assert.equal(typer.text, 'Keep me.');
  lt.final(4, 'Delete that.');                                      // not in the list any more: typed
  assert.equal(typer.text, 'Keep me. Delete that.');
});

test('carry: a command in the NEXT hold still reaches the last segment, but not after a window change or a long wait', () => {
  const fresh = () => { const a = mk(); a.lt.final(1, 'Carry me.'); return { a, carry: a.lt.end().carry }; };
  const next = (a, carry, { hwnd = 1, wait = 0, carryMs = 120000 } = {}) => {
    a.typer.setForeground({ hwnd });
    const lt = new LiveTyper({ typer: a.typer, now: () => 1000 + wait, ownPid: 1, prepare: (x) => x, tone: (x) => x, commands: CMD, carry: { ...carry, at: 1000 }, carryMs });
    lt.begin(); lt.final(1, 'Delete that.');
  };
  let f = fresh(); next(f.a, f.carry); assert.equal(f.a.typer.text, '', 'same window, soon: deleted');
  f = fresh(); next(f.a, f.carry, { wait: 5000 }); assert.equal(f.a.typer.text, '', '5 s later: deleted');
  f = fresh(); next(f.a, f.carry, { hwnd: 5 }); assert.equal(f.a.typer.text, 'Carry me.', 'other window: untouched');
  f = fresh(); next(f.a, f.carry, { wait: 999999 }); assert.equal(f.a.typer.text, 'Carry me.', 'too old: untouched');
});
