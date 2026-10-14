'use strict';
/* MANUAL real-keys test (not in the ladder): types into harmless raw-mode echo programs that THIS script launches in
   NEW terminal windows placed off-screen (x=-6000). It never starts claude, never types into a window it did not create:
   every keystroke goes through pf-helper, which refuses unless the target hwnd is the foreground window at that moment.
   The previously focused window is restored at the end.
   run: PF_REPORT=<json> node .tests/terminals/real-terminals.js [conhost] [cmd] [pwsh] [powershell] [vscode]
   Needs the Windows .NET csc (already needed by the app). */
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { Win32Typer } = require(path.join(root, 'src/typer/win32-typer.js'));
const { DictationSession } = require(path.join(root, 'src/core/session.js'));
const { resolveProfile } = require(path.join(root, 'src/core/tone.js'));
const { FakeHost } = require(path.join(root, '.tests/asr/fakes.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const ECHO = path.join(__dirname, 'echo-raw.js');
const CTRL = 0x11;

function buildTool(dir) {
  const exe = path.join(dir, 'wintool.exe');
  const r = spawnSync(CSC, ['-nologo', '-out:' + exe, path.join(__dirname, 'WinTool.cs')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('wintool build failed ' + r.stdout + r.stderr);
  return exe;
}

/** what a raw-mode prompt would hold after these bytes: printable chars append, DEL/BS remove one code point, LF is a soft newline, CR = ENTER (submit) */
function model(hex) {
  const s = Buffer.from(hex, 'hex').toString('utf8');
  const buf = []; const m = { enter: 0, ctrl: [], esc: 0, bs: { del: 0, bsp: 0 } };
  const cs = Array.from(s);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i], n = c.codePointAt(0);
    if (c === '\x7f') { buf.pop(); m.bs.del++; }
    else if (c === '\x08') { buf.pop(); m.bs.bsp++; }
    else if (c === '\r') m.enter++;
    else if (c === '\n') buf.push('\n');
    else if (c === '\x1b') { m.esc++; if (cs[i + 1] === '[' || cs[i + 1] === 'O') { i++; while (i + 1 < cs.length && !/[A-Za-z~]/.test(cs[i])) i++; } }
    else if (n < 0x20) m.ctrl.push('0x' + n.toString(16));
    else buf.push(c);
  }
  return { text: buf.join(''), ...m, bytes: s.length };
}

/** one terminal target: the typer/typing scenarios, shared by the console targets and VS Code */
async function scenarios({ typer, hwnd, rep, lines, sleep: slp, ensureFg, quiet }) {
  const opts = { hwnd };
  const clipHash = () => new Promise((res) => { const h = (a) => { if (a[0] === 'CLIP') { typer.off('line', h); res(a[1] ? require('crypto').createHash('sha1').update(a[1]).digest('hex').slice(0, 10) : 'none'); } }; typer.on('line', h); typer.raw('CLIPGET'); setTimeout(() => { typer.off('line', h); res('timeout'); }, 3000); });
  const clipBefore = await clipHash();
  let mark = 0;
  const since = () => model(lines().slice(mark).map((x) => x.hex).join(''));
  const settle = async (ms = 500) => { let n = -1; for (let i = 0; i < 60; i++) { const c = lines().length; if (c === n) break; n = c; await slp(ms); } };
  /** wait until the received text satisfies pred (or timeout): arrival can lag far behind SendInput on a console */
  const waitFor = async (pred, timeoutMs = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { if (pred(since())) break; await slp(100); } return Date.now() - t0; };
  const reset = async () => { await settle(250); if (quiet) await quiet(); if (ensureFg) await ensureFg(); mark = lines().length; };
  const raw = () => lines().slice(mark).map((x) => x.hex).join('');
  const keyDump = () => Buffer.from(raw(), 'hex').toString('utf8').replace(/[\x00-\x1f\x7f]/g, (c) => '<' + c.charCodeAt(0).toString(16) + '>');

  // 1 ASCII
  await reset(); typer.type('hello world', opts); await settle();
  rep.steps.ascii = { want: 'hello world', got: since().text, ok: since().text === 'hello world', raw: keyDump() };
  // 2 Backspace: exactly the intended characters
  await reset(); typer.type('abc def', opts); typer.backspace(4, opts); await settle();
  rep.steps.backspace = { want: 'abc', got: since().text, ok: since().text === 'abc', raw: keyDump(), keys: since().bs };
  // 3 Wispr style through the real DictationSession: the live partials only preview, the finals go in ONCE on release (method = PF_METHOD: burst | paste).
  //   Repeated RUNS times; a run is a defect when the received text is not exactly the intended text.
  const METHOD = process.env.PF_METHOD || 'burst';
  const live = !!process.env.PF_LIVE;
  const mk = (extra = {}) => new DictationSession({ asr: new FakeHost(), typer, now: () => Date.now(), ownPid: process.pid,
    settings: { deferred: !live, insert: { terminal: METHOD, other: METHOD }, tone: { enabled: true, apps: [] }, ...extra } });
  const runSession = async () => {
    const s = mk(); const host = s.asr;
    let res = null; s.on('result', (x) => { res = x; });
    const okStart = s.start();
    for (const p of ['Hello', 'Hello wor', 'Hello word', 'Hello world is', 'Hello world it is a nice', 'Hello world it is a nice day.']) { host.emitEv('partial', { segId: 1, text: p }); await slp(60); }
    host.emitEv('final', { segId: 1, text: 'Hello world, it is a nice day.' }); await slp(50);
    host.emitEv('partial', { segId: 2, text: 'Second' }); await slp(50); host.emitEv('partial', { segId: 2, text: 'Second sentence here' }); await slp(50);
    host.emitEv('final', { segId: 2, text: 'Second sentence here.' });
    s.release(); host.emitEv('done', {});
    return { okStart, profile: s.profile, res };
  };
  {
    const want = 'hello world, it is a nice day. second sentence here.';
    const RUNS = Number(process.env.PF_RUNS || 6); let defects = 0, refused = 0, last = null, enters = 0, bsKeys = 0, firstBad = null;
    for (let i = 0; i < RUNS; i++) {
      await reset(); const r = await runSession();
      await waitFor((m) => m.text.length >= want.length, 8000); await settle(300);
      const m = since(); last = r; enters += m.enter; bsKeys += m.bs.del + m.bs.bsp;
      if (m.text !== want) { if (want.startsWith(m.text)) refused++; else { defects++; if (!firstBad) firstBad = m.text + ' RAW=' + keyDump().slice(0, 60); } }
    }
    rep.steps.session = { method: live ? 'live' : METHOD, runs: RUNS, corrupt: defects, refusedOrShort: refused, want, firstBad, profile: last && last.profile, enter: enters, backspaceKeys: bsKeys, ok: defects === 0 && enters === 0 && refused === 0 };
  }
  // 4 non-ASCII
  const uni = 'café ëüï “quoted” ‘single’ naïve — €5 Ünïcode 日本語';
  await reset(); typer.type(uni, opts); await settle();
  rep.steps.unicode = { want: uni, got: since().text, ok: since().text === uni };
  // 4b astral (emoji) and its Backspace (code-point counting)
  await reset(); typer.type('ok 😀', opts); await settle(); const emo = since().text;
  typer.backspace(1, opts); await settle(); const emo2 = since().text;
  rep.steps.emoji = { typed: emo, afterBackspace1: emo2, ok: emo === 'ok 😀' && emo2 === 'ok ' };
  // 5 stress: 480 words (word0..word96 x5) as 6 segments with partial/final cadence, RUNS_LONG times
  {
    const words = []; for (let i = 0; i < 480; i++) words.push('word' + (i % 97));
    const want = words.join(' ');
    const RL = Number(process.env.PF_RUNS_LONG || 2); const out = [];
    for (let run = 0; run < RL; run++) {
      await reset();
      const s = mk(); const host = s.asr; s.start();
      for (let seg = 1; seg <= 6; seg++) {
        const w = words.slice((seg - 1) * 80, seg * 80);
        for (const n of [40, 77, 80]) { host.emitEv('partial', { segId: seg, text: (n === 77 ? w.slice(0, 76).join(' ') + ' xx' : w.slice(0, n).join(' ')) }); await slp(30); }
        host.emitEv('final', { segId: seg, text: w.join(' ') }); await slp(20);
      }
      const t0 = Date.now(); s.release(); host.emitEv('done', {});
      const ms = await waitFor((m) => m.text.length >= want.length); await settle(600);
      const m = since();
      out.push({ gotChars: m.text.length, exact: m.text === want, short: m.text !== want && want.startsWith(m.text), enter: m.enter, drainMs: Date.now() - t0, badTokens: m.text.split(' ').filter((w) => !/^word[0-9]+$/.test(w)).length, doubleSpaces: (m.text.match(/ {2}/g) || []).length });
    }
    rep.steps.long = { method: live ? 'live' : METHOD, wantChars: want.length, runs: RL, corrupt: out.filter((o) => !o.exact && !o.short).length, refusedOrShort: out.filter((o) => o.short).length, perRun: out, ok: out.every((o) => o.exact) };
  }
  // 5b six consecutive holds through the real Controller + session + helper (the duplicated / glued text seen on 2026-10-14): each utterance exactly once, in order, one space between
  {
    const { Controller } = require(path.join(root, 'src/main/controller.js'));
    const { Store } = require(path.join(root, 'src/main/settings.js'));
    const dir = fs.mkdtempSync(path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'pf-multi-'));
    const store = new Store(dir); store.set({ typing: { live, terminalMethod: METHOD, otherMethod: METHOD }, commands: { enabled: false }, notes: { enabled: false } });
    const host = new FakeHost();
    const c = new Controller({ getAsr: () => host, typer, store, mic: { start() {}, stop() {} }, ownPid: process.pid, doneFlashMs: 5 });
    const UT = ['Hello world, it is a nice day.', 'Second sentence here.', 'Btw I want you to make sure that you point me to the build folder.', 'Okay that was the last one.', 'Een zin met accenten: café.', 'And a sixth, short.'];
    const want = UT.map((u) => u.replace(/^./, (ch) => ch.toLowerCase())).join(' ');
    await reset();
    for (const u of UT) {
      c.fsm.down(Date.now()); await slp(320);
      host.emitEv('partial', { segId: 1, text: u.slice(0, 8) }); await slp(60);
      host.emitEv('final', { segId: 1, text: u, audioSec: 1 }); host.emitEv('final', { segId: 1, text: u, audioSec: 1 });   // a duplicate final, like VAD endpoint + release
      c.fsm.up(Date.now()); host.emitEv('done', {}); await slp(350);
    }
    await waitFor((m) => m.text.length >= want.length, 15000); await settle(500);
    const m = since();
    rep.steps.multiHold = { method: live ? 'live' : METHOD, holds: UT.length, want, got: m.text, ok: m.text === want, short: m.text !== want && want.startsWith(m.text), enter: m.enter };
  }
  // 6 newline: what "new line" presses here. auto = the per-window choice; shift-enter = the old behaviour, kept as the control
  for (const [label, mode] of [['newline', 'auto'], ['newlineShiftEnter', 'shift-enter'], ['newlineCtrlJ', 'ctrl-j']]) {
    typer.setNewline(mode);
    await reset(); typer.type('line1', opts); typer.type('\n', opts); typer.type('line2', opts); await settle();
    const nl = since();
    rep.steps[label] = { mode, got: JSON.stringify(nl.text), softNewline: nl.text === 'line1\nline2', enter: nl.enter, ctrl: nl.ctrl, raw: keyDump() };
  }
  typer.setNewline('auto');
  // 7 hold Ctrl (as when the hotkey is Ctrl+Space) while typing and correcting: no ctrl-modified keys may arrive
  await reset();
  typer.setHotkey([CTRL, 0x20]);
  typer.press(CTRL, true, hwnd); await slp(150);
  typer.type('aa bb cc', opts); await slp(200); typer.backspace(2, opts); await slp(200); typer.type('XX', opts); await settle(350);
  const held = since(); typer.press(CTRL, false, hwnd); await slp(200);
  rep.clipboard = { before: clipBefore, after: await clipHash() }; rep.clipboard.restored = rep.clipboard.before === rep.clipboard.after;
  rep.steps.ctrlHeld = { want: 'aa bb XX', got: held.text, ok: held.text === 'aa bb XX', ctrl: held.ctrl, raw: keyDump() };
}

async function runTarget(name, tool, outDir, report) {
  const rep = { name, steps: {} }; report.targets.push(rep);
  const log = path.join(outDir, name + '.log');
  const title = 'pf-term-test-' + name + '-' + process.pid;
  let hwnd = 0, pid = 0, typer = null;
  const wt = (...a) => execFileSync(tool, a.map(String), { encoding: 'utf8' }).trim();
  const shell = {
    conhost: [process.execPath, [ECHO, log]],
    cmd: [process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', ['/c', process.execPath, ECHO, log]],
    pwsh: [path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'pwsh.exe'), ['-NoProfile', '-NoLogo', '-Command', `& '${process.execPath}' '${ECHO}' '${log}'`]],
    powershell: [path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NoLogo', '-Command', `$Host.UI.RawUI.WindowTitle='${title}'; & '${process.execPath}' '${ECHO}' '${log}'`]],
  }[name];
  try {
    const r = wt('launch', -6000, 80, title, shell[0], ...shell[1]);
    if (!r.startsWith('OK')) throw new Error('launch: ' + r);
    [hwnd, pid] = r.split(' ').slice(1).map(Number);
    rep.rect = wt('rect', hwnd);
    for (let i = 0; i < 60 && !fs.existsSync(log); i++) await sleep(100);
    if (!fs.existsSync(log)) throw new Error('echo program never started');
    rep.ready = JSON.parse(fs.readFileSync(log, 'utf8').split('\n')[0]);
    typer = new Win32Typer({ binDir: path.join(outDir, 'bin'), test: true });
    await typer.ready; typer.on('line', () => {});
    const ensureFg = async () => {
      for (let i = 0; i < 12; i++) {
        typer.queryForeground(); await sleep(100);
        if (typer.foreground() && typer.foreground().hwnd === hwnd) return true;
        rep.refg = (rep.refg || 0) + 1; wt('fg', hwnd);
      }
      return false;
    };
    await ensureFg();
    const fg = typer.foreground();
    rep.helperFg = fg && { hwnd: fg.hwnd, proc: fg.proc, title: fg.title.replace(title, '<title>'), cls: fg.cls };
    if (!fg || fg.hwnd !== hwnd) throw new Error('window never became foreground; nothing was typed');
    rep.tone = resolveProfile(fg, { enabled: true, apps: [] });
    const lines = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.hex);
    // the user's own keyboard must be idle: a physically held Ctrl would turn every typed letter into a shortcut
    const quiet = async () => { for (let i = 0; i < 100; i++) { const m = Number(wt('mods').split(' ')[1]); if (!m) return; rep.waitedForModifiers = (rep.waitedForModifiers || 0) + 1; await sleep(200); } };
    await scenarios({ typer, hwnd, rep, lines, sleep, ensureFg, quiet });
  } catch (e) { rep.error = String(e.stack || e).split('\n').slice(0, 3).join(' | '); }
  try { if (typer) { typer.press(CTRL, false, hwnd); await sleep(100); typer.close(); } } catch (_) { /* gone */ }
  try { if (hwnd) wt('close', hwnd); await sleep(400); if (pid) wt('kill', pid); } catch (_) { /* gone */ }
  return rep;
}

module.exports = { model, scenarios, buildTool, ECHO };

if (require.main === module) {
  (async () => {
    const base = process.env.PF_TERM_DIR || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'pf-term-tests');   // not %TEMP%: other jobs sweep it
    fs.mkdirSync(base, { recursive: true });
    const outDir = fs.mkdtempSync(path.join(base, 'run-'));
    const report = { node: process.version, targets: [] };
    const want = process.argv.slice(2).length ? process.argv.slice(2) : ['conhost'];
    let tool, prev;
    try {
      tool = buildTool(outDir);
      prev = execFileSync(tool, ['curfg'], { encoding: 'utf8' }).trim().split(' ')[1];
      for (const n of want) if (n !== 'vscode') await runTarget(n, tool, outDir, report);
      if (want.includes('vscode')) report.vscode = await require('./vscode-part.js')({ tool, outDir });
    } catch (e) { report.error = String(e.stack || e); }
    try { if (prev && prev !== '0') execFileSync(tool, ['fg', prev]); } catch (_) { /* previous window gone */ }
    fs.writeFileSync(process.env.PF_REPORT || path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
    console.log(JSON.stringify(report, null, 1));
    process.exit(0);
  })();
}
