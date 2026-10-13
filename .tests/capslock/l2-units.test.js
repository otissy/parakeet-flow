'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const root = path.join(__dirname, '..', '..');
const { HotkeyFsm } = require(path.join(root, 'src/core/hotkey-fsm.js'));
const { Store, DEFAULTS, normalize } = require(path.join(root, 'src/main/settings.js'));
const { Controller } = require(path.join(root, 'src/main/controller.js'));
const L = require(path.join(root, 'src/renderer/lib.js'));

function fsm() { const acts = []; const f = new HotkeyFsm({ onAction: (a) => acts.push(a.type + ':' + (a.mode || a.reason)) }); return { f, acts }; }

test('fsm: toggle starts hands-free, next toggle stops', () => {
  const { f, acts } = fsm(); f.toggle(); assert.equal(f.active, true); f.toggle();
  assert.deepEqual(acts, ['start:hands-free', 'stop:press']); assert.equal(f.active, false);
});

test('fsm precedence 1: toggle presses are ignored while the hold key is down; hold release stops as usual', () => {
  const { f, acts } = fsm(); f.down(0); f.toggle(); f.toggle(); f.up(1000);
  assert.deepEqual(acts, ['start:hold', 'stop:release']);
});

test('fsm precedence 2: holding during a toggle session wins, and its release does NOT stop the session', () => {
  const { f, acts } = fsm(); f.toggle(); f.down(100); f.up(2000);
  assert.deepEqual(acts, ['start:hands-free']); assert.equal(f.active, true);
  f.up(2100);                                   // a stray second release changes nothing
  assert.equal(f.active, true);
  f.toggle(); assert.deepEqual(acts, ['start:hands-free', 'stop:press']);
});

test('fsm precedence 3: a quick tap on the hold key during a toggle session does not stop it either', () => {
  const { f, acts } = fsm(); f.toggle(); f.down(10); f.up(60);
  assert.deepEqual(acts, ['start:hands-free']);
});

test('fsm precedence 4: toggle press while the overlay is down is ignored (hold wins), works again after release', () => {
  const { f, acts } = fsm(); f.toggle(); f.down(10); f.toggle(); assert.deepEqual(acts, ['start:hands-free']);
  f.up(900); f.toggle(); assert.deepEqual(acts, ['start:hands-free', 'stop:press']);
});

test('fsm: Esc cancels a toggle session and clears the overlay; the late hold release is a no-op', () => {
  const { f, acts } = fsm(); f.toggle(); f.down(10); f.esc(); f.up(500);
  assert.deepEqual(acts, ['start:hands-free', 'cancel:esc']); assert.equal(f.active, false);
  f.toggle(); assert.equal(acts.at(-1), 'start:hands-free', 'toggle works right after');
});

test('fsm: reset (session ended elsewhere) clears everything', () => {
  const { f, acts } = fsm(); f.toggle(); f.down(1); f.reset(); f.up(5);
  assert.deepEqual(acts, ['start:hands-free']); assert.equal(f.active, false);
});

test('fsm: no double-tap gesture: two quick taps are two lone taps', () => {
  const { f, acts } = fsm(); f.down(0); f.up(50); f.down(100); f.up(150);
  assert.deepEqual(acts, ['start:hold', 'stop:tap', 'start:hold', 'stop:tap']);
});

test('settings defaults: CapsLock toggle on, one key', () => {
  assert.equal(DEFAULTS.toggleOn, true); assert.deepEqual(DEFAULTS.toggleKey.vks, [0x14]); assert.equal(DEFAULTS.toggleKey.label, 'CapsLock');
  assert.equal('mode' in DEFAULTS, false);
  const n = normalize({ toggleKey: { vks: [0x11] } }); assert.deepEqual(n.toggleKey.vks, [0x14], 'a modifier cannot be the toggle');
  assert.deepEqual(normalize({ toggleKey: { vks: [0x14, 0x20] } }).toggleKey.vks, [0x14], 'two keys: fallback');
  assert.deepEqual(normalize({ toggleKey: { vks: [0x78], label: 'F9' } }).toggleKey, { vks: [0x78], label: 'F9' });
  assert.equal(normalize({ toggleOn: false }).toggleOn, false); assert.equal(normalize({}).toggleOn, true);
});

function migrate(raw) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-caps-mig-'));
  if (raw) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(raw));
  const s = new Store(dir); const file = path.join(dir, 'settings.json');
  return { s, dir, disk: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}

