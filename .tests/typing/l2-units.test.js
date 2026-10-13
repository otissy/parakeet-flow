'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { MemoryTyper, replay } = require(path.join(root, 'src/typer/typer.js'));
const { LiveTyper } = require(path.join(root, 'src/core/live-typer.js'));
const { clean, removeFillers } = require(path.join(root, 'src/core/postprocess.js'));
const { HotkeyFsm } = require(path.join(root, 'src/core/hotkey-fsm.js'));
const { isDenied } = require(path.join(root, 'src/core/deny.js'));

const mk = (o = {}) => {
  const typer = new MemoryTyper({ pid: 4242, proc: 'notepad.exe' });
  let t = 0;
  const lt = new LiveTyper({ typer, now: () => t, ownPid: 1, ...o });
  lt.begin();
  return { typer, lt, adv: (ms) => { t += ms; } };
};

test('replay: type, backspace, over-backspace clamps, emoji counts as one', () => {
  assert.equal(replay([{ op: 'type', text: 'abc' }, { op: 'bs', n: 1 }, { op: 'type', text: 'X' }]), 'abX');
  assert.equal(replay([{ op: 'type', text: 'a' }, { op: 'bs', n: 5 }]), '');
  assert.equal(replay([{ op: 'type', text: 'a😀' }, { op: 'bs', n: 1 }]), 'a');
});

test('hypothesis: common prefix, backspace the differing tail only', () => {
  const { typer, lt } = mk();
  lt.hypothesis(1, 'Hello wor');
  lt.hypothesis(1, 'Hello world');
  lt.hypothesis(1, 'Hello word');   // 'ld' -> 'd': two backspaces
  assert.equal(typer.text, 'Hello word');
  assert.deepEqual(typer.log.filter((o) => o.op === 'bs').map((o) => o.n), [2]);
});

test('hypothesis: empty and whitespace-only are ignored', () => {
  const { typer, lt } = mk();
  assert.equal(lt.hypothesis(1, '   '), false);
  assert.equal(typer.log.length, 0);
});

test('cap: a live correction over 40 backspaces waits; the final may rewrite (bounded)', () => {
  const { typer, lt } = mk({ cap: 40 });
  lt.hypothesis(1, 'a'.repeat(60));
  assert.equal(lt.hypothesis(1, 'b'.repeat(60)), false);      // 60 > 40 -> deferred
  assert.equal(typer.text, 'a'.repeat(60));
  assert.equal(lt.stats.deferred, 1);
  lt.hypothesis(1, 'a'.repeat(50) + 'c'.repeat(10));          // 10 backspaces, allowed
  assert.equal(typer.text, 'a'.repeat(50) + 'c'.repeat(10));
  assert.ok(lt.stats.maxBackspace <= 40);
  lt.final(1, 'z'.repeat(60));                                  // final: allowed to exceed the live cap
  assert.equal(typer.text, 'z'.repeat(60));
  assert.equal(lt.stats.maxFinalBackspace, 60);
  assert.ok(lt.stats.maxBackspace <= 40, 'live cap statistic untouched by the final');
});

test('immutable: a new segment never backspaces into a finalised one', () => {
  const { typer, lt } = mk();
  lt.hypothesis(1, 'First sentence.');
  lt.final(1, 'First sentence.');
  lt.hypothesis(2, 'Second');
  lt.hypothesis(2, 'Second one');
  lt.final(2, 'Second one.');
  assert.equal(typer.text, 'First sentence. Second one.');
  const total = typer.log.filter((o) => o.op === 'bs').reduce((s, o) => s + o.n, 0);
  assert.ok(total <= 1, 'only the live segment may be corrected');
});

test('final applies postprocess (fillers) as an in-place correction', () => {
  const { typer, lt } = mk({ finalize: (t) => clean(t) });
  lt.hypothesis(1, 'Um, send it today');
  lt.final(1, 'Um, send it today');
  assert.equal(typer.text, 'Send it today');
});

test('stable mode types only words that survived two passes', () => {
  const { typer, lt } = mk({ mode: 'stable' });
  assert.equal(lt.hypothesis(1, 'I want to'), false);          // first pass: nothing yet
  lt.hypothesis(1, 'I want two eat');
  assert.equal(typer.text, 'I want');
  lt.hypothesis(1, 'I want two eat now');
  assert.equal(typer.text, 'I want two eat');
  lt.final(1, 'I want to eat now.');
  assert.equal(typer.text, 'I want to eat now.');
});

test('flush window: nothing typed after release + 1.5 s, late final is reported not typed', () => {
  const { typer, lt, adv } = mk();
  const late = [];
  lt.on('late-final', (e) => late.push(e));
  lt.hypothesis(1, 'Hello');
  lt.release();
  adv(1400); assert.equal(lt.hypothesis(1, 'Hello there'), true);
  adv(200);  assert.equal(lt.final(1, 'Hello there.'), false);
  assert.equal(typer.text, 'Hello there');
  assert.equal(late.length, 1);
});

