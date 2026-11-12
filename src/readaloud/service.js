'use strict';
/* ReadAloud: the whole "read the selection aloud" flow, with every dependency injected so it runs in tests with fakes.
     trigger()   the hotkey: stops a reading in progress, else reads the current selection of the app in front
     stop()      Esc, the same hotkey, the bar's stop button, a dictation starting
     sample()    reads a short fixed line (Settings > Read aloud > Test voice)
   Flow: selection (typer.copySelection: one Ctrl+C, clipboard put back) -> sentence pieces (chunker.js) -> the voice (tts.speak, piece by piece,
   audio streamed to the player as it is made, never more than LOOKAHEAD_SEC ahead of what has played) -> the player says when it has run dry.
   state: 'idle' | 'preparing' | 'reading'.  emits 'state' {state, note?} for the flow bar.
   The text is only ever held in memory; logs get counts. */
const { EventEmitter } = require('events');
const { chunkText } = require('./chunker');
const { sidOf } = require('./voices');

const LOOKAHEAD_SEC = 10;
const SAMPLE_TEXT = 'Hello, this is your voice for reading text aloud.';
const FAIL_NOTE = {
  none: 'Nothing selected to read',
  'clipboard-not-restorable': 'Not read: the clipboard holds data that cannot be put back',
  'clipboard-busy': 'Not read: the clipboard is busy',
  'keys-held': 'Not read: let go of the keys first',
  timeout: 'Not read: the app did not answer',
  'helper-gone': 'Not read: the typing helper is not running',
};

class ReadAloud extends EventEmitter {
  /** getSettings: () => settings; copySelection: () => Promise<{ok,text,reason}>; tts: {speak, cancel}; player: {chunk(gen, f32, rate), end(gen), stop()};
      busy: () => '' | reason text (dictation, meeting); voiceReady: () => bool; poll/now replaceable for tests */
  constructor({ getSettings, copySelection, tts, player, busy = () => '', voiceReady = () => true, log = () => {}, poll = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    super();
    Object.assign(this, { getSettings, copySelection, tts, player, busy, voiceReady, log, poll });
    this.state = 'idle'; this.gen = 0; this.sentSec = 0; this.playedSec = 0; this.finished = null;
  }
  active() { return this.state !== 'idle'; }
  _set(state, note = '') { this.state = state; this.emit('state', { state, note }); }
  _flash(note) { this.emit('state', { state: 'error', note }); }

  /** the hotkey */
  async trigger() {
    if (this.active()) { this.stop(); return { ok: true, stopped: true }; }
    const s = this.getSettings().readAloud;
    if (!s.enabled) return { ok: false, reason: 'off' };
    const why = this.busy();
    if (why) { this._flash(why); return { ok: false, reason: 'busy' }; }
    if (!this.voiceReady()) { this._flash('Voice not downloaded. Open Settings > Read aloud'); return { ok: false, reason: 'no-voice' }; }
    const gen = ++this.gen;
    this._set('preparing');
    const r = await this.copySelection();
    if (gen !== this.gen) return { ok: false, reason: 'stopped' };            // stopped (or replaced) while the selection was being copied
    if (!r.ok) { this._idle(); this._flash(FAIL_NOTE[r.reason] || 'Could not read the selection'); return { ok: false, reason: r.reason }; }
    return this._read(gen, r.text, s);
  }

  /** a fixed line, to hear the voice and speed in Settings. Works even with the switch off */
  async sample() {
    if (this.active()) { this.stop(); return { ok: true, stopped: true }; }
    const why = this.busy();
    if (why) { this._flash(why); return { ok: false, reason: 'busy' }; }
    if (!this.voiceReady()) return { ok: false, reason: 'no-voice' };
    const gen = ++this.gen;
    this._set('preparing');
    return this._read(gen, SAMPLE_TEXT, this.getSettings().readAloud);
  }

  async _read(gen, text, s) {
    const { chunks, truncated, chars } = chunkText(text);
    if (!chunks.length) { this._idle(); this._flash('Nothing to read'); return { ok: false, reason: 'empty' }; }
    this.log('info', `read aloud: ${chars} chars, ${chunks.length} pieces, voice ${s.voice}, speed ${s.speed}`);
    this.sentSec = 0; this.playedSec = 0;
    const sid = sidOf(s.voice);
    const finished = new Promise((res) => { this.finished = res; });
    let first = true, failed = null;
    try {
      for (let i = 0; i < chunks.length; i++) {
        while (gen === this.gen && this.sentSec - this.playedSec > LOOKAHEAD_SEC) await this.poll(100);     // keep memory and CPU small on long text
        if (gen !== this.gen) break;
        await this.tts.speak(chunks[i], {
          sid, speed: s.speed,
          onSamples: (f32, rate) => {
            if (gen !== this.gen) return;
            if (first) { first = false; this._set('reading', truncated ? 'Long text: reading the first part' : ''); }
            this.sentSec += f32.length / rate;
            this.player.chunk(gen, f32, rate);
          },
        });
      }
    } catch (e) { failed = e; }
    if (gen !== this.gen) return { ok: false, reason: 'stopped' };
    if (failed) { this.player.stop(); this._idle(); this.log('error', 'read aloud failed: ' + String(failed.message || failed).slice(0, 120)); this._flash('Could not read aloud: ' + String(failed.message || failed).slice(0, 60)); return { ok: false, reason: 'failed' }; }
    if (first) { this._idle(); this._flash('Nothing to read'); return { ok: false, reason: 'empty' }; }
    this.player.end(gen);                                                       // no more audio: the player reports when it has played the last of it
    await finished;
    if (gen === this.gen) this._idle();
    return { ok: true };
  }

  _idle() { this.state = 'idle'; this.emit('state', { state: 'idle', note: '' }); }

  /** the player reports how much it has played (seconds), and when it has run dry after end() */
  progress(gen, playedSec) { if (gen === this.gen) this.playedSec = playedSec; }
  playerFinished(gen) { if (gen === this.gen && this.finished) { const f = this.finished; this.finished = null; f(); } }

  stop() {
    if (!this.active()) return false;
    this.gen++;                                    // everything still in flight is ignored from now on
    try { this.tts.cancel(); } catch (_) { /* nothing running */ }
    try { this.player.stop(); } catch (_) { /* no player yet */ }
    if (this.finished) { const f = this.finished; this.finished = null; f(); }
    this._idle();
    return true;
  }
}

module.exports = { ReadAloud, LOOKAHEAD_SEC, FAIL_NOTE, SAMPLE_TEXT };
