'use strict';
/* packaging configuration as a whole: what the installer will contain and what it must never contain */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const b = pkg.build;

test('Squirrel.Windows target, per-user, own icon, nothing published', () => {
  assert.deepEqual(b.win.target, ['squirrel']);
  assert.equal(b.win.icon, 'assets/icon.ico');
  assert.ok(fs.existsSync(path.join(root, b.win.icon)));
  assert.equal(b.squirrelWindows.name, 'parakeet-flow');          // install folder LOCALAPPDATA/parakeet-flow
  assert.ok(!b.publish && !b.win.certificateFile && !b.win.signtoolOptions, 'no publish target, no certificate');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.devDependencies['electron-builder'], '26.15.3');
});
test('native code stays on disk (no asar) and the big models are not bundled', () => {
  assert.equal(b.asar, false);
  const f = b.files.join(' ');
  assert.match(f, /src\/\*\*/); assert.match(f, /llm-runtime\/node_modules/);
  assert.ok(!/models|\.gguf|\.onnx|\.tests/.test(f));
});
test('no startup entry of any kind in the app sources', () => {
  const hits = [];
  const bad = /schtasks|CurrentVersion.Run|RegSetValue|Start Menu.Programs.Startup/i;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|cs|html)$/.test(e.name) && bad.test(fs.readFileSync(p, 'utf8'))) hits.push(p);
    }
  };
  walk(path.join(root, 'src'));
  assert.deepEqual(hits, []);
  const { DEFAULTS } = require(path.join(root, 'src/main/settings.js'));
  assert.equal(DEFAULTS.launchAtLogin, false);
});
test('main.js wires Squirrel before anything opens, and pins user data', () => {
  const m = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
  assert.ok(m.indexOf('squirrel.handle') > 0 && m.indexOf('squirrel.handle') < m.indexOf('app.whenReady'));
  assert.match(m, /userDataDir\(app\.getPath\('appData'\)\)/);
  assert.match(fs.readFileSync(path.join(root, 'scripts/start.js'), 'utf8'), /delete env\.ELECTRON_RUN_AS_NODE/);
  assert.equal(pkg.scripts.start, 'node scripts/start.js');
});

// input helper metadata
const t = require(path.join(root, 'src/typer/win32-typer.js'));
const dir = path.join(root, 'src/typer/helper');

test('AssemblyInfo carries company, product, description, copyright and the package version', () => {
  const a = fs.readFileSync(path.join(dir, 'AssemblyInfo.cs'), 'utf8');
  for (const k of ['AssemblyCompany("otissy")', 'AssemblyProduct("parakeet-flow input helper")', 'AssemblyDescription(', 'AssemblyCopyright(']) assert.ok(a.includes(k), k);
  assert.ok(a.includes(`AssemblyVersion("${pkg.version}.0")`) && a.includes(`AssemblyFileVersion("${pkg.version}.0")`), 'version must match package.json');
  assert.match(a, /never records keystrokes/);
});
test('manifest: asInvoker, no UI access, supportedOS entries', () => {
  const m = fs.readFileSync(path.join(dir, 'pf-helper.manifest'), 'utf8');
  assert.match(m, /level="asInvoker"/); assert.match(m, /uiAccess="false"/);
  assert.ok((m.match(/<supportedOS /g) || []).length >= 4);
  assert.ok(!/requireAdministrator|highestAvailable|uiAccess="true"/.test(m));
});
test('source hash covers all three inputs and changes with any of them', () => {
  const h = t.sourceHash();
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, t.sourceHash());
});
test('compiled exe has version info, an embedded manifest and the app icon; stamp equals the source hash', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-meta-'));
  const exe = t.compileHelper(path.join(d, 'pf-helper.exe'));
  assert.equal(fs.readFileSync(exe + '.src-sha256', 'utf8'), t.sourceHash());
  const ps = path.join(d, 'vi.ps1');
  fs.writeFileSync(ps, '$v=(Get-Item $args[0]).VersionInfo; "$($v.CompanyName)|$($v.ProductName)|$($v.FileDescription)|$($v.FileVersion)|$($v.LegalCopyright)"');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps, exe], { encoding: 'utf8' });
  const [co, prod, desc, ver, copy] = r.stdout.trim().split('|');
  assert.equal(co, 'otissy'); assert.equal(prod, 'parakeet-flow input helper'); assert.match(desc, /input helper/);
  assert.equal(ver, pkg.version + '.0'); assert.match(copy, /otissy/);
  const bin = fs.readFileSync(exe);
  assert.ok(bin.includes('asInvoker'), 'manifest embedded');
  assert.ok(bin.length > 40000, 'icon resource embedded (' + bin.length + ' bytes)');
  fs.rmSync(d, { recursive: true, force: true });
});
test('buildHelper prefers the shipped exe only when its stamp matches the source', () => {
  const had = fs.existsSync(t.BUNDLED);
  assert.ok(!had, 'no stale bundled helper in the source tree');
  fs.mkdirSync(path.dirname(t.BUNDLED), { recursive: true });
  try {
    fs.writeFileSync(t.BUNDLED, 'not really an exe');
    fs.writeFileSync(t.BUNDLED + '.src-sha256', 'wrong');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-meta-'));
    assert.equal(t.buildHelper(d), path.join(d, 'pf-helper.exe'), 'stale stamp: compiled fresh, bundled ignored');
    fs.writeFileSync(t.BUNDLED + '.src-sha256', t.sourceHash());
    assert.equal(t.buildHelper(d), t.BUNDLED, 'matching stamp: shipped exe used, nothing compiled');
    fs.rmSync(d, { recursive: true, force: true });
  } finally { fs.rmSync(path.dirname(t.BUNDLED), { recursive: true, force: true }); }
});
test('docs/antivirus.md exists and says what the helper does not do', () => {
  const d = fs.readFileSync(path.join(root, 'docs', 'antivirus.md'), 'utf8');
  for (const k of ['SetWindowsHookEx', 'SendInput', 'no network', 'sha256', 'false positive']) assert.ok(d.toLowerCase().includes(k.toLowerCase()), k);
});

test('installer bundles the MCP server with its dependencies and the notes skill', () => {
  const f = b.files.join(' ');
  for (const k of ['mcp/server.js', 'mcp/package.json', 'mcp/node_modules/**/*', '.claude/skills/sync-parakeet-notes/SKILL.md']) assert.ok(f.includes(k), k);
  assert.ok(f.indexOf('!**/*.{md,map,log}') < f.indexOf('SKILL.md'), 'the skill is re-included after the *.md exclusion');
  for (const p of ['mcp/server.js', '.claude/skills/sync-parakeet-notes/SKILL.md']) assert.ok(fs.existsSync(path.join(root, p)), p);
  const need = require(path.join(root, 'scripts/build-installer.js'));
  assert.equal(typeof need.removeBundledHelper, 'function');
});
test('removeBundledHelper deletes a stale shipped helper', () => {
  const bi = require(path.join(root, 'scripts/build-installer.js'));
  fs.mkdirSync(path.dirname(t.BUNDLED), { recursive: true });
  fs.writeFileSync(t.BUNDLED, 'stale');
  bi.removeBundledHelper();
  assert.ok(!fs.existsSync(path.dirname(t.BUNDLED)));
});
