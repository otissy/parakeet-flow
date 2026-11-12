'use strict';
/* Settings for "Read selection aloud": off by default, a chord that may not clash with the dictation keys, a voice and a speed.
     readAloud.enabled  false until the user turns it on (it presses Ctrl+C in the app in front and swaps the clipboard for a moment,
                        and needs a 350 MB voice download, so it is an explicit opt-in)
     readAloud.hotkey   modifiers + exactly one plain key (default Ctrl+Alt+R); the same chord stops the reading, and so does Esc
     readAloud.voice    a Kokoro voice id (voices.js), default bm_george
     readAloud.speed    0.6 .. 1.6 (1 = normal) */
const { isMod } = require('../main/settings-notes');
const { DEFAULT_VOICE, isVoice: isVoiceId } = require('./voices');

const DEFAULT_HOTKEY = { vks: [0x11, 0x12, 0x52], label: 'Ctrl+Alt+R' };
const DEFAULTS = { enabled: false, hotkey: DEFAULT_HOTKEY, voice: DEFAULT_VOICE, speed: 1 };
const SPEED_MIN = 0.6, SPEED_MAX = 1.6;
const family = (v) => (v === 0x10 || v === 0xA0 || v === 0xA1 ? 'shift' : v === 0x11 || v === 0xA2 || v === 0xA3 ? 'ctrl' : v === 0x12 || v === 0xA4 || v === 0xA5 ? 'alt' : 'win');
const plainOf = (vks) => (Array.isArray(vks) ? vks.filter((v) => !isMod(v)) : []);

/** '' when the chord is fine, else why not. others = { hold: vks, note: vks, toggle: vk } of the dictation keys.
    A chord that shares its plain key with a dictation chord is refused whatever its modifiers: Ctrl+Alt+Space would also satisfy Ctrl+Space. */
function readChordError(vks, { hold = [], note = [], toggle = 0 } = {}) {
  if (!Array.isArray(vks) || vks.length < 2 || vks.length > 4) return 'Use at least one modifier plus one key';
  const plain = plainOf(vks), mods = vks.filter(isMod);
  if (plain.length !== 1 || !mods.length) return 'Use at least one modifier (Ctrl, Shift, Alt, Win) plus exactly one other key';
  const k = plain[0];
  if (k === 0x1B || k === 0x08 || k === 0x0D) return 'Esc, Backspace and Enter cannot be used (Esc stops the reading)';
  if (k === 0x2E && new Set(mods.map(family)).has('ctrl') && new Set(mods.map(family)).has('alt')) return 'Ctrl+Alt+Delete is reserved by Windows';
  const clash = (other, what) => { const p = plainOf(other); if (p.length === 1 && p[0] === k) return `That key is also used by the ${what}. Pick another key`; return ''; };
  return clash(hold, 'dictation hotkey') || clash(note, 'note hotkey') || (toggle && toggle === k ? 'That key is the dictation toggle key. Pick another key' : '');
}

/** validate anything coming from disk or the page. others as in readChordError; a chord that clashes goes back to the default,
    and if even the default clashes (the dictation keys were moved onto it) the feature is switched off instead of fighting for a key */
function normReadAloud(r, others = {}) {
  const vks = Array.isArray(r?.hotkey?.vks) ? r.hotkey.vks.map(Number).filter((x) => x > 0 && x < 256).slice(0, 4) : [];
  let hotkey = vks.length && !readChordError(vks, others) ? { vks, label: String(r.hotkey.label || '').slice(0, 40) || DEFAULT_HOTKEY.label } : DEFAULT_HOTKEY;
  let enabled = r?.enabled === true;
  if (readChordError(hotkey.vks, others)) enabled = false;
  const sp = Number(r?.speed);
  return {
    enabled, hotkey,
    voice: isVoiceId(r?.voice) ? r.voice : DEFAULT_VOICE,
    speed: Number.isFinite(sp) ? Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, sp)) * 20) / 20 : 1,
  };
}

module.exports = { DEFAULTS, DEFAULT_HOTKEY, SPEED_MIN, SPEED_MAX, readChordError, normReadAloud };
