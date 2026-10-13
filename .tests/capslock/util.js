'use strict';
/* Shared by the capslock tests: a helper in test mode (SIM = a physical key event fed to the hook logic, no OS event at all). */
const path = require('path');
const os = require('os');
const base = require('../ctrlspace/util');
const { Win32Typer } = require(path.join(base.root, 'src/typer/win32-typer.js'));
const BIN = path.join(os.tmpdir(), 'pf-caps-bin');
const { sim, dump, sleep, root } = base;

async function startHelper({ toggle = 0x14, hold = [0x11, 0x20] } = {}) {
  const t = new Win32Typer({ binDir: BIN, test: true });
  await t.ready;
  t.keys = []; t.toggles = []; t.lines = [];
  t.on('key', (e) => t.keys.push(e.down ? 'down' : 'up'));
  t.on('toggle', () => t.toggles.push(1));
  t.on('line', (a) => t.lines.push(a));
  t.setHotkey(hold); t.setClaim(true); t.setToggleKey(toggle); t.raw('CAPTURE 1');
  return t;
}
module.exports = { startHelper, sim, dump, sleep, root, BIN };
