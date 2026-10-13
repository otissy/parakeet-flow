'use strict';
/* DictationSession + LiveTyper + MemoryTyper with a scripted ASR host: the whole typing module, no models. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { DictationSession } = require(path.join(root, 'src/core/session.js'));
const { MemoryTyper, replay } = require(path.join(root, 'src/typer/typer.js'));
const { FakeHost } = require(path.join(root, '.tests/asr/fakes.js'));

const mk = (settings = {}) => {
  const host = new FakeHost();
  const typer = new MemoryTyper({ pid: 77 });
  let t = 1000;
  const s = new DictationSession({ asr: host, typer, settings, now: () => t, ownPid: 1 });
  const results = [];
  s.on('result', (r) => results.push(r));
  return { host, typer, s, results, adv: (ms) => { t += ms; } };
};

test('full utterance: partials typed live, correction in place, final settles clean text', () => {
  const { host, typer, s, results } = mk({ fillers: ['um'] });
  s.start();
  host.emitEv('partial', { segId: 1, text: 'Um so I think' });
  assert.equal(typer.text, 'Um so I think');
  host.emitEv('partial', { segId: 1, text: 'Um so I think we should' });
  host.emitEv('final', { segId: 1, text: 'Um so I think we should go.', reason: 'pause' });
  assert.equal(typer.text, 'So I think we should go.');
  host.emitEv('partial', { segId: 2, text: 'Tomorrow' });
  host.emitEv('final', { segId: 2, text: 'Tomorrow morning.', reason: 'release' });
  s.release();
  host.emitEv('done', {});
  assert.equal(typer.text, 'So I think we should go. Tomorrow morning.');
  assert.equal(replay(typer.log), typer.text);
  assert.equal(results.length, 1);
  assert.equal(results[0].text, 'So I think we should go. Tomorrow morning.');
});

test('events of a previous session (other sid) are ignored', () => {
  const { host, typer, s } = mk();
  s.start();
  host.emit('partial', { sid: 99, segId: 1, text: 'stale' });
  assert.equal(typer.text, '');
});

test('Esc: segment text removed, ASR cancelled, result flagged cancelled, later events ignored', () => {
  const { host, typer, s, results } = mk();
  s.start();
  host.emitEv('partial', { segId: 1, text: 'hello there' });
  s.cancel();
  assert.equal(typer.text, '');
  assert.ok(host.calls.includes('cancel'));
  host.emitEv('final', { segId: 1, text: 'hello there.' });
  assert.equal(typer.text, '');
  assert.equal(results[0].cancelled, true);
});

test('release then a final inside the flush window is typed; one after it is not', () => {
  const { host, typer, s, adv, results } = mk();
  s.start();
  host.emitEv('partial', { segId: 1, text: 'one two' });
  s.release();
  adv(1000);
  host.emitEv('final', { segId: 1, text: 'One two.' });
  assert.equal(typer.text, 'One two.');
  const late = mk();
  late.s.start();
  late.host.emitEv('partial', { segId: 1, text: 'one two' });
  late.s.release();
  late.adv(1600);
  late.host.emitEv('final', { segId: 1, text: 'One two.' });
  assert.equal(late.typer.text, 'one two', 'nothing typed after the flush window');
  late.host.emitEv('done', {});
  assert.equal(late.results[0].text, 'One two.', 'late final still reaches history/UI');
});

test('deny-listed foreground: session transcribes, types nothing', () => {
  const host = new FakeHost();
  const typer = new MemoryTyper({ proc: '1Password.exe', pid: 5 });
  const s = new DictationSession({ asr: host, typer, ownPid: 1 });
  const out = [];
  s.on('partial', (e) => out.push(e.text));
  assert.equal(s.start(), false);
  host.emitEv('partial', { segId: 1, text: 'hunter2' });
  assert.equal(typer.log.length, 0);
  assert.deepEqual(out, ['hunter2']);
});

test('dictionary + snippets applied to finals only, partials stay raw', () => {
  const { host, typer, s } = mk({ dictionary: [{ from: 'kubernetes', to: 'Kubernetes' }], snippets: [{ trigger: 'sign off', expansion: 'Kind regards, Otis' }] });
  s.start();
  host.emitEv('partial', { segId: 1, text: 'deploy kubernetes' });
  assert.equal(typer.text, 'deploy kubernetes');
  host.emitEv('final', { segId: 1, text: 'Deploy kubernetes.' });
  assert.equal(typer.text, 'Deploy Kubernetes.');
  host.emitEv('partial', { segId: 2, text: 'sign off' });
  host.emitEv('final', { segId: 2, text: 'Sign off.' });
  assert.equal(typer.text, 'Deploy Kubernetes. Kind regards, Otis');
});

test('typing stats: corrections never exceed the cap, no ops after flush', () => {
  const { host, s, results } = mk();
  s.start();
  host.emitEv('partial', { segId: 1, text: 'abc def ghi' });
  host.emitEv('partial', { segId: 1, text: 'abc dxf ghi jkl' });
  host.emitEv('final', { segId: 1, text: 'Abc dxf ghi jkl.' });
  s.release(); host.emitEv('done', {});
  assert.ok(results[0].stats.maxBackspace <= 40);
  assert.equal(results[0].stats.typedAfterFlush, 0);
});
