'use strict';
/* Worker thread: owns the model (node-llama-cpp, prebuilt CPU binary, in-process) so a generation never blocks
   the app. Messages in: {cmd:'warm'} {cmd:'chat', id, messages, maxTokens} {cmd:'cancel', id}.
   Out: {ev:'ready'} {ev:'result', id, text} {ev:'error', id, message, aborted} {ev:'fatal', message}.
   Never logs or echoes prompts. */
const { parentPort, workerData } = require('worker_threads');
const { pathToFileURL } = require('url');

const o = workerData;                       // {entry, modelPath, threads, ctxSize}
let lib, model, ctx;
const slots = new Map();                     // prompt prefix -> {session, base, seq}
let free = [];
const aborts = new Map();
const cancelled = new Set();
let queue = Promise.resolve();

async function init() {
  lib = await import(pathToFileURL(o.entry).href);
  const llama = await lib.getLlama({ gpu: false, build: 'never', skipDownload: true, logLevel: lib.LlamaLogLevel.error });
  model = await llama.loadModel({ modelPath: o.modelPath });
  ctx = await model.createContext({ contextSize: o.ctxSize, threads: o.threads, batchSize: 512, sequences: 2 });
  free = [ctx.getSequence(), ctx.getSequence()];
}

/** messages = [system, (user, assistant)*, user]; everything before the last user turn is the cached prefix */
function slotFor(messages) {
  const sys = messages[0].role === 'system' ? messages[0].content : '';
  const rest = messages.slice(sys ? 1 : 0, -1);
  const key = JSON.stringify([sys, rest]);
  let s = slots.get(key);
  if (s) return s;
  if (!free.length) {   // two prompt kinds at most (cleanup, translate): recycle the oldest
    const [k, v] = slots.entries().next().value;
    try { v.session.dispose({ disposeSequence: false }); } catch (_) { /* gone */ }
    free.push(v.seq); slots.delete(k);
  }
  const seq = free.pop();
  if (seq.clearHistory) seq.clearHistory();
  const session = new lib.LlamaChatSession({ contextSequence: seq, systemPrompt: sys || undefined, chatWrapper: new lib.QwenChatWrapper({ thoughts: 'discourage' }) });
  const base = [];
  if (sys) base.push({ type: 'system', text: sys });
  for (let i = 0; i < rest.length; i += 2) {
    base.push({ type: 'user', text: rest[i].content });
    if (rest[i + 1]) base.push({ type: 'model', response: [rest[i + 1].content] });
  }
  s = { session, base, seq };
  slots.set(key, s);
  return s;
}

async function chat(m) {
  if (!model) await init();
  const ac = new AbortController(); aborts.set(m.id, ac);
  if (cancelled.has(m.id)) ac.abort();
  const s = slotFor(m.messages);
  s.session.setChatHistory(s.base);
  const user = m.messages[m.messages.length - 1].content;
  return s.session.prompt(user, { temperature: 0, topK: 1, maxTokens: m.maxTokens || 256, signal: ac.signal });
}

parentPort.on('message', (m) => {
  if (m.cmd === 'cancel') { cancelled.add(m.id); const a = aborts.get(m.id); if (a) a.abort(); return; }
  if (m.cmd === 'warm') {
    queue = queue.then(async () => { if (!model) await init(); parentPort.postMessage({ ev: 'ready' }); })
      .catch((e) => parentPort.postMessage({ ev: 'fatal', message: String(e && e.message || e).slice(0, 200) }));
    return;
  }
  if (m.cmd !== 'chat') return;
  queue = queue.then(async () => {
    if (cancelled.has(m.id)) { cancelled.delete(m.id); return; }
    try { parentPort.postMessage({ ev: 'result', id: m.id, text: await chat(m) }); }
    catch (e) { parentPort.postMessage({ ev: 'error', id: m.id, message: String(e && e.message || e).slice(0, 200), aborted: !!(e && e.name === 'AbortError') }); }
    finally { aborts.delete(m.id); cancelled.delete(m.id); }
  });
});