test('migration: old toggle mode -> CapsLock toggle, hold back on its default, once', () => {
  const { s, dir, disk } = migrate({ hotkeyV: 2, hotkey: { vks: [0x78], label: 'F9' }, mode: 'toggle' });
  assert.deepEqual(s.get().toggleKey.vks, [0x14]); assert.equal(s.get().toggleOn, true);
  assert.deepEqual(s.get().hotkey.vks, [0x11, 0x20], 'the old toggle hotkey became CapsLock, hold is the default'); assert.equal('mode' in s.get(), false);
  assert.equal(disk().gestureV, 3, 'written back');
  s.set({ toggleKey: { vks: [0x78], label: 'F9' }, hotkey: { vks: [0x13], label: 'Pause' } });
  const again = new Store(dir).get();
  assert.deepEqual(again.toggleKey.vks, [0x78], 'a key picked afterwards is kept, never re-migrated'); assert.deepEqual(again.hotkey.vks, [0x13]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration: old hold mode (with the double-tap) keeps the hold hotkey, drops mode', () => {
  const { s, dir, disk } = migrate({ hotkeyV: 2, hotkey: { vks: [0xA3, 0x4B], label: 'Right Ctrl + K' }, mode: 'hold', historyEnabled: true });
  assert.deepEqual(s.get().hotkey.vks, [0xA3, 0x4B]); assert.equal(s.get().historyEnabled, true); assert.equal('mode' in disk(), false);
  assert.deepEqual(s.get().toggleKey.vks, [0x14]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration: fresh install writes nothing, gets defaults', () => {
  const { s, dir } = migrate(null);
  assert.equal(fs.existsSync(path.join(dir, 'settings.json')), false); assert.equal(s.get().toggleOn, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration: a user who switched the toggle off after migrating stays off', () => {
  const { s, dir } = migrate({ hotkeyV: 2, mode: 'toggle' });
  s.set({ toggleOn: false });
  assert.equal(new Store(dir).get().toggleOn, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('picker validation: toggle takes one non-modifier key, not a letter, not the hold chord key', () => {
  assert.equal(L.validateToggleKey([0x14]), ''); assert.equal(L.validateToggleKey([0x78]), '');
  for (const bad of [[], [0x11, 0x14], [0x11], [0x41], [0x20], [0x1B]]) assert.notEqual(L.validateToggleKey(bad), '', JSON.stringify(bad));
  assert.notEqual(L.validateToggleKey([0x78], [0x11, 0x78]), '');
  assert.equal(L.vkLabel(0x14), 'CapsLock');
});

function claimRig(settings) {
  const typer = new EventEmitter(); const log = { claim: [], tk: [] };
  Object.assign(typer, { setClaim: (on) => log.claim.push(on), setToggleKey: (vk) => log.tk.push(vk), foreground: () => ({ hwnd: 1, pid: 5, proc: 'x.exe' }) });
  const st = { toggleOn: true, toggleKey: { vks: [0x14] }, whisper: {}, translate: {}, cleanup: {}, ...settings };
  const c = new Controller({ getAsr: () => null, typer, store: { get: () => st }, mic: {} });
  return { c, typer, log, st };
}

test('controller: CapsLock is claimed only while enabled, not in a picker, and the switch is on', () => {
  const { c, log, st } = claimRig(); c.attach();
  assert.deepEqual(log.tk, [0x14]);
  c.setEnabled(false); assert.equal(log.tk.at(-1), 0, 'paused in the tray: CapsLock normal at once');
  c.setEnabled(true); assert.equal(log.tk.at(-1), 0x14);
  c.setCapturing(true); assert.equal(log.tk.at(-1), 0, 'picker open'); c.setCapturing(false); assert.equal(log.tk.at(-1), 0x14);
  st.toggleOn = false; c.applySettings(); assert.equal(log.tk.at(-1), 0, 'switch off: CapsLock normal at once');
  st.toggleOn = true; c.applySettings(); assert.equal(log.tk.at(-1), 0x14);
  st.toggleKey = { vks: [0x78] }; c.applySettings(); assert.equal(log.tk.at(-1), 0x78);
});

test('controller: toggle events ignored when paused / picker / switch off', () => {
  const { c, typer, st } = claimRig(); c.attach();
  let n = 0; c.fsm.toggle = () => { n++; };
  typer.emit('toggle'); assert.equal(n, 1);
  c.setEnabled(false); typer.emit('toggle'); assert.equal(n, 1); c.setEnabled(true);
  c.setCapturing(true); typer.emit('toggle'); assert.equal(n, 1); c.setCapturing(false);
  st.toggleOn = false; typer.emit('toggle'); assert.equal(n, 1);
});
