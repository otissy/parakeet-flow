'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MeetingStore } = require('../../src/meetings/store');
const { WavWriter } = require('../../src/meetings/wav-writer');
const { normalizeTranscript } = require('../../src/meetings/transcript');
const { parseSummary, transcriptChunks, summarizeMeeting } = require('../../src/meetings/summary');
const { MeetingService } = require('../../src/meetings/service');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'parakeet-meetings-test-')); }

test('meeting store creates local records and marks unfinished meetings interrupted on restart', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'meetings.json');
  const store = new MeetingStore(file, { now: () => 1000, genId: () => '12345678-1234-4234-8234-123456789abc' });
  const meeting = store.create({ title: '  Weekly\u0000 sync  ' });
  store.appendSegment(meeting.id, { start: -1, end: 0.8, speaker: 'Speaker 1', text: 'Discuss roadmap' });
  assert.equal(store.get(meeting.id).title, 'Weekly sync');
  assert.deepEqual(store.get(meeting.id).segments[0], {
    id: store.get(meeting.id).segments[0].id, start: 0, end: 0.8, speaker: 'Speaker 1', text: 'Discuss roadmap',
  });
  const restarted = new MeetingStore(file);
  assert.equal(restarted.get(meeting.id).status, 'interrupted');
});

test('WAV writer emits mono 16 kHz PCM16 and closes with a valid data length', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'audio.wav');
  const writer = new WavWriter(file);
  writer.write(new Float32Array([-1, -0.5, 0, 0.5, 1]));
  writer.finish();
  const wav = fs.readFileSync(file);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(40), 10);
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => wav.readInt16LE(44 + i * 2)), [-32768, -16384, 0, 16384, 32767]);
});

test('NeMo transcript parser groups timed words by speaker and keeps punctuation attached', () => {
  const segments = normalizeTranscript({
    text: 'Hello there. Yes!',
    words: [
      { text: 'Hello', start: 0, end: 0.4, speaker: 1 },
      { text: 'there', start: 0.42, end: 0.7, speaker: 1 },
      { text: '.', start: 0.7, end: 0.72, speaker: 1 },
      { text: 'Yes', start: 1.2, end: 1.5, speaker: 2 },
      { text: '!', start: 1.5, end: 1.52, speaker: 2 },
    ],
  });
  assert.deepEqual(segments.map((segment) => [segment.speaker, segment.text]), [
    ['Speaker 1', 'Hello there.'], ['Speaker 2', 'Yes!'],
  ]);
  assert.equal(normalizeTranscript({ words: [{ text: 'Again', start: 2, end: 2.2, speaker: 'speaker_1' }] })[0].speaker, 'Speaker 1');
});

test('summary parser validates the local model response and transcript is chunked at segment boundaries', async () => {
  assert.deepEqual(parseSummary('```json\n{"summary":"Reviewed the launch plan.","actionItems":["Send the draft"]}\n```'), {
    summary: 'Reviewed the launch plan.', actionItems: ['Send the draft'],
  });
  assert.throws(() => parseSummary('not json'), /valid JSON/);
  const segments = Array.from({ length: 3 }, (_, i) => ({ speaker: 'Speaker 1', text: `${i}`.repeat(3000) }));
  assert.equal(transcriptChunks(segments).length, 3);
  const calls = [];
  const result = await summarizeMeeting([{ speaker: 'Speaker 1', text: 'Send the launch draft.' }], async (request) => {
    calls.push(request);
    return '{"summary":"Launch draft discussed.","actionItems":["Send the launch draft"]}';
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(result.actionItems, ['Send the launch draft']);

  const actions = await summarizeMeeting([
    { speaker: 'Speaker 1', text: 'Please send the launch draft to the team by Friday.' },
    { speaker: 'Speaker 2', text: 'I will send the draft by Friday.' },
    { speaker: 'Speaker 1', text: 'Morgan will schedule the review meeting on Monday.' },
  ], async () => '{"summary":"The team agreed on two follow-ups.","actionItems":[]}');
  assert.deepEqual(actions.actionItems, [
    'Speaker 2: I will send the draft by Friday.',
    'Speaker 1: Morgan will schedule the review meeting on Monday.',
  ]);
  const declined = await summarizeMeeting(
    [{ speaker: 'Speaker 1', text: 'We will not send the draft.' }],
    async () => '{"summary":"The draft will not be sent.","actionItems":[]}',
  );
  assert.deepEqual(declined.actionItems, []);
});

test('meeting service records, transcribes, summarizes, and removes temporary audio', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let service;
  const capture = {
    isDestroyed: () => false,
    webContents: {
      send(channel) {
        if (channel === 'meeting:capture-start') service.captureReady();
        if (channel === 'meeting:capture-stop') service.captureStopped();
      },
    },
  };
  const runtime = {
    onProgress: null,
    status: () => ({ ready: true, backend: 'cpu' }),
    transcribe: async () => ({ words: [{ text: 'Hello', start: 0, end: 0.5, speaker: 1 }] }),
    close() {},
  };
  const store = new MeetingStore(path.join(dir, 'meetings.json'));
  service = new MeetingService({
    store, runtime, userData: dir, getCaptureWindow: () => capture,
    getSystemSource: async () => 'screen:1', llm: { chat: async () => '{"summary":"A greeting.","actionItems":[]}' },
    summaryReady: () => true,
  });
  const recording = await service.start({ title: 'Demo' });
  service.audioChunk(new Float32Array(512).fill(0.1));
  const completed = await service.stop(recording.id);
  assert.equal(completed.status, 'complete');
  assert.equal(completed.summary, 'A greeting.');
  assert.equal(completed.segments[0].speaker, 'Speaker 1');
  assert.equal(fs.existsSync(path.join(dir, 'meetings', 'audio-staging', `${recording.id}.wav`)), false);
});

test('meeting service reports transcription failures and removes temporary audio', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let service;
  let captureStops = 0;
  const capture = {
    isDestroyed: () => false,
    webContents: {
      send(channel) {
        if (channel === 'meeting:capture-start') service.captureReady();
        if (channel === 'meeting:capture-stop') {
          captureStops += 1;
          service.captureStopped();
        }
      },
    },
  };
  const store = new MeetingStore(path.join(dir, 'meetings.json'));
  service = new MeetingService({
    store,
    runtime: { onProgress: null, status: () => ({ ready: true }), transcribe: async () => { throw new Error('Transcription failed'); }, close() {} },
    userData: dir,
    getCaptureWindow: () => capture,
    getSystemSource: async () => 'screen:1',
  });

  const recording = await service.start({ title: 'Failure case' });
  service.audioChunk(new Float32Array(512).fill(0.1));
  await assert.rejects(service.stop(recording.id), /Transcription failed/);
  assert.equal(store.get(recording.id).status, 'error');
  assert.equal(store.get(recording.id).diarizationError, 'Transcription failed');
  assert.equal(service.progress.phase, 'error');
  assert.equal(captureStops, 1);
  assert.equal(fs.existsSync(path.join(dir, 'meetings', 'audio-staging', `${recording.id}.wav`)), false);
});
