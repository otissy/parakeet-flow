'use strict';
/* A stand-in for src/llm/llm-worker.js speaking the same protocol, for tests. workerData.entry is a JSON behaviour:
   {delay: ms to reply, startDelay: ms before ready, crashOnStart: bool}. The message text decides the rest:
   contains SLOW -> never replies (until cancelled), BOOM -> error, WRONG -> an unrelated answer, otherwise a fixed-up copy. */
const { parentPort, workerData } = require('worker_threads');
const b = JSON.parse(workerData.entry || '{}');
const cancelled = new Set();
const fix = (s) => { const t = s.trim(); return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : t; };
parentPort.on('message', (m) => {
  if (m.cmd === 'cancel') { cancelled.add(m.id); parentPort.postMessage({ ev: 'cancelled', id: m.id }); return; }
  if (m.cmd === 'warm') {
    if (b.crashOnStart) { parentPort.postMessage({ ev: 'fatal', message: 'no model' }); return; }
    setTimeout(() => parentPort.postMessage({ ev: 'ready' }), b.startDelay || 0); return;
  }
  if (m.cmd !== 'chat') return;
  const user = m.messages[m.messages.length - 1].content.replace('/no_think\n', '');
  if (user.includes('SLOW')) return;
  setTimeout(() => {
    if (cancelled.has(m.id)) return;
    if (user.includes('BOOM')) return parentPort.postMessage({ ev: 'error', id: m.id, message: 'boom' });
    parentPort.postMessage({ ev: 'result', id: m.id, text: user.includes('WRONG') ? 'Paris is the capital of France and a lovely city.' : '\n\n' + fix(user) });
  }, b.delay || 0);
});
