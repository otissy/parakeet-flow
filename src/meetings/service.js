'use strict';
const fs = require('fs');
const path = require('path');
const { WavWriter } = require('./wav-writer');
const { normalizeTranscript } = require('./transcript');
const { summarizeMeeting } = require('./summary');

const ERROR_LIMIT = 500;
const START_TIMEOUT_MS = 20000;
const STOP_TIMEOUT_MS = 5000;

function message(error) {
  return String(error && error.message || error || 'Unknown meeting error').replace(/[\r\n]/g, ' ').slice(0, ERROR_LIMIT);
}

function samplesFrom(chunk) {
  if (chunk instanceof Float32Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Float32Array(chunk);
  if (ArrayBuffer.isView(chunk) && chunk.byteLength % 4 === 0) {
    return new Float32Array(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
  }
  throw new Error('Meeting audio arrived in an unsupported format');
}

class MeetingService {
  constructor({ store, runtime, userData, getCaptureWindow, getSystemSource, getMicId = () => '', llm, summaryReady = () => false, onChange = () => {}, onProgress = () => {}, onState = () => {} }) {
    Object.assign(this, { store, runtime, getCaptureWindow, getSystemSource, getMicId, llm, summaryReady, onChange, onProgress, onState });
    this.audioDir = path.join(userData, 'meetings', 'audio-staging');
    this.recording = null;
    this.processingId = null;
    this.processingAudioFile = null;
    this.pendingStart = null;
    this.pendingStop = null;
    this.downloading = false;
    this.progress = { phase: 'idle', percent: 0, detail: '' };
    this.setupError = '';
    this.closed = false;
    this.runtime.onProgress = (p) => this._runtimeProgress(p);
    this._cleanStaging();
  }

  _cleanStaging() {
    if (!fs.existsSync(this.audioDir)) return;
    for (const file of fs.readdirSync(this.audioDir)) {
      if (/^[a-f0-9-]{36}\.wav$/i.test(file)) fs.rmSync(path.join(this.audioDir, file), { force: true });
    }
  }

  _changed() { this.onChange(); }

  _state() {
    this.onState({ recordingId: this.recording?.meetingId || null, processingId: this.processingId });
  }

  _runtimeProgress(progress) {
    this.progress = { phase: progress.phase || 'setup', percent: Number(progress.percent) || 0, detail: String(progress.detail || '') };
    this.onProgress({ meetingId: this.recording?.meetingId || this.processingId || null, ...this.progress });
  }

  status() {
    return {
      ...this.runtime.status(),
      downloading: this.downloading,
      progress: { ...this.progress },
      error: this.setupError,
      summaryReady: !!this.summaryReady(),
    };
  }

  async setup() {
    if (this.downloading) throw new Error('Meeting model setup is already running');
    if (this.recording || this.processingId) throw new Error('Finish the current meeting before setting up models');
    this.downloading = true;
    this.setupError = '';
    this.progress = { phase: 'starting', percent: 0, detail: 'Preparing local meeting models' };
    this._runtimeProgress(this.progress);
    try {
      await this.runtime.ensureReady();
      this.progress = { phase: 'ready', percent: 100, detail: 'Meeting models are ready' };
      return this.status();
    } catch (error) {
      this.setupError = message(error);
      this.progress = { phase: 'error', percent: 0, detail: this.setupError };
      throw error;
    } finally {
      this.downloading = false;
      this._runtimeProgress(this.progress);
    }
  }

  async start({ title = '' } = {}) {
    if (this.closed) throw new Error('Meeting capture is unavailable while the app is closing');
    if (this.recording || this.processingId) throw new Error('Finish the current meeting before starting another');
    if (!this.runtime.status().ready) throw new Error('Set up the local meeting models before recording');
    const captureWindow = this.getCaptureWindow();
    if (!captureWindow || captureWindow.isDestroyed()) throw new Error('Meeting audio capture window is unavailable');
    const sourceId = await this.getSystemSource();
    if (!sourceId) throw new Error('No system-audio capture source is available');

    const meeting = this.store.create({ title });
    const audioFile = path.join(this.audioDir, `${meeting.id}.wav`);
    let writer;
    try {
      writer = new WavWriter(audioFile);
      this.recording = { meetingId: meeting.id, audioFile, writer };
      this.pendingStart = {};
      const ready = new Promise((resolve, reject) => {
        this.pendingStart.resolve = resolve;
        this.pendingStart.reject = reject;
        this.pendingStart.timer = setTimeout(() => reject(new Error('Timed out starting microphone and system-audio capture')), START_TIMEOUT_MS);
      });
      captureWindow.webContents.send('meeting:capture-start', { deviceId: this.getMicId(), sourceId });
      this._state();
      await ready;
      return this.store.get(meeting.id);
    } catch (error) {
      if (this.pendingStart?.timer) clearTimeout(this.pendingStart.timer);
      this.pendingStart = null;
      const captureWindow = this.getCaptureWindow();
      if (captureWindow && !captureWindow.isDestroyed()) captureWindow.webContents.send('meeting:capture-stop');
      if (writer) writer.abort();
      this.recording = null;
      fs.rmSync(audioFile, { force: true });
      if (!this.closed) {
        const detail = message(error);
        this.store.update(meeting.id, { status: 'error', captureError: detail });
        this.progress = { phase: 'error', percent: 0, detail };
        this.onProgress({ meetingId: meeting.id, ...this.progress });
      }
      this._changed();
      this._state();
      throw error;
    }
  }

  captureReady() {
    if (!this.pendingStart) return;
    clearTimeout(this.pendingStart.timer);
    const pending = this.pendingStart;
    this.pendingStart = null;
    pending.resolve();
  }

  captureStopped() {
    if (!this.pendingStop) return;
    clearTimeout(this.pendingStop.timer);
    const pending = this.pendingStop;
    this.pendingStop = null;
    pending.resolve();
  }

  audioChunk(chunk) {
    if (!this.recording) return;
    this.recording.writer.write(samplesFrom(chunk));
  }

  async captureError(error) {
    const text = message(error);
    if (this.pendingStart) {
      const pending = this.pendingStart;
      clearTimeout(pending.timer);
      this.pendingStart = null;
      pending.reject(new Error(text));
      return;
    }
    if (this.pendingStop) {
      const pending = this.pendingStop;
      clearTimeout(pending.timer);
      this.pendingStop = null;
      pending.reject(new Error(text));
      return;
    }
    if (!this.recording) return;
    const recording = this.recording;
    this.recording = null;
    const captureWindow = this.getCaptureWindow();
    if (captureWindow && !captureWindow.isDestroyed()) captureWindow.webContents.send('meeting:capture-stop');
    recording.writer.abort();
    fs.rmSync(recording.audioFile, { force: true });
    this.store.update(recording.meetingId, { status: 'error', captureError: text });
    this.progress = { phase: 'error', percent: 0, detail: text };
    this.onProgress({ meetingId: recording.meetingId, ...this.progress });
    this._changed();
    this._state();
  }

  async stop(id) {
    if (!this.recording || this.recording.meetingId !== String(id)) throw new Error('That meeting is not recording');
    const recording = this.recording;
    const captureWindow = this.getCaptureWindow();
    if (!captureWindow || captureWindow.isDestroyed()) {
      const error = new Error('Meeting audio capture window closed unexpectedly');
      await this.captureError(error);
      throw error;
    }
    const stopped = new Promise((resolve, reject) => {
      this.pendingStop = {
        resolve, reject,
        timer: setTimeout(() => reject(new Error('Timed out stopping meeting audio capture')), STOP_TIMEOUT_MS),
      };
    });
    captureWindow.webContents.send('meeting:capture-stop');
    try {
      await stopped;
      recording.writer.finish();
      this.recording = null;
      this.processingId = recording.meetingId;
      this.processingAudioFile = recording.audioFile;
      this.store.update(recording.meetingId, { status: 'processing' });
      this._changed();
      this._state();
      return await this._process(recording);
    } catch (error) {
      if (this.pendingStop?.timer) clearTimeout(this.pendingStop.timer);
      this.pendingStop = null;
      const captureFailed = this.recording === recording;
      if (captureFailed) {
        const activeCapture = this.getCaptureWindow();
        if (activeCapture && !activeCapture.isDestroyed()) activeCapture.webContents.send('meeting:capture-stop');
        recording.writer.abort();
        this.recording = null;
      }
      if (!this.closed) {
        const detail = message(error);
        this.store.update(recording.meetingId, { status: 'error', [captureFailed ? 'captureError' : 'diarizationError']: detail });
        this.progress = { phase: 'error', percent: 0, detail };
        this.onProgress({ meetingId: recording.meetingId, ...this.progress });
      }
      this._changed();
      throw error;
    } finally {
      fs.rmSync(recording.audioFile, { force: true });
      this.processingId = null;
      this.processingAudioFile = null;
      this._changed();
      this._state();
    }
  }

  async _process(recording) {
    const id = recording.meetingId;
    this.progress = { phase: 'transcribing', percent: 2, detail: 'Transcribing and assigning speakers' };
    const raw = await this.runtime.transcribe(recording.audioFile);
    if (this.closed) throw new Error('Meeting processing stopped because the app is closing');
    const segments = normalizeTranscript(raw);
    this.store.update(id, { segments });
    this._changed();
    this.progress = { phase: 'summarizing', percent: 90, detail: 'Creating a local meeting summary' };
    this.onProgress({ meetingId: id, ...this.progress });

    let summary = '', actionItems = [], summaryError = '';
    try {
      const result = await summarizeMeeting(segments, (request) => this.llm.chat(request));
      summary = result.summary;
      actionItems = result.actionItems;
    } catch (error) {
      summaryError = this.summaryReady()
        ? message(error)
        : 'The local AI summary model is not installed. Download it in Settings > AI cleanup, then try again.';
    }
    if (this.closed) throw new Error('Meeting processing stopped because the app is closing');
    const meeting = this.store.update(id, { status: 'complete', summary, actionItems, summaryError });
    this.progress = { phase: 'complete', percent: 100, detail: 'Transcript and summary are ready' };
    this.onProgress({ meetingId: id, ...this.progress });
    this._changed();
    return meeting;
  }

  async summarize(id) {
    const meeting = this.store.get(id);
    if (!meeting) throw new Error('Meeting no longer exists');
    if (!meeting.segments.length) throw new Error('This meeting has no transcript to summarize');
    try {
      const result = await summarizeMeeting(meeting.segments, (request) => this.llm.chat(request));
      const updated = this.store.update(id, { summary: result.summary, actionItems: result.actionItems, summaryError: '' });
      this._changed();
      return updated;
    } catch (error) {
      this.store.update(id, { summaryError: message(error) });
      this._changed();
      throw error;
    }
  }

  update(id, patch) {
    if (this.recording?.meetingId === String(id) || this.processingId === String(id)) throw new Error('A live or processing meeting cannot be edited yet');
    const safe = {};
    for (const key of ['title', 'summary', 'actionItems']) {
      if (Object.prototype.hasOwnProperty.call(patch || {}, key)) safe[key] = patch[key];
    }
    const meeting = this.store.update(id, safe);
    if (!meeting) throw new Error('Meeting no longer exists');
    this._changed();
    return meeting;
  }

  delete(id) {
    if (this.recording?.meetingId === String(id) || this.processingId === String(id)) throw new Error('A live or processing meeting cannot be deleted');
    const deleted = this.store.remove(id);
    if (deleted) this._changed();
    return deleted;
  }

  close() {
    this.closed = true;
    if (this.pendingStart) {
      clearTimeout(this.pendingStart.timer);
      this.pendingStart.reject(new Error('App closed during meeting capture startup'));
      this.pendingStart = null;
    }
    if (this.pendingStop) {
      clearTimeout(this.pendingStop.timer);
      this.pendingStop.reject(new Error('App closed while stopping meeting capture'));
      this.pendingStop = null;
    }
    if (this.recording) {
      const recording = this.recording;
      this.recording = null;
      const captureWindow = this.getCaptureWindow();
      if (captureWindow && !captureWindow.isDestroyed()) captureWindow.webContents.send('meeting:capture-stop');
      recording.writer.abort();
      fs.rmSync(recording.audioFile, { force: true });
      this.store.update(recording.meetingId, { status: 'interrupted', captureError: 'The app closed before recording ended' });
    }
    if (this.processingId) {
      this.store.update(this.processingId, { status: 'interrupted', diarizationError: 'Processing stopped because the app closed' });
      if (this.processingAudioFile) fs.rmSync(this.processingAudioFile, { force: true });
    }
    this.runtime.close();
    this._state();
  }
}

module.exports = { MeetingService, samplesFrom, message, START_TIMEOUT_MS, STOP_TIMEOUT_MS };