test('focus change halts typing for the rest of the session', () => {
  const { typer, lt } = mk();
  lt.hypothesis(1, 'one');
  typer.setForeground({ hwnd: 77 });
  assert.equal(lt.hypothesis(1, 'one two'), false);
  assert.equal(typer.text, 'one');
  assert.equal(lt.halted, 'focus changed');
  typer.setForeground({ hwnd: 1 });
  assert.equal(lt.hypothesis(1, 'one two three'), false);       // stays halted
});

test('deny-list: begin() on a password manager types nothing', () => {
  const typer = new MemoryTyper({ proc: 'KeePassXC.exe', pid: 9 });
  const lt = new LiveTyper({ typer, ownPid: 1 });
  assert.equal(lt.begin(), false);
  lt.hypothesis(1, 'secret');
  assert.equal(typer.log.length, 0);
});

test('Esc removes only the live segment, finalised text stays', () => {
  const { typer, lt } = mk();
  lt.hypothesis(1, 'Kept sentence.'); lt.final(1, 'Kept sentence.');
  lt.hypothesis(2, 'discard me');
  lt.cancelSegment();
  assert.equal(typer.text, 'Kept sentence.');
  assert.equal(lt.hypothesis(2, 'discard me please'), false);
});

test('Esc with changed focus removes nothing', () => {
  const { typer, lt } = mk();
  lt.hypothesis(1, 'abc');
  typer.setForeground({ hwnd: 5 });
  lt.cancelSegment();
  assert.equal(typer.text, 'abc');
});

test('typer refusal (helper saw a different window) halts', () => {
  const { typer, lt } = mk();
  typer.type = () => false;
  assert.equal(lt.hypothesis(1, 'x'), false);
  assert.equal(lt.halted, 'refused');
});

test('trailing space is optional and respects the flush window', () => {
  const { typer, lt } = mk({ trailingSpace: true });
  lt.hypothesis(1, 'Hi'); lt.final(1, 'Hi.');
  lt.end();
  assert.equal(typer.text, 'Hi. ');
});

test('postprocess: fillers, dictionary, snippets, style', () => {
  assert.equal(removeFillers('Um, hello uh world', ['um', 'uh']), 'Hello world');
  assert.equal(clean('I think, hmm, yes.', {}), 'I think, yes.');
  assert.equal(clean('use parakeet flow', { dictionary: [{ from: 'parakeet flow', to: 'Parakeet-Flow' }] }), 'use Parakeet-Flow');
  assert.equal(clean('My email address.', { snippets: [{ trigger: 'my email address', expansion: 'a@b.nl' }] }), 'a@b.nl');
  assert.equal(clean('Send my email address now.', { snippets: [{ trigger: 'my email address', expansion: 'a@b.nl' }] }), 'Send a@b.nl now.');
  assert.equal(clean('Ik ga naar huis.', { style: { casual: true } }), 'ik ga naar huis');
  assert.equal(clean('I am here.', { style: { casual: true } }), 'I am here');
  assert.equal(clean('Mumble', { fillers: ['mum'] }), 'Mumble', 'no partial-word filler removal');
  assert.equal(clean('line\nbreak'), 'line break', 'newlines never typed');
  assert.equal(clean('a (b) [c]', { dictionary: [{ from: '(b)', to: 'X' }] }), 'a X [c]', 'regex metacharacters match literally');
});

test('hotkey fsm: hold, tap, no double-tap, toggle, esc', () => {
  const acts = [];
  const f = new HotkeyFsm({ onAction: (a) => acts.push(a.type + ':' + (a.mode || a.reason)) });
  f.down(0); f.up(1000);
  assert.deepEqual(acts, ['start:hold', 'stop:release']);
  acts.length = 0;
  f.down(2000); f.up(2100);           // tap
  f.down(2300);                        // second tap inside 450 ms: a plain new hold, NOT hands-free
  assert.deepEqual(acts, ['start:hold', 'stop:tap', 'start:hold']);
  f.up(2400);
  acts.length = 0;
  f.down(9000); f.esc();
  assert.deepEqual(acts, ['start:hold', 'cancel:esc']);
  acts.length = 0;
  f.toggle(); f.toggle();
  assert.deepEqual(acts, ['start:hands-free', 'stop:press']);
});

test('deny: own pid, own process, deny words in process or title', () => {
  assert.equal(isDenied({ pid: 5, proc: 'x.exe', title: 'ok' }, { ownPid: 5 }).denied, true);
  assert.equal(isDenied({ pid: 6, proc: '1Password.exe', title: '' }, { ownPid: 5 }).denied, true);
  assert.equal(isDenied({ pid: 6, proc: 'chrome.exe', title: 'Bitwarden Web Vault' }, { ownPid: 5 }).denied, true);
  assert.equal(isDenied({ pid: 6, proc: 'consent.exe', title: '' }, { ownPid: 5 }).denied, true);
  assert.equal(isDenied({ pid: 6, proc: 'LogonUI.exe', title: '' }, { ownPid: 5 }).denied, true);
  assert.equal(isDenied({ pid: 6, proc: 'notepad.exe', title: 'Untitled' }, { ownPid: 5 }).denied, false);
  assert.equal(isDenied(null).denied, true);
});
