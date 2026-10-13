'use strict';
/* Shared by the L4 tests: start the real Electron app with the features hook and wait for its report. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..', '..');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

function runApp(mode, extraEnv = {}, { timeoutMs = 200000 } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-feat-'));
  const report = path.join(userData, 'report.json');
  const env = { ...process.env, PF_USERDATA: userData, PF_MODELS: path.join(process.env.APPDATA, 'parakeet-flow', 'models'), PF_OFFSCREEN: '1', PF_NO_LOGIN_ITEM: '1',
    PF_TEST_HOOK: path.join(__dirname, 'hook.js'), PF_MODE: mode, PF_REPORT: report, PF_PROOF_DIR: process.env.PF_PROOF_DIR || path.join(root, '..', 'pf-proof'), ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve) => {
    const child = spawn(electron, [root], { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = ''; child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { try { child.kill(); } catch (_) { /* gone */ } }, timeoutMs);
    child.on('exit', () => {
      clearTimeout(timer);
      let rep = null; try { rep = JSON.parse(fs.readFileSync(report, 'utf8')); } catch (_) { /* no report */ }
      resolve({ rep, userData, stderr: err.slice(0, 600) });
    });
  });
}

module.exports = { runApp, electron, root };
