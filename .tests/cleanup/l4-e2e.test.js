'use strict';
/* The REAL local model: Qwen3 0.6B Q8_0 through node-llama-cpp in a worker thread, CPU only. Measures latency and CPU
   on this machine (written to the proof folder), and proves the fallbacks with the real thing. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const store = require(path.join(root, 'src/llm/llm-store.js'));
const { LlmWorker } = require(path.join(root, 'src/llm/llm-host.js'));
const { LlmService } = require(path.join(root, 'src/llm/cleanup.js'));

const models = process.env.PF_MODELS || path.join(process.env.APPDATA || '', 'parakeet-flow', 'models');
const have = store.runtimeInstalled() && fs.existsSync(store.modelPath(models));
const skip = have ? false : 'local model or llm-runtime missing (UNVERIFIED)';
const proof = process.env.PF_PROOF_DIR || path.join(root, '..', 'pf-proof');

const CLEAN = ['hey can you send me the report before the meeting tomorrow i think its important', 'we should meet at ten tomorrow because the client is in town',
  'ik denk dat we morgen om tien uur moeten afspreken want dat past beter', 'could you please check the invoice and let me know if anything is missing',
  'het was een lange dag maar we hebben het toch af gekregen', 'um so i was thinking we could maybe meet at ten'];

async function run(threads) {
  const w = new LlmWorker({ entry: store.RUNTIME_ENTRY, modelPath: store.modelPath(models), threads, idleMs: 0, startTimeoutMs: 60000 });
  const svc = new LlmService({ llm: w, getSettings: () => ({ cleanup: { timeoutMs: 8000 } }) });
  const t0 = Date.now(); w.warm(); await w._ready; const startMs = Date.now() - t0;
  await svc.cleanup('warm up the cache please');                      // first call pays for the prompt prefix
  const cpu0 = process.cpuUsage(), w0 = process.hrtime.bigint();
  const rows = [];
  for (const t of CLEAN) { const a = Date.now(); const r = await svc.cleanup(t); rows.push({ ms: Date.now() - a, used: r.used, reason: r.reason }); }
  const wall = Number(process.hrtime.bigint() - w0) / 1e9, cpu = process.cpuUsage(cpu0);
  const cores = (cpu.user + cpu.system) / 1e6 / wall;
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  w.stop();
  return { threads, startMs, n: rows.length, applied: rows.filter((r) => r.used).length, medianMs: ms[Math.floor(ms.length / 2)], maxMs: ms.at(-1), cpuCores: +cores.toFixed(2), cpuPctOfMachine: +(100 * cores / os.cpus().length).toFixed(1), rows };
}

test('real model: weights match the pinned SHA-256', { skip, timeout: 120000 }, async () => {
  const v = await store.verify(models);
  assert.equal(v.ok, true, JSON.stringify(v));
});

test('real model: latency and CPU at 2 and 4 threads, answers pass the guard, fallbacks work', { skip, timeout: 240000 }, async () => {
  const two = await run(2), four = await run(4);
  fs.mkdirSync(proof, { recursive: true });
  fs.writeFileSync(path.join(proof, 'cleanup-measure.json'), JSON.stringify({ machine: { cores: os.cpus().length, model: os.cpus()[0].model }, two, four }, null, 1));
  assert.ok(two.applied >= 2, `the model's answers pass the guard at least sometimes (${two.applied}/${two.n})`);
  assert.ok(two.medianMs < 1500, 'median under the 1.5 s hard limit at 2 threads: ' + two.medianMs);

  // fallbacks with the real model: an impossible deadline, and a prompt that makes it answer instead of fix
  const w = new LlmWorker({ entry: store.RUNTIME_ENTRY, modelPath: store.modelPath(models), threads: 2, idleMs: 0, startTimeoutMs: 60000 });
  const svc = new LlmService({ llm: w, getSettings: () => ({ cleanup: { timeoutMs: 1 } }) });
  const cold = await svc.cleanup('this will not make it in one millisecond'); assert.equal(cold.used, false); assert.equal(cold.text, 'this will not make it in one millisecond'); assert.equal(cold.reason, 'timeout');
  await w._ready.catch(() => {});
  const svc2 = new LlmService({ llm: w, getSettings: () => ({ cleanup: { timeoutMs: 8000 } }) });
  const q = 'what is the capital of france'; const a = await svc2.cleanup(q);
  assert.ok(a.text === q || a.used, 'either fixed faithfully or the original');
  assert.notEqual(a.text.trim(), 'Paris.');
  w.stop();
});
