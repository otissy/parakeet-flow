'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STATUSES = new Set(['recording', 'processing', 'complete', 'interrupted', 'error']);
const MAX_TITLE = 160, MAX_SUMMARY = 20000, MAX_ACTIONS = 200, MAX_SEGMENTS = 100000, MAX_SEGMENT_TEXT = 20000;

function text(value, max) {
  return String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

function normalizeSegment(segment) {
  const start = Number(segment?.start), end = Number(segment?.end);
  const safeStart = Number.isFinite(start) ? Math.max(0, start) : 0;
  return {
    id: String(segment?.id || crypto.randomBytes(8).toString('hex')).slice(0, 40),
    start: safeStart,
    end: Number.isFinite(end) ? Math.max(safeStart, end) : safeStart,
    speaker: text(segment?.speaker || 'Unknown speaker', 80),
    text: text(segment?.text, MAX_SEGMENT_TEXT),
  };
}

function normalizeMeeting(meeting) {
  if (!meeting || typeof meeting !== 'object' || !/^[a-f0-9-]{8,40}$/i.test(String(meeting.id || ''))) throw new Error('Invalid meeting record');
  const status = String(meeting.status || 'complete');
  if (!STATUSES.has(status)) throw new Error('Invalid meeting status');
  const segments = Array.isArray(meeting.segments) ? meeting.segments.slice(0, MAX_SEGMENTS).map(normalizeSegment).filter((s) => s.text) : [];
  const actionItems = Array.isArray(meeting.actionItems) ? meeting.actionItems.slice(0, MAX_ACTIONS).map((a) => text(a, 500)).filter(Boolean) : [];
  const createdAt = Number(meeting.createdAt);
  const updatedAt = Number(meeting.updatedAt);
  return {
    id: String(meeting.id),
    title: text(meeting.title, MAX_TITLE) || 'Untitled meeting',
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    status,
    segments,
    summary: text(meeting.summary, MAX_SUMMARY),
    actionItems,
    summaryError: text(meeting.summaryError, 500),
    diarizationError: text(meeting.diarizationError, 500),
    captureError: text(meeting.captureError, 500),
  };
}

class MeetingStore {
  constructor(file, { now = Date.now, genId = () => crypto.randomUUID() } = {}) {
    Object.assign(this, { file, now, genId });
    this.meetings = this._read();
    let interrupted = false;
    for (const meeting of this.meetings) {
      if (meeting.status === 'recording' || meeting.status === 'processing') {
        meeting.status = 'interrupted';
        interrupted = true;
      }
    }
    if (interrupted) this._write();
  }

  _read() {
    let raw;
    try { raw = fs.readFileSync(this.file, 'utf8'); } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Meeting data must be a JSON array');
    return parsed.map(normalizeMeeting).sort((a, b) => b.createdAt - a.createdAt);
  }

  _write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.meetings, null, 1), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) { /* not written */ }
      throw e;
    }
  }

  list() { return this.meetings.map((m) => ({ ...m, segments: m.segments.map((s) => ({ ...s })), actionItems: m.actionItems.slice() })); }
  get(id) { const m = this.meetings.find((x) => x.id === String(id)); return m ? this.list().find((x) => x.id === m.id) : null; }

  create({ title = '', createdAt = this.now() } = {}) {
    const at = Number(createdAt);
    const meeting = normalizeMeeting({
      id: this.genId(), title: text(title, MAX_TITLE) || 'Meeting',
      createdAt: Number.isFinite(at) ? at : this.now(), updatedAt: this.now(),
      status: 'recording', segments: [], summary: '', actionItems: [],
    });
    this.meetings.unshift(meeting);
    this._write();
    return this.get(meeting.id);
  }

  update(id, patch) {
    const meeting = this.meetings.find((x) => x.id === String(id));
    if (!meeting) return null;
    const allowed = ['title', 'status', 'segments', 'summary', 'actionItems', 'summaryError', 'diarizationError', 'captureError'];
    const safe = {};
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(patch || {}, key)) safe[key] = patch[key];
    Object.assign(meeting, normalizeMeeting({ ...meeting, ...safe, updatedAt: this.now() }));
    this._write();
    return this.get(meeting.id);
  }

  appendSegment(id, segment) {
    const meeting = this.meetings.find((x) => x.id === String(id));
    if (!meeting) throw new Error('Meeting no longer exists');
    if (meeting.segments.length >= MAX_SEGMENTS) throw new Error('Meeting transcript reached its segment limit');
    meeting.segments.push(normalizeSegment(segment));
    meeting.updatedAt = this.now();
    this._write();
    return this.get(meeting.id);
  }

  remove(id) {
    const index = this.meetings.findIndex((x) => x.id === String(id));
    if (index < 0) return false;
    this.meetings.splice(index, 1);
    this._write();
    return true;
  }
}

module.exports = { MeetingStore, normalizeMeeting, normalizeSegment, MAX_SEGMENTS };
