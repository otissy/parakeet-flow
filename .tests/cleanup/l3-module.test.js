'use strict';
/* LlmWorker lifecycle (lazy start, idle stop, hard timeout) against a protocol-compatible fake worker, and the
   DictationSession async chain: finals only, in order, partials wait, original typed on any failure. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { LlmWorker, LlmTimeout } = require(path.join(root, 'src/llm/llm-host.js'));
const { LlmService } = require(path.join(root, 'src/llm/cleanup.js'));
const { DictationSession } = require(path.join(root, 'src/core/session.js'));
const { MemoryTyper } = require(path.join(root, 'src/typer/typer.js'));
const { FakeHost } = require(path.join(root, '.tests/asr/fakes.js'));

const FAKE = path.join(__dirname, 'fake-worker.js');
const wk = (behaviour = {}, o = {}) => new LlmWorker({ entry: JSON.stringify(behaviour), modelPath: 'none', workerPath: FAKE, idleMs: 0, ...o });
const msgs = (t) => [{ role: 'system', content: 's' }, { role: 'user', content: '/no_think\n' + t }];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('worker: lazy (nothing runs until the first request), one start for many requests', async () => {
  const w = wk();
  assert.equal(w.status().state, 'stopped'); assert.equal(w.stats.starts, 0);
  assert.equal((await w.chat({ messages: msgs('hello there'), timeoutMs: 3000 })).trim(), 'Hello there.');
  await w.chat({ messages: msgs('again'), timeoutMs: 3000 });
  assert.equal(w.stats.starts, 1); assert.equal(w.status().state, 'ready');
  w.stop();
});

test('worker: stops itself after the idle time and starts again on the next request', async () => {
  const w = wk({}, { idleMs: 200 });
  await w.chat({ messages: msgs('one'), timeoutMs: 3000 });
  assert.equal(w.status().state, 'ready');
  await sleep(450);
  assert.equal(w.status().state, 'stopped', 'idle stop frees the model'); assert.equal(w.worker, null);
  await w.chat({ messages: msgs('two'), timeoutMs: 3000 });
  assert.equal(w.stats.starts, 2); w.stop();
});

test('worker: use keeps it alive (the idle clock restarts on each request)', async () => {
  const w = wk({}, { idleMs: 300 });
  for (let i = 0; i < 4; i++) { await w.chat({ messages: msgs('x' + i), timeoutMs: 3000 }); await sleep(150); }
  assert.equal(w.status().state, 'ready'); assert.equal(w.stats.starts, 1); w.stop();
});

test('worker: the hard timeout covers a slow start AND a slow answer; the caller gets LlmTimeout', async () => {
  let w = wk({ startDelay: 600 });
  const t0 = Date.now();
  await assert.rejects(w.chat({ messages: msgs('hello'), timeoutMs: 150 }), LlmTimeout);
  assert.ok(Date.now() - t0 < 450, 'gave up at the deadline, not at the end of the start-up');
  w.stop();
  w = wk();
  await assert.rejects(w.chat({ messages: msgs('SLOW'), timeoutMs: 200 }), LlmTimeout);
  assert.equal(w.stats.timeouts, 1);
  assert.equal((await w.chat({ messages: msgs('after'), timeoutMs: 3000 })).trim(), 'After.', 'still usable after a timeout');
  w.stop();
});

test('worker: errors reject, a worker that cannot start rejects, nothing hangs', async () => {
  let w = wk();
  await assert.rejects(w.chat({ messages: msgs('BOOM'), timeoutMs: 3000 }), /boom/);
  w.stop(); w = wk({ crashOnStart: true });
  await assert.rejects(w.chat({ messages: msgs('hi'), timeoutMs: 3000 }), /no model|stopped|exited/);
  assert.equal(w.status().state, 'stopped');
});

/* ---------- session with the model in the chain ---------- */
function rig({ behaviour = {}, cleanup = { enabled: true, timeoutMs: 400 }, translate = { enabled: false, target: 'swap' }, commands = null, flush } = {}) {
  const host = new FakeHost(); const typer = new MemoryTyper({ pid: 77 });
  const worker = wk(behaviour);
  const llm = new LlmService({ llm: worker, getSettings: () => ({ cleanup }) });
  const calls = []; const origChat = worker.chat.bind(worker);
  worker.chat = (o) => { calls.push(o.messages.at(-1).content.replace('/no_think\n', '')); return origChat(o); };
  const s = new DictationSession({ asr: host, typer, ownPid: 1, llm, settings: { cleanup, translate, commands, tone: { enabled: false, apps: [] }, ...(flush ? { flushMs: flush } : {}) } });
  const results = []; s.on('result', (r) => results.push(r));
  return { host, typer, s, worker, calls, results };
}

