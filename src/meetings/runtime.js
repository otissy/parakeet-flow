'use strict';
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const VERSION = '0.2.0';
const MODELS = {
  asr: 'parakeet-tdt',
  diarization: 'nemotron-3-diarization',
};
const RELEASES = {
  cuda: {
    archive: `nemo-speech-${VERSION}-windows-x86_64-cuda.zip`,
    bytes: 102183465,
    sha256: '9ffe5e842c39a7d3211f3b2c3b3aa1bca8c0b2455d96d961ed5f22ec5108f98d',
  },
  cpu: {
    archive: `nemo-speech-${VERSION}-windows-x86_64-cpu.zip`,
    bytes: 5528418,
    sha256: '82c80451086e86194aba9af19f800da77cd66d1c28d993d0efceffd6cdb49bb8',
  },
};
const RELEASE_BASE = `https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v${VERSION}/`;
const TRUSTED_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const MAX_STDOUT = 40 * 1024 * 1024;
const MAX_STDERR = 1024 * 1024;

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

function download(url, dest, { bytes, sha256, onProgress, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !TRUSTED_HOSTS.has(parsed.hostname)) return reject(new Error('Refusing an untrusted NeMo runtime download URL'));
    const req = https.get(parsed, { headers: { 'User-Agent': 'parakeet-flow' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(download(new URL(res.headers.location, parsed).toString(), dest, { bytes, sha256, onProgress, redirects: redirects - 1 }));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} downloading NeMo-Speech.cpp`)); return; }
      const output = fs.createWriteStream(dest, { flags: 'wx' });
      const hash = crypto.createHash('sha256');
      let got = 0;
      res.on('data', (chunk) => {
        hash.update(chunk);
        got += chunk.length;
        if (onProgress) onProgress(got, Number(res.headers['content-length'] || bytes || 0));
      });
      res.pipe(output);
      output.on('finish', () => {
        const actual = hash.digest('hex');
        if (got !== bytes || actual !== sha256) {
          fs.rmSync(dest, { force: true });
          reject(new Error('NeMo-Speech.cpp download failed its size or SHA-256 check'));
          return;
        }
        resolve({ bytes: got, sha256: actual });
      });
      output.on('error', (error) => { res.destroy(); fs.rmSync(dest, { force: true }); reject(error); });
      res.on('error', (error) => { output.destroy(); fs.rmSync(dest, { force: true }); reject(error); });
    });
    req.on('error', (error) => { fs.rmSync(dest, { force: true }); reject(error); });
  });
}

function run(executable, args, { cwd, env, maxStdout = MAX_STDOUT, maxStderr = MAX_STDERR, onOutput, onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (onSpawn) onSpawn(child);
    let stdout = '', stderr = '', settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > maxStdout) { child.kill(); fail(new Error('NeMo-Speech.cpp returned too much output')); }
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr = (stderr + text).slice(-maxStderr);
      if (onOutput) onOutput(text);
    });
    child.once('error', fail);
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`NeMo-Speech.cpp exited with code ${code}: ${stderr.trim().slice(-300) || 'no diagnostic output'}`));
    });
  });
}

function preferredBackend() {
  if (process.platform !== 'win32') throw new Error('The bundled NeMo-Speech.cpp runtime is currently configured for Windows');
  try {
    const result = spawnSync('nvidia-smi', ['-L'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000, windowsHide: true });
    return result.status === 0 && result.stdout.trim() ? 'cuda' : 'cpu';
  } catch (_) {
    return 'cpu';
  }
}

function progressPercent(text) {
  const match = String(text).match(/(?:^|\s)(\d{1,3}(?:\.\d+)?)%/);
  return match ? Math.min(100, Math.max(0, Number(match[1]))) : null;
}

class NemoRuntime {
  constructor({ userData, onProgress = () => {}, backend = null } = {}) {
    this.baseDir = path.join(userData, 'meetings', 'nemo-speech');
    this.onProgress = onProgress;
    this.backend = backend;
    this.setupPromise = null;
    this.child = null;
  }

  _backend() {
    if (!this.backend) this.backend = preferredBackend();
    return this.backend;
  }

  _paths() {
    const backend = this._backend();
    const release = RELEASES[backend];
    const runtimeDir = path.join(this.baseDir, `runtime-${backend}`, `nemo-speech-${VERSION}-windows-x86_64-${backend}`);
    return {
      backend, release, runtimeDir,
      exe: path.join(runtimeDir, 'bin', 'nemo-speech.exe'),
      modelDir: path.join(this.baseDir, 'models'),
      readyFile: path.join(this.baseDir, `ready-${backend}.json`),
    };
  }

  async _runNative(executable, args, options = {}) {
    let child = null;
    try {
      return await run(executable, args, {
        ...options,
        onSpawn: (started) => { child = started; this.child = started; },
      });
    } finally {
      if (this.child === child) this.child = null;
    }
  }

  status() {
    const p = this._paths();
    let ready = false;
    try {
      const marker = JSON.parse(fs.readFileSync(p.readyFile, 'utf8'));
      ready = marker.version === VERSION && marker.sha256 === p.release.sha256 && fs.existsSync(p.exe);
    } catch (e) {
      if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e;
    }
    return { ready, backend: p.backend, runtimeVersion: VERSION };
  }

  async _ensureRuntime(p) {
    if (fs.existsSync(p.exe)) return p.exe;
    fs.mkdirSync(this.baseDir, { recursive: true });
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'parakeet-flow-nemo-'));
    const archive = path.join(work, p.release.archive);
    const extraction = path.join(work, 'extract');
    fs.mkdirSync(extraction);
    try {
      await download(RELEASE_BASE + p.release.archive, archive, {
        bytes: p.release.bytes,
        sha256: p.release.sha256,
        onProgress: (got, total) => this.onProgress({
          phase: 'runtime',
          percent: total ? Math.round((got / total) * 15) : 0,
          detail: `Downloading NVIDIA runtime (${Math.round(got / 1024 / 1024)} MB)`,
        }),
      });
      const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      if (!fs.existsSync(tar)) throw new Error('Windows tar.exe is required to extract the native NeMo-Speech runtime');
      await this._runNative(tar, ['-xf', archive, '-C', extraction], { cwd: work });
      const extracted = path.join(extraction, path.basename(p.runtimeDir));
      if (!fs.existsSync(path.join(extracted, 'bin', 'nemo-speech.exe'))) throw new Error('NeMo runtime archive did not contain the expected executable');
      fs.mkdirSync(path.dirname(p.runtimeDir), { recursive: true });
      if (fs.existsSync(p.runtimeDir)) fs.rmSync(p.runtimeDir, { recursive: true, force: true });
      fs.renameSync(extracted, p.runtimeDir);
      const version = await this._runNative(p.exe, ['--version'], { cwd: path.dirname(p.exe) });
      if (!version.stdout.includes(VERSION)) throw new Error(`Unexpected NeMo-Speech.cpp version: ${version.stdout.trim().slice(0, 100)}`);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
    return p.exe;
  }

  async _runCli(p, args, { phase, percentStart, percentSpan } = {}) {
    const env = { ...process.env, NEMO_SPEECH_MODEL_DIR: p.modelDir };
    const childArgs = ['--json', ...args];
    return this._runNative(p.exe, childArgs, {
      cwd: path.dirname(p.exe),
      env,
      onOutput: (text) => {
        const lines = text.replace(/\x1b\[[0-9;]*m/g, '').split(/[\r\n]+/).filter(Boolean);
        const detail = lines.at(-1);
        const ratio = progressPercent(text);
        this.onProgress({
          phase,
          percent: ratio === null ? percentStart : Math.min(99, Math.round(percentStart + (ratio / 100) * percentSpan)),
          detail: detail ? detail.slice(-180) : undefined,
        });
      },
    });
  }

  async _setup() {
    const p = this._paths();
    fs.mkdirSync(p.modelDir, { recursive: true });
    const current = this.status();
    if (current.ready) return current;
    this.onProgress({ phase: 'runtime', percent: 0, detail: `Preparing NVIDIA ${p.backend.toUpperCase()} runtime` });
    await this._ensureRuntime(p);
    this.onProgress({ phase: 'models', percent: 16, detail: 'Downloading Parakeet TDT speech model' });
    await this._runCli(p, ['pull', MODELS.asr], { phase: 'models', percentStart: 16, percentSpan: 55 });
    this.onProgress({ phase: 'models', percent: 72, detail: 'Downloading Nemotron speaker model' });
    await this._runCli(p, ['pull', MODELS.diarization], { phase: 'models', percentStart: 72, percentSpan: 26 });
    fs.writeFileSync(p.readyFile, JSON.stringify({ version: VERSION, sha256: p.release.sha256, readyAt: Date.now() }));
    this.onProgress({ phase: 'ready', percent: 100, detail: 'Meeting models are ready' });
    return this.status();
  }

  ensureReady() {
    if (!this.setupPromise) {
      this.setupPromise = this._setup().finally(() => { this.setupPromise = null; });
    }
    return this.setupPromise;
  }

  async transcribe(audioFile) {
    const p = this._paths();
    const status = this.status();
    if (!status.ready) throw new Error('Set up the meeting speech models before recording');
    this.onProgress({ phase: 'transcribing', percent: 2, detail: 'Transcribing and assigning speakers' });
    const result = await this._runCli(p, [
      'transcribe', audioFile,
      '--model', MODELS.asr,
      '--diar-model', MODELS.diarization,
      '--format', 'json',
      '--device', 'auto',
      '--no-warmup',
    ], { phase: 'transcribing', percentStart: 4, percentSpan: 84 });
    try { return JSON.parse(result.stdout.trim()); } catch (_) { throw new Error('NeMo-Speech.cpp returned invalid transcript JSON'); }
  }

  close() {
    if (this.child && !this.child.killed) this.child.kill();
  }
}

module.exports = { NemoRuntime, RELEASES, VERSION, MODELS, preferredBackend, download, sha256File };
