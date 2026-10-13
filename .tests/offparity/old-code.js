'use strict';
/* The typing code exactly as it was at the last commit before the voice/tone/model features (185c72c), extracted with
   `git show` into a temp folder. Used to prove that, with every new feature off, live typing is byte-for-byte unchanged. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..', '..');
const BASE = '185c72c';
const FILES = ['src/core/live-typer.js', 'src/core/session.js', 'src/core/postprocess.js', 'src/core/deny.js', 'src/typer/typer.js'];

function loadOld() {
  const dir = path.join(os.tmpdir(), 'pf-old-' + BASE);
  const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (git('cat-file', '-e', BASE + '^{commit}').status !== 0) return null;          // history not available: callers skip
  for (const f of FILES) {
    const r = git('show', `${BASE}:${f}`);
    if (r.status !== 0) return null;
    const dest = path.join(dir, f); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, r.stdout);
  }
  return {
    DictationSession: require(path.join(dir, 'src/core/session.js')).DictationSession,
    MemoryTyper: require(path.join(dir, 'src/typer/typer.js')).MemoryTyper,
    LiveTyper: require(path.join(dir, 'src/core/live-typer.js')).LiveTyper,
  };
}

module.exports = { loadOld, BASE };
