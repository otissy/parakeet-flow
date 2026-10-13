'use strict';
/* Two dictation gestures, one state machine. Pure: feed it events with a timestamp, it calls
   onAction({type:'start'|'stop'|'cancel', mode, reason}).
   hold   (Ctrl+Space): down() starts, up() stops. A quick tap (< tapMs) stops without a session.
   toggle (CapsLock):   toggle() starts hands-free, the next toggle() stops.
   Precedence: HOLD WINS. While a hold key is down, toggle() is ignored. Holding during a toggle session
   (state 'toggled') is an overlay: the session keeps running and the hold's release does NOT stop it.
   Esc cancels from anywhere and clears the overlay. */
class HotkeyFsm {
  constructor({ tapMs = 250, onAction = () => {} } = {}) {
    Object.assign(this, { tapMs, onAction });
    this.state = 'idle'; // idle | holding | toggled
    this.overlay = false; // hold key is down on top of a toggle session
    this.downAt = 0;
  }
  get active() { return this.state !== 'idle'; }

  down(t) {
    if (this.state === 'idle') {
      this.state = 'holding'; this.downAt = t;
      return this.onAction({ type: 'start', mode: 'hold' });
    }
    if (this.state === 'toggled') this.overlay = true;     // hold wins over the toggle session, without stopping it
  }

  up(t) {
    if (this.overlay) { this.overlay = false; return; }    // releasing the overlay never stops the toggle session
    if (this.state !== 'holding') return;
    this.state = 'idle';
    const tap = t - this.downAt < this.tapMs;
    this.onAction({ type: 'stop', reason: tap ? 'tap' : 'release', tap });
  }

  /** the CapsLock press: start hands-free, or stop it. Ignored while a hold key is down. */
  toggle() {
    if (this.state === 'holding' || this.overlay) return;
    if (this.state === 'idle') { this.state = 'toggled'; return this.onAction({ type: 'start', mode: 'hands-free' }); }
    this.state = 'idle';
    this.onAction({ type: 'stop', reason: 'press' });
  }

  esc() {
    if (this.state === 'idle') return;
    this.state = 'idle'; this.overlay = false;
    this.onAction({ type: 'cancel', reason: 'esc' });
  }

  /** the session ended for another reason (focus change, error): back to idle without an action */
  reset() { this.state = 'idle'; this.overlay = false; }
}

module.exports = { HotkeyFsm };
