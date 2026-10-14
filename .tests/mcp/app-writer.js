'use strict';
/* plays the part of the running app in the concurrency test: its own PROCESS adds notes to notes.jsonl and, in between, makes the changes that REWRITE
   the file (markFailed, resend, setFlag), exactly what the app's Notion sync and export do.  usage: node app-writer.js <dataDir> <count> <prefix> */
const path = require('path');
const { Outbox } = require(path.join(__dirname, '..', '..', 'src', 'notes', 'outbox.js'));
const [dir, count, prefix] = process.argv.slice(2);
const o = new Outbox(path.join(dir, 'notes.jsonl'));
const mine = [];
for (let i = 0; i < Number(count); i++) {
  const n = o.add(`${prefix}-${i} café`);
  if (n) mine.push(n.id);
  if (i % 3 === 2 && mine.length) {
    const id = mine[Math.floor(Math.random() * mine.length)];
    o.markFailed(id, 'x'); o.resend(id); o.setFlag(id, 'md', 'f' + i + '.md');
  }
}
console.log('done');
