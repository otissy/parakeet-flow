'use strict';
/* MANUAL proof run (off-screen windows only): seeds notes the way they really arrive (two dictated by the app, two added and one filed by an MCP client
   over real stdio), then starts the real app on that data folder and captures the Notes page and the new Settings sections.
   run: PF_PROOF_DIR=<dir> node .tests/mcp/run-ui-proof.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client, StdioClientTransport, serverPath, Outbox, tmpDir, root } = require('./util');

(async () => {
  const proof = process.env.PF_PROOF_DIR || path.join(tmpDir('uiproof'), 'out'); fs.mkdirSync(proof, { recursive: true });
  const userData = tmpDir('uiapp');
  const app = new Outbox(path.join(userData, 'notes.jsonl'));
  app.add('Call the dentist on Thursday morning about the crown.');
  app.add('Idee voor de stream: een overlay met de laatste drie follows, rustig en klein.');
  const client = new Client({ name: 'proof', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath, `--data-dir=${userData}`], stderr: 'pipe', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } }));
  const added = JSON.parse((await client.callTool({ name: 'notes_add', arguments: { text: 'Buy a longer USB-C cable for the capture card.', tags: ['shopping', 'stream'] } })).content[0].text).note;
  await client.callTool({ name: 'note_mark_synced', arguments: { id: added.id, destination: 'Notion: Notes database', url: 'https://www.notion.so/Buy-a-longer-USB-C-cable-1a2b3c' } });
  await client.callTool({ name: 'notes_add', arguments: { text: 'Ask Grace about the sponsor schedule next week.', tags: ['work'] } });
  await client.close();
  const report = path.join(userData, 'report.json');
  const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const env = { ...process.env, PF_USERDATA: userData, PF_MODELS: path.join(process.env.APPDATA, 'parakeet-flow', 'models'), PF_OFFSCREEN: '1', PF_NO_LOGIN_ITEM: '1',
    PF_TEST_HOOK: path.join(__dirname, 'ui-hook.js'), PF_PROOF_DIR: proof, PF_REPORT: report };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [root], { env, encoding: 'utf8', timeout: 120000 });
  console.log('electron exit', r.status, fs.existsSync(report) ? fs.readFileSync(report, 'utf8') : (r.stderr || '').slice(0, 300));
  console.log('proof dir', proof);
})();
