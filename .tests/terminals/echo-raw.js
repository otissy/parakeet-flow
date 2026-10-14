'use strict';
/* Harmless raw-mode key echo, the way a TUI such as Claude Code (Ink) reads its prompt: stdin in raw mode, every chunk
   it receives is appended to a log file as one JSON line {t, hex}. It prints nothing it receives and runs no command.
   usage: node echo-raw.js <logfile> */
const fs = require('fs');
const log = process.argv[2];
if (!log || !process.stdin.isTTY) { console.error('needs a TTY and a log file'); process.exit(2); }
process.stdin.setRawMode(true);
process.stdin.resume();
fs.appendFileSync(log, JSON.stringify({ ready: true, raw: process.stdin.isRaw }) + '\n');
process.stdin.on('data', (b) => fs.appendFileSync(log, JSON.stringify({ t: Date.now(), hex: b.toString('hex') }) + '\n'));
setTimeout(() => process.exit(0), 5 * 60 * 1000);   // never lives longer than five minutes
