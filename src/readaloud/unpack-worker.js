'use strict';
/* Worker thread: unpack the voice archive (bzip2 + tar, src/readaloud/bunzip2.js) keeping only the wanted files. */
const { parentPort, workerData: o } = require('worker_threads');
const { extractTarBz2 } = require('./bunzip2');

try {
  const want = (rel) => {
    const r = rel.slice(o.top.length + 1);
    return rel === o.top || o.keepFiles.includes(r) || o.keepDirs.some((d) => r === d.slice(0, -1) || r.startsWith(d));
  };
  let last = 0;
  const files = extractTarBz2(o.archive, o.dest, { top: o.top, filter: want, onProgress: (done) => { if (done - last > 8e6) { last = done; parentPort.postMessage({ ev: 'progress', done }); } } });
  parentPort.postMessage({ ev: 'done', files: files.length });
} catch (e) {
  parentPort.postMessage({ ev: 'error', message: String((e && e.message) || e).slice(0, 200) });
}
