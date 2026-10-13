'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');

test('local-model modules load without starting a model', () => {
  const g = require(path.join(root, 'src/llm/guard.js'));
  for (const k of ['acceptCleanup', 'acceptTranslation', 'lev', 'tidyOutput']) assert.ok(g[k], k);
  const c = require(path.join(root, 'src/llm/cleanup.js'));
  assert.ok(c.LlmService && c.cleanupMessages && c.translateMessages);
  const h = require(path.join(root, 'src/llm/llm-host.js'));
  const w = new h.LlmWorker({ entry: 'x', modelPath: 'y' });
  assert.equal(w.status().state, 'stopped'); assert.equal(w.worker, null);       // lazy: nothing running yet
  const st = require(path.join(root, 'src/llm/llm-store.js'));
  assert.equal(st.MODEL.sha256.length, 64); assert.equal(st.MODEL.repo, 'Qwen/Qwen3-0.6B-GGUF');
});

test('the worker file parses (it runs only inside a worker thread)', () => {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['--check', path.join(root, 'src/llm/llm-worker.js')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
