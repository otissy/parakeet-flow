'use strict';
/* Hold-to-talk / toggle / double-tap hands-free state machine. Pure: feed it key events with a
   timestamp, it calls onAction({type:'start'|'stop'|'cancel', mode, reason}).
   mode 'hold':   press starts, release stops. A quick tap (< tapMs) stops without a session; a second
                  tap within doubleTapMs starts hands-free.
   mode 'toggle': press starts, next press stops.
   hands-free:    stays on until the next press (or Esc). */
class HotkeyFsm {
  constructor({ mode = 'hold', tapMs = 250, doubleTapMs = 450, onAction = () => {} } = {}) {
    Object.assign(this, { mode, tapMs, doubleTapMs, onAction });
    this.state = 'idle'; // idle | holding | handsfree | toggled
    this.downAt = 0; this.lastTapAt = -1e9;
  }
  get active() { return this.state !== 'idle'; }

  down(t) {
    if (this.state === 'idle') {
      if (t - this.lastTapAt <= this.doubleTapMs) {
        this.state = 'handsfree'; this.lastTapAt = -1e9;
        return this.onAction({ type: 'start', mode: 'hands-free' });
      }
      this.downAt = t;
      if (this.mode === 'toggle') { this.state = 'toggled'; return this.onAction({ type: 'start', mode: 'toggle' }); }
      this.state = 'holding';
      return this.onAction({ type: 'start', mode: 'hold' });
    }
    if (this.state === 'handsfree' || this.state === 'toggled') {
      this.state = 'idle';
      return this.onAction({ type: 'stop', reason: 'press' });
    }
  }

  up(t) {
    if (this.state !== 'holding') return;
    this.state = 'idle';
    const tap = t - this.downAt < this.tapMs;
    if (tap) this.lastTapAt = t;
    this.onAction({ type: 'stop', reason: tap ? 'tap' : 'release', tap });
  }

  esc() {
    if (this.state === 'idle') return;
    this.state = 'idle';
    this.onAction({ type: 'cancel', reason: 'esc' });
  }

  /** the session ended for another reason (focus change, error): back to idle without an action */
  reset() { this.state = 'idle'; this.lastTapAt = -1e9; }
}

module.exports = { HotkeyFsm };
