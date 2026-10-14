'use strict';
/* the real Electron app, started the way Squirrel starts it */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const root = path.join(__dirname, '..', '..');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const skip = fs.existsSync(electron) ? false : 'electron missing (UNVERIFIED)';
const clean = (o = {}) => { const e = { ...process.env, ...o }; delete e.ELECTRON_RUN_AS_NODE; return e; };

for (const flag of ['install', 'updated', 'uninstall', 'obsolete']) {
  test(`--squirrel-${flag} exits at once, opens nothing, starts no helper`, { skip, timeout: 30000 }, () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-sq-'));
    const t0 = Date.now();
    const r = spawnSync(electron, [root, '--squirrel-' + flag, '--user-data=' + ud], { env: clean(), timeout: 20000, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(Date.now() - t0 < 15000, 'took ' + (Date.now() - t0));
    assert.ok(!fs.existsSync(path.join(ud, 'bin')), 'helper was not built or started');
    fs.rmSync(ud, { recursive: true, force: true });
  });
}
test('--squirrel-firstrun boots the whole app; npm start script strips ELECTRON_RUN_AS_NODE', { skip, timeout: 60000 }, async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-sq-'));
  const rep = path.join(ud, 'rep.json');
  const hook = path.join(ud, 'hook.js');
  fs.writeFileSync(hook, [
    "const fs=require('fs');",
    'module.exports=({app,get})=>{(async()=>{const g=get();g.typer.setHotkey([0x7e]);',
    'await new Promise(r=>setTimeout(r,2500));',
    "fs.writeFileSync(process.env.REP,JSON.stringify({ud:app.getPath('userData'),wins:require('electron').BrowserWindow.getAllWindows().length,erm:process.env.ELECTRON_RUN_AS_NODE||null}));",
    'app.exit(0);})();};',
  ].join('\n'));
  // through scripts/start.js with the poisoned variable set: it must still start
  const env = clean({ ELECTRON_RUN_AS_NODE: '1', PF_OFFSCREEN: '1', PF_NO_LOGIN_ITEM: '1', PF_TEST_HOOK: hook, REP: rep, PF_MODELS: path.join(ud, 'none') });
  const c = spawn(process.execPath, [path.join(root, 'scripts', 'start.js'), '--squirrel-firstrun', '--user-data=' + ud], { env, stdio: 'ignore' });
  await new Promise((r) => c.on('exit', r));
  assert.ok(fs.existsSync(rep), 'app booted');
  const o = JSON.parse(fs.readFileSync(rep, 'utf8'));
  assert.equal(o.ud, ud); assert.ok(o.wins >= 3); assert.equal(o.erm, null);
  fs.rmSync(ud, { recursive: true, force: true });
});
