'use strict';
/* Local proof of the feed, no real release and no change to any install: the REAL Squirrel.exe that ships in the installer, renamed
   Update.exe in a temp folder (it works on the folder it runs from), talks to a server on this PC laid out like GitHub: the feed path
   redirects to a tagged release path. Checks what Squirrel asks for, how it reads RELEASES, and whether it fetches the nupkg by the
   name in RELEASES. If PF_BUILT_DIR or the default build exists, its own RELEASES and nupkg are checked as upload assets. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..', '..');
const U = require(path.join(root, 'src/main/updater.js'));
const { checkReleaseFolder } = require(path.join(root, 'scripts/build-installer.js'));

const SQUIRREL = path.join(root, 'node_modules', 'electron-winstaller', 'vendor', 'Squirrel.exe');
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex').toUpperCase();
const hasSquirrel = fs.existsSync(SQUIRREL);

test('the feed URL has the shape the local proof mimics: <repo>/releases/latest/download', () => {
  assert.match(new URL(U.FEED_URL).pathname, /^\/otissy\/parakeet-flow\/releases\/latest\/download$/);
  assert.equal(new URL(U.FEED_URL).protocol, 'https:');
});

test('real Squirrel against a GitHub-shaped feed: finds the newer version, and fetches the nupkg by its RELEASES name', { skip: hasSquirrel ? false : 'electron-winstaller vendor missing' }, async () => {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-feed-'));
  const appDir = path.join(top, 'pf-feed-proof');        // not named parakeet-flow on purpose: it could never resolve to the real install
  fs.mkdirSync(path.join(appDir, 'packages'), { recursive: true });
  const update = path.join(appDir, 'Update.exe');
  fs.copyFileSync(SQUIRREL, update);
  const oldBody = Buffer.from('installed version placeholder');
  fs.writeFileSync(path.join(appDir, 'packages', 'RELEASES'), `${sha1(oldBody)} pf-feed-proof-0.2.61-full.nupkg ${oldBody.length}\r\n`);
  const body = crypto.randomBytes(4096), name = 'pf-feed-proof-0.2.62-full.nupkg';
  const releases = `${sha1(body)} ${name} ${body.length}\r\n`;
  assert.deepStrictEqual(U.parseReleases(releases).map((r) => [r.file, r.version, r.full]), [[name, '0.2.62', true]]);

  const seen = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    seen.push({ path: u.pathname, query: u.search, headers: Object.keys(req.headers).sort(), ua: req.headers['user-agent'] || '' });
    let m;
    if ((m = /^\/otissy\/parakeet-flow\/releases\/latest\/download\/(.+)$/.exec(u.pathname))) { res.writeHead(302, { Location: `/otissy/parakeet-flow/releases/download/v0.2.62/${m[1]}${u.search}` }); return res.end(); }
    if ((m = /^\/otissy\/parakeet-flow\/releases\/download\/v0\.2\.62\/(.+)$/.exec(u.pathname))) {
      if (m[1] === 'RELEASES') { res.writeHead(200); return res.end(releases); }
      if (m[1] === name) { res.writeHead(200, { 'Content-Length': body.length }); return res.end(body); }
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const feed = `http://127.0.0.1:${srv.address().port}/otissy/parakeet-flow/releases/latest/download`;
  const run = (arg) => new Promise((resolve) => {
    const c = spawn(update, [arg], { cwd: appDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    const t = setTimeout(() => c.kill(), 60000);
    c.on('exit', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
  try {
    const check = await run('--checkForUpdate=' + feed);
    assert.equal(check.code, 0, check.out);
    const line = check.out.split(/\r?\n/).filter((l) => l.startsWith('{')).pop();
    const j = JSON.parse(line);
    assert.equal(j.currentVersion, '0.2.61');
    assert.equal(j.futureVersion, '0.2.62');
    assert.equal(j.releasesToApply.length, 1);
    const rel = seen.find((s) => s.path.endsWith('/latest/download/RELEASES'));
    assert.ok(rel, 'asked the feed for RELEASES');
    assert.ok(seen.some((s) => s.path.endsWith('/download/v0.2.62/RELEASES')), 'and followed the redirect');
    // exactly what a check tells the server (README says so): app id, installed version, architecture
    const q = new URLSearchParams(rel.query);
    assert.deepStrictEqual([...q.keys()].sort(), ['arch', 'id', 'localVersion']);
    assert.equal(q.get('localVersion'), '0.2.61');
    assert.ok(!rel.headers.includes('cookie') && !rel.headers.includes('authorization'));
    const dl = await run('--download=' + feed);
    assert.equal(dl.code, 0, dl.out);
    assert.ok(seen.some((s) => s.path.endsWith('/latest/download/' + name)), 'the nupkg is fetched from the feed by its RELEASES name');
    const got = path.join(appDir, 'packages', name);
    assert.ok(fs.existsSync(got) && fs.readFileSync(got).equals(body), 'downloaded intact into the scratch folder only');
  } finally {
    await new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); });
    fs.rmSync(top, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('Squirrel refuses a nupkg whose bytes do not match RELEASES', { skip: hasSquirrel ? false : 'electron-winstaller vendor missing' }, async () => {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-feed-'));
  const appDir = path.join(top, 'pf-feed-proof');
  fs.mkdirSync(path.join(appDir, 'packages'), { recursive: true });
  const update = path.join(appDir, 'Update.exe');
  fs.copyFileSync(SQUIRREL, update);
  const old = Buffer.from('x');
  fs.writeFileSync(path.join(appDir, 'packages', 'RELEASES'), `${sha1(old)} pf-feed-proof-0.2.61-full.nupkg 1\r\n`);
  const body = crypto.randomBytes(100), name = 'pf-feed-proof-0.2.62-full.nupkg';
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/RELEASES')) { res.writeHead(200); return res.end(`${sha1(Buffer.from('other'))} ${name} ${body.length}\r\n`); }
    res.writeHead(200); res.end(body);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const r = await new Promise((resolve) => { const c = spawn(update, [`--download=http://127.0.0.1:${srv.address().port}`], { windowsHide: true, stdio: 'ignore' }); const t = setTimeout(() => c.kill(), 60000); c.on('exit', (code) => { clearTimeout(t); resolve(code); }); });
    assert.notEqual(r, 0, 'the download fails');
  } finally {
    await new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); });
    fs.rmSync(top, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('checkReleaseFolder: names, sizes and hashes must match, and a name with spaces is refused (GitHub would rename the asset)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-rel-'));
  const body = Buffer.from('package');
  fs.writeFileSync(path.join(d, 'parakeet-flow-0.2.62-full.nupkg'), body);
  fs.writeFileSync(path.join(d, 'RELEASES'), `${sha1(body)} parakeet-flow-0.2.62-full.nupkg ${body.length}\r\n`);
  assert.deepStrictEqual(checkReleaseFolder(d).map((r) => r.file), ['parakeet-flow-0.2.62-full.nupkg']);
  fs.writeFileSync(path.join(d, 'RELEASES'), `${sha1(body)} parakeet-flow-0.2.63-full.nupkg ${body.length}\r\n`);
  assert.throws(() => checkReleaseFolder(d), /not in the folder/);
  fs.writeFileSync(path.join(d, 'RELEASES'), `${sha1(body)} parakeet-flow-0.2.62-full.nupkg ${body.length + 1}\r\n`);
  assert.throws(() => checkReleaseFolder(d), /size/);
  fs.writeFileSync(path.join(d, 'RELEASES'), `${sha1(Buffer.from('z'))} parakeet-flow-0.2.62-full.nupkg ${body.length}\r\n`);
  assert.throws(() => checkReleaseFolder(d), /SHA1/);
  fs.writeFileSync(path.join(d, 'RELEASES'), 'nothing');
  assert.throws(() => checkReleaseFolder(d), /no release/);
});

const builtDir = process.env.PF_BUILT_DIR || path.join(process.env.PF_BUILDS || 'D:/builds/parakeet-flow', require(path.join(root, 'package.json')).version);
const sq = path.join(builtDir, 'squirrel-windows');
test('the built RELEASES names exactly the nupkg that gets uploaded, for this version', { skip: fs.existsSync(path.join(sq, 'RELEASES')) ? false : 'no build at ' + sq }, () => {
  const r = checkReleaseFolder(sq);
  assert.equal(r.length, 1);
  assert.equal(r[0].file, `parakeet-flow-${require(path.join(root, 'package.json')).version}-full.nupkg`);
  assert.equal(r[0].full, true);
});
