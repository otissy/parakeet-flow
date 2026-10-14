'use strict';
/* Builds the Squirrel.Windows installer into a FRESH folder: D:\builds\parakeet-flow\<version> (override with
   PF_BUILDS). Never reuses a folder and never touches win-unpacked of an earlier build: electron-builder fails with
   EPERM when it tries to delete a previous D:\builds\...\win-unpacked. Squirrel's temp (it unpacks the whole app)
   is kept on the same drive next to the output. Publishes nothing: no GitHub, no feed.
   Usage: node scripts/build-installer.js [--suffix=<text>]   (suffix is appended to the folder, e.g. for a re-run) */
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILDS = process.env.PF_BUILDS || 'D:/builds/parakeet-flow';
const MIN_FREE_GB = 4;

const log = (m) => process.stdout.write(m + '\n');
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** <builds>\<version>[-suffix]; a folder that already exists is an error, never reused */
function outputDir(builds, version, suffix = '') {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('version must be x.y.z, got ' + version);
  const dir = path.join(builds, version + (suffix ? '-' + suffix.replace(/[^\w.-]/g, '') : ''));
  if (fs.existsSync(dir)) throw new Error('output folder already exists, pick another version or --suffix: ' + dir);
  return dir;
}

/** electron-winstaller needs vendor\7z.exe, which its install script makes; with npm --ignore-scripts it is missing */
function ensure7z() {
  const dir = path.join(ROOT, 'node_modules', 'electron-winstaller');
  if (!fs.existsSync(dir)) throw new Error('electron-winstaller missing: run npm install');
  if (fs.existsSync(path.join(dir, 'vendor', '7z.exe'))) return;
  const r = spawnSync(process.execPath, ['script/select-7z-arch.js'], { cwd: dir, encoding: 'utf8' });   // relative paths: cwd must be the package
  if (r.status !== 0 || !fs.existsSync(path.join(dir, 'vendor', '7z.exe'))) throw new Error('could not create vendor/7z.exe:' + (r.stderr || r.stdout));
  log('created electron-winstaller/vendor/7z.exe');
}

function preflight() {
  const need = [
    ['assets/icon.ico', 'run: npm run icon'],
    ['node_modules/electron/dist/electron.exe', 'electron dist is incomplete (see README)'],
    ['node_modules/sherpa-onnx-node/package.json', 'run: npm install'],
    ['llm-runtime/node_modules/node-llama-cpp/dist/index.js', 'run: npm --prefix llm-runtime install --omit=optional --ignore-scripts'],
    ['llm-runtime/node_modules/@node-llama-cpp/win-x64/package.json', 'run: npm --prefix llm-runtime install --omit=optional --ignore-scripts'],
    ['node_modules/electron-builder/cli.js', 'run: npm install'],
    ['mcp/node_modules/@modelcontextprotocol/sdk/package.json', 'run: npm --prefix mcp ci --ignore-scripts'],
    ['mcp/node_modules/zod/package.json', 'run: npm --prefix mcp ci --ignore-scripts'],
    ['.claude/skills/sync-parakeet-notes/SKILL.md', 'the notes skill is missing'],
  ];
  for (const [f, hint] of need) if (!fs.existsSync(path.join(ROOT, f))) throw new Error(`missing ${f}: ${hint}`);
  ensure7z();
}

/** the shipped helper is a build product: removed before and after, so a stale src/typer/helper/bin can never be used by a later dev run or test */
function removeBundledHelper() {
  const typer = require('../src/typer/win32-typer.js');
  fs.rmSync(path.dirname(typer.BUNDLED), { recursive: true, force: true });
}

function main(argv) {
  const suffix = (argv.find((a) => a.startsWith('--suffix=')) || '').slice(9);
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const out = outputDir(BUILDS, version, suffix);
  preflight();
  fs.mkdirSync(BUILDS, { recursive: true });
  const tmp = path.join(BUILDS, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  // the input helper is compiled ONCE here and shipped inside the installer (not compiled on the user's PC at first run)
  const typer = require('../src/typer/win32-typer.js');
  removeBundledHelper();
  const helper = typer.compileHelper(typer.BUNDLED);
  log(`pf-helper.exe ${fs.statSync(helper).size} bytes  sha256 ${sha256(helper)}  source ${typer.sourceHash()}`);
  log(`building parakeet-flow ${version} into ${out}`);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js'), '--win', 'squirrel', '--publish', 'never', `-c.directories.output=${out}`],
    { cwd: ROOT, stdio: 'inherit', windowsHide: true, env: { ...process.env, TEMP: tmp, TMP: tmp, SQUIRREL_TEMP: tmp, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  removeBundledHelper();
  if (r.status !== 0) { log('build failed'); return 1; }
  const sq = path.join(out, 'squirrel-windows');
  for (const f of fs.existsSync(sq) ? fs.readdirSync(sq) : []) {
    const p = path.join(sq, f), st = fs.statSync(p);
    log(`${f}  ${st.size} bytes${f.endsWith('.exe') ? '  sha256 ' + sha256(p) : ''}`);
  }
  log('unsigned: Windows SmartScreen or Norton may warn on first run (see README)');
  return 0;
}

if (require.main === module) { try { process.exit(main(process.argv.slice(2))); } catch (e) { log('build-installer: ' + e.message); process.exit(1); } }
module.exports = { outputDir, ensure7z, preflight, removeBundledHelper };
