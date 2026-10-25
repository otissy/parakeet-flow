// Pure helpers shared by the app page and the tests (browser global `PFLib` or CommonJS).
(function (root) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const NAMES = {
    0x13: 'Pause', 0x91: 'Scroll Lock', 0x14: 'CapsLock', 0x20: 'Space', 0x2D: 'Insert', 0x2E: 'Delete', 0x24: 'Home', 0x23: 'End',
    0x21: 'Page Up', 0x22: 'Page Down', 0x25: '←', 0x26: '↑', 0x27: '→', 0x28: '↓', 0x09: 'Tab', 0xC0: '`', 0x5D: 'Menu', 0x2C: 'Print Screen',
    0x10: 'Shift', 0x11: 'Ctrl', 0x12: 'Alt',
    0xA0: 'Left Shift', 0xA1: 'Right Shift', 0xA2: 'Left Ctrl', 0xA3: 'Right Ctrl', 0xA4: 'Left Alt', 0xA5: 'Right Alt', 0x5B: 'Left Win', 0x5C: 'Right Win',
  };
  function codeToVk(code) {
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1].charCodeAt(0);
    if ((m = /^Digit([0-9])$/.exec(code))) return 0x30 + Number(m[1]);
    if ((m = /^F(\d{1,2})$/.exec(code)) && +m[1] >= 1 && +m[1] <= 24) return 0x70 + Number(m[1]) - 1;
    if ((m = /^Numpad([0-9])$/.exec(code))) return 0x60 + Number(m[1]);
    const t = { ControlLeft: 0xA2, ControlRight: 0xA3, ShiftLeft: 0xA0, ShiftRight: 0xA1, AltLeft: 0xA4, AltRight: 0xA5, MetaLeft: 0x5B, MetaRight: 0x5C,
      Pause: 0x13, ScrollLock: 0x91, CapsLock: 0x14, Space: 0x20, Insert: 0x2D, Delete: 0x2E, Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22,
      ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28, Tab: 0x09, Backquote: 0xC0, ContextMenu: 0x5D, PrintScreen: 0x2C,
      Escape: 0x1B, Backspace: 0x08, Enter: 0x0D };
    return t[code] || 0;
  }
  function vkLabel(vk) {
    if (NAMES[vk]) return NAMES[vk];
    if (vk >= 0x41 && vk <= 0x5A) return String.fromCharCode(vk);
    if (vk >= 0x30 && vk <= 0x39) return String.fromCharCode(vk);
    if (vk >= 0x70 && vk <= 0x87) return 'F' + (vk - 0x6F);
    if (vk >= 0x60 && vk <= 0x69) return 'Num ' + (vk - 0x60);
    return '0x' + vk.toString(16);
  }
  const isModifier = (vk) => vk === 0x10 || vk === 0x11 || vk === 0x12 || (vk >= 0xA0 && vk <= 0xA5) || vk === 0x5B || vk === 0x5C;
  /** a hold-to-talk key must not break normal typing and must not eat Esc / Backspace / Enter */
  function validateHotkey(vks) {
    if (!vks.length) return 'Press at least one key.';
    if (vks.some((v) => v === 0x1B || v === 0x08 || v === 0x0D)) return 'Esc, Backspace and Enter cannot be used.';
    const plain = vks.filter((v) => !isModifier(v));
    if (vks.length === 1 && ((vks[0] >= 0x41 && vks[0] <= 0x5A) || (vks[0] >= 0x30 && vks[0] <= 0x39) || vks[0] === 0x20))
      return 'A letter, digit or Space on its own would trigger while you type. Add Ctrl/Alt or pick another key.';
    if (plain.length > 1) return 'Use at most one non-modifier key.';
    return '';
  }
  /** the toggle gesture is ONE key (CapsLock by default); a plain letter would trigger while typing, and it must differ from the hold chord */
  function validateToggleKey(vks, holdVks = []) {
    if (vks.length !== 1) return 'Pick exactly one key for the toggle.';
    const v = vks[0];
    if (v === 0x1B || v === 0x08 || v === 0x0D) return 'Esc, Backspace and Enter cannot be used.';
    if (isModifier(v)) return 'A modifier on its own cannot be the toggle.';
    if ((v >= 0x41 && v <= 0x5A) || (v >= 0x30 && v <= 0x39) || v === 0x20) return 'A letter, digit or Space on its own would trigger while you type. Pick another key, such as CapsLock or F9.';
    if (holdVks.includes(v)) return 'That key is already part of the hold hotkey.';
    return '';
  }
  const hotkeyLabel = (vks) => vks.map(vkLabel).join(' + ');

  function greeting(hour, name) {
    const g = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    return name ? `${g}, ${name}` : g;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  function dayLabel(ts, now = new Date()) {
    const d = new Date(ts), a = new Date(d.getFullYear(), d.getMonth(), d.getDate()), b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((b - a) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  /** [{label, items:[entry]}] newest first, grouped by calendar day */
  function groupByDay(history, now = new Date()) {
    const groups = [];
    for (const e of [...history].sort((x, y) => y.ts - x.ts)) {
      const label = dayLabel(e.ts, now);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(e); else groups.push({ label, items: [e] });
    }
    return groups;
  }

  /** selected transcript text -> what to prefill as a dictionary word: whitespace collapsed, punctuation trimmed from both
      ends ("riz," -> "riz", "(no cap)." -> "no cap"); capped at 200 characters (the service gives the real length error) */
  function cleanPick(text) {
    return String(text ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ')
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').slice(0, 200).trim();
  }
  /** the distinct words of a line, in order, for the quick-add word buttons (letters/digits, inner ' and -), at most `max` */
  function wordsOf(text, max = 40) {
    const out = [], seen = new Set();
    for (const m of String(text ?? '').matchAll(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)) {
      const w = m[0], k = w.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); out.push(w);
      if (out.length >= max) break;
    }
    return out;
  }

  const api = { esc, codeToVk, vkLabel, isModifier, validateHotkey, validateToggleKey, hotkeyLabel, greeting, fmtTime, dayLabel, groupByDay, cleanPick, wordsOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PFLib = api;
})(typeof window !== 'undefined' ? window : globalThis);
