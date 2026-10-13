'use strict';
/* CapsLock must be normal again the moment the app is gone, however it goes. The hook lives in the helper process, so what
   matters is that the helper dies with its parent (stdin EOF) and on QUIT, and that a killed helper leaves nothing behind.
   No key is pressed here; the real-key proof of "the key works again after the helper is killed" is real-capslock.js. */
const test = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { startHelper, sleep, root, BIN } = require('./util');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
async function gone(pid, ms = 4000) { for (let i = 0; i < ms / 50; i++) { if (!alive(pid)) return true; await sleep(50); } return false; }

test('QUIT (normal exit): the helper process ends', async () => {
  const t = await startHelper(); const pid = t.proc.pid;
  t.close();
  assert.equal(await gone(pid), true);
});

test('hard kill of the helper (crash): the process is gone, no hook survives', async () => {
  const t = await startHelper(); const pid = t.proc.pid;
  assert.equal(alive(pid), true);
  spawnSync('taskkill', ['/F', '/PID', String(pid)]);
  assert.equal(await gone(pid), true);
});

test('the app process is killed hard (crash): the helper notices stdin closing and exits by itself', async () => {
  const script = path.join(os.tmpdir(), 'pf-caps-parent.js');
  fs.writeFileSync(script, `const {Win32Typer}=require(${JSON.stringify(path.join(root, 'src/typer/win32-typer.js'))});
(async()=>{const t=new Win32Typer({binDir:${JSON.stringify(BIN)}});await t.ready;t.setToggleKey(0x14);t.setClaim(true);console.log('HELPER '+t.proc.pid);setInterval(()=>{},1000);})();`);
  const parent = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  const pid = await new Promise((res, rej) => { parent.stdout.on('data', (d) => { out += d; const m = /HELPER (\d+)/.exec(out); if (m) res(+m[1]); }); setTimeout(() => rej(new Error('no helper pid')), 8000); });
  assert.equal(alive(pid), true, 'helper running while the app lives');
  spawnSync('taskkill', ['/F', '/PID', String(parent.pid)]);          // no /T: the helper is NOT killed by us
  assert.equal(await gone(pid), true, 'helper exited on its own after the app died');
  fs.rmSync(script, { force: true });
});