test('session: finals are cleaned by the model, partials never reach it, the original partial text is typed live first', async () => {
  const { host, typer, s, calls, worker, results } = rig();
  s.start();
  host.emitEv('partial', { segId: 1, text: 'hello there' });
  assert.equal(typer.text, 'hello there', 'live partial typed raw, immediately');
  assert.equal(calls.length, 0, 'no model call for a partial');
  host.emitEv('final', { segId: 1, text: 'hello there' });
  s.release(); host.emitEv('done', {});
  await new Promise((r) => s.once('result', r));
  assert.equal(typer.text, 'Hello there.'); assert.equal(calls.length, 1); assert.equal(results[0].text, 'Hello there.');
  worker.stop();
});

test('session: segments stay in order even when an earlier one is slow, and partials wait for the final in flight', async () => {
  const { host, typer, s, worker } = rig({ behaviour: { delay: 120 } });
  s.start();
  host.emitEv('partial', { segId: 1, text: 'first part' });
  host.emitEv('final', { segId: 1, text: 'first part' });
  host.emitEv('partial', { segId: 2, text: 'second' });           // arrives while segment 1 is still with the model
  host.emitEv('final', { segId: 2, text: 'second part' });
  s.release(); host.emitEv('done', {});
  assert.equal(typer.text, 'first part', 'segment 2 is not typed over segment 1');
  await new Promise((r) => s.once('result', r));
  assert.equal(typer.text, 'First part. Second part.');
  worker.stop();
});

test('session: a slow model times out and the ORIGINAL text is typed', async () => {
  const { host, typer, s, worker, results } = rig({ cleanup: { enabled: true, timeoutMs: 150 } });
  s.start(); host.emitEv('partial', { segId: 1, text: 'SLOW one' }); host.emitEv('final', { segId: 1, text: 'SLOW one' });
  s.release(); host.emitEv('done', {});
  await new Promise((r) => s.once('result', r));
  assert.equal(typer.text, 'SLOW one'); assert.equal(results[0].text, 'SLOW one');
  worker.stop();
});

test('session: a model error or a wrong answer types the original', async () => {
  for (const [said, shown] of [['BOOM now', 'BOOM now'], ['WRONG answer here', 'WRONG answer here']]) {
    const { host, typer, s, worker } = rig();
    s.start(); host.emitEv('final', { segId: 1, text: said }); s.release(); host.emitEv('done', {});
    await new Promise((r) => s.once('result', r));
    assert.equal(typer.text, shown); worker.stop();
  }
});

test('session: model switched off = no worker, no call, plain text', async () => {
  const { host, typer, s, calls, worker } = rig({ cleanup: { enabled: false, timeoutMs: 400 } });
  s.start(); host.emitEv('final', { segId: 1, text: 'plain text' }); s.release(); host.emitEv('done', {});
  assert.equal(typer.text, 'plain text'); assert.equal(calls.length, 0); assert.equal(worker.status().state, 'stopped');
});

test('session: commands and notes never go to the model; text around them does', async () => {
  const cmd = { enabled: true, list: require(path.join(root, 'src/core/commands.js')).DEFAULT_COMMANDS, notes: { enabled: true, triggers: ['note to self'] } };
  const { host, typer, s, calls, worker } = rig({ commands: cmd });
  const notes = []; s.on('note', (n) => notes.push(n.text));
  s.start();
  host.emitEv('final', { segId: 1, text: 'keep this one' });
  host.emitEv('final', { segId: 2, text: 'Note to self, call the bank.' });
  host.emitEv('final', { segId: 3, text: 'and this one' });
  host.emitEv('final', { segId: 4, text: 'Delete that.' });
  s.release(); host.emitEv('done', {});
  await new Promise((r) => s.once('result', r));
  assert.deepEqual(calls, ['keep this one', 'and this one']);
  assert.deepEqual(notes, ['Call the bank.']);
  assert.equal(typer.text, 'Keep this one.');
  worker.stop();
});

test('session: Esc during a model call types nothing afterwards', async () => {
  const { host, typer, s, worker } = rig({ behaviour: { delay: 150 } });
  s.start(); host.emitEv('partial', { segId: 1, text: 'abc' }); host.emitEv('final', { segId: 1, text: 'abc' });
  s.cancel();
  await sleep(300);
  assert.equal(typer.text, ''); worker.stop();
});

test('session: translate goes through the same chain with its own timeout floor', async () => {
  const { host, typer, s, worker } = rig({ translate: { enabled: true, target: 'swap' }, cleanup: { enabled: false, timeoutMs: 400 } });
  s.start(); host.emitEv('final', { segId: 1, text: 'Ik denk dat we morgen om tien uur moeten afspreken' }); s.release(); host.emitEv('done', {});
  await new Promise((r) => s.once('result', r));
  // the fake "translation" is the sentence itself, which the translation guard rejects as unchanged: the original is typed
  assert.equal(typer.text, 'Ik denk dat we morgen om tien uur moeten afspreken');
  worker.stop();
});
