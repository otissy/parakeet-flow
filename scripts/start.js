'use strict';
/* npm start: runs Electron with ELECTRON_RUN_AS_NODE removed. When that variable is set (some shells and tools
   export it) electron.exe behaves as plain Node, `require('electron')` returns a path string and the app
   dies on its first line with no window and no message. */
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const exe = require(path.join(root, 'node_modules', 'electron'));   // path to electron.exe
const child = spawn(exe, [root, ...process.argv.slice(2)], { stdio: 'inherit', env, windowsHide: false });
child.on('exit', (code) => process.exit(code === null ? 1 : code));
