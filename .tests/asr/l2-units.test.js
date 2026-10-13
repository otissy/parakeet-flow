'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mkSegmenter, FakeEngine, loud, quiet } = require('./fakes');

const names = (ev) => ev.map((e) => e.ev);

test('speech then pause: segment-start, partials, one final (pause), endpoint', () => {
  const { seg, events, push } = mkSegmenter();
  seg.start();
  for (let i = 0; i < 40; i++) push(loud());     // 1.3 s of speech
  for (let i = 0; i < 20; i++) push(quiet());    // pause
  const n = names(events);
  assert.equal(n[0], 'segment-start');
  assert.ok(n.includes('partial'));
  assert.equal(n.filter((x) => x === 'final').length, 1);
  assert.ok(n.indexOf('partial') < n.indexOf('final'), 'partials come before the final');
  assert.equal(events.find((e) => e.ev === 'final').reason, 'pause');
  assert.equal(n.at(-1), 'endpoint');
});

test('a second burst is a NEW segment; the first final is never re-emitted', () => {
  const { seg, events, push } = mkSegmenter();
  seg.start();
  for (let i = 0; i < 40; i++) push(loud());
  for (let i = 0; i < 20; i++) push(quiet());
  for (let i = 0; i < 40; i++) push(loud());
  for (let i = 0; i < 20; i++) push(quiet());
  const finals = events.filter((e) => e.ev === 'final');
  assert.deepEqual(finals.map((f) => f.segId), [1, 2]);
  assert.equal(events.filter((e) => e.ev === 'partial' && e.segId === 1).length > 0, true);
  const lastP1 = events.findLastIndex((e) => e.ev === 'partial' && e.segId === 1);
  const fin1 = events.findIndex((e) => e.ev === 'final' && e.segId === 1);
  assert.ok(lastP1 < fin1, 'no partial for segment 1 after its final');
});

test('release mid-speech finalises (reason release), then done', () => {
  const { seg, events, push } = mkSegmenter();
  seg.start();
  for (let i = 0; i < 30; i++) push(loud());
  seg.release();
  const f = events.find((e) => e.ev === 'final');
  assert.equal(f.reason, 'release');
  assert.equal(events.at(-1).ev, 'done');
});

test('release while idle: only done', () => {
  const { seg, events } = mkSegmenter();
  seg.start(); seg.release();
  assert.deepEqual(names(events), ['done']);
});

test('cap: continuous speech past capSec is cut into immutable segments', () => {
  const { seg, events, push } = mkSegmenter({ capSec: 3, softCapSec: 99 });
  seg.start();
  for (let i = 0; i < 300; i++) push(loud());    // 9.6 s
  const caps = events.filter((e) => e.ev === 'final' && e.reason === 'cap');
  assert.ok(caps.length >= 2, `expected >=2 cap finals, got ${caps.length}`);
  assert.ok(caps.every((c) => c.audioSec <= 3.2));
});

test('soft cap cuts at a quiet moment before the hard cap', () => {
  const { seg, events, push } = mkSegmenter({ capSec: 9, softCapSec: 2 });
  seg.start();
  for (let i = 0; i < 70; i++) push(loud());     // 2.2 s
  for (let i = 0; i < 6; i++) push(quiet());     // short dip, VAD still holds the segment
  const f = events.find((e) => e.ev === 'final');
  assert.ok(f && f.reason === 'cap');
  assert.ok(f.audioSec < 4);
});

test('no new audio -> no repeated partial decode', () => {
  const engine = new FakeEngine();
  const { seg, push } = mkSegmenter({ engine });
  seg.start();
  seg.partialIntervalMs = 0;
  let guard = 0;
  while (engine.calls === 0 && guard++ < 100) push(loud());      // run until the first decode just happened
  const calls = engine.calls;
  assert.ok(calls >= 1);
  seg.pushAudio(new Float32Array(16).fill(0.3));                 // 1 ms of audio: below minNewAudio
  assert.equal(engine.calls, calls);
});

test('audio before start() and after cancel() is ignored; cancel emits nothing', () => {
  const { seg, events, push } = mkSegmenter();
  push(loud());
  seg.start();
  for (let i = 0; i < 30; i++) push(loud());
  const before = events.length;
  seg.cancel();
  push(loud());
  assert.equal(events.length, before);
});

test('empty decode result emits no final, still an endpoint', () => {
  const engine = { decode: () => ({ text: '', ms: 1 }) };
  const { seg, events, push } = mkSegmenter({ engine });
  seg.start();
  for (let i = 0; i < 40; i++) push(loud());
  for (let i = 0; i < 20; i++) push(quiet());
  assert.equal(events.filter((e) => e.ev === 'final').length, 0);
  assert.equal(events.filter((e) => e.ev === 'endpoint').length, 1);
});
