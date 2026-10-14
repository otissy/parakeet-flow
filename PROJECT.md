# PROJECT.md — parakeet-flow

The map of the ground. Read before any task; update at the end of every task.

## Current state

Windows-native Electron app (2026-10-13, scaffold only): hold a global hotkey, speak, partial
words are typed into the focused app while talking, corrected in place, settled on release.
Tray + click-through floating pill. Everything local. Built and tested 2026-10-13: engine, live typing, helper, tray, pill, main window. See README.

## How to run and test

- run: `npm start` (uses node_modules/electron 31.7.7)
- test: `node ~/.claude/skills/plan/ladder.js .tests/<feature>` (node:test, TAP via ladder)
- models: downloaded once into `%APPDATA%\parakeet-flow\models`, SHA-256 verified (see README)

## Limits

| Limit | What it means |
|---|---|
| Node 26.11 on PATH, Electron 31.7.7 (Node 20) | native addons must be N-API; sherpa-onnx-node 1.13.8 is |
| `sherpa-onnx-win-x64` is CPU-only | GPU provider cannot be verified here; setting falls back to CPU |
| Parakeet TDT is an offline model | partials = re-decode of the growing VAD segment, not streaming |
| `npm i electron` postinstall extracted only `locales/` here | dist/ was unpacked by hand from the hash-checked cache zip |
| RTX 3050 shared with Rocket League + OBS | default CPU int8; keep CPU use modest |
| no key-up in `globalShortcut` | a C# helper (compiled from our own source with .NET Framework csc) polls GetAsyncKeyState |
| PowerShell tool is broken in this agent shell | use Bash; Norton flags `powershell.exe` (approved once), so the app never spawns it |
| Backspace + held Ctrl/Alt/Win = word-delete etc. | default hotkey is Ctrl+Space (decided 2026-10-13, hotkeyV 2); the helper sends a logical Ctrl-up / keystrokes / Ctrl-down (only if still held) in ONE SendInput call around every burst. Rejected: Shift+Left select-and-overtype, deferring corrections until release. Proof: `.tests/ctrlspace/` (L1-L4 simulated) and `real-ctrl-space.js` (own window, real keys) |
| CapsLock toggle (2026-10-13, gestureV 3) | hold = Ctrl+Space, toggle = CapsLock (no double-tap). The helper hook swallows CapsLock down/repeat/up only while `TOGGLE 20` is set (switch on, not paused, no picker open); the helper never sends or reads CapsLock. Precedence: hold wins, a hold during a toggle session never stops it. Hook is process-bound: helper exits on stdin EOF. Proof: `.tests/capslock/` (L1-L4) and `real-capslock.js` (real keys, GetKeyState before/after, `proof/capslock-real-window.json`) |
| Ctrl+Space is the Windows IME toggle / VS Code completion | the helper's WH_KEYBOARD_LL hook swallows the chord's Space only while dictation can use it (claim off when paused, in the hotkey picker, or for a lone-key hotkey); Ctrl alone / Space alone always pass. Hook events tagged SELF (our own SendInput) are ignored; other injected input (remappers, remote desktop) counts as physical |
| Never log dictated text | logs carry counts and timings only |
| Helper process spawned before the windows loaded | on this machine Chromium never reached dom-ready for the pill; main.js starts the helper only after the pages loaded |
| Offscreen capture | tests set PF_OFFSCREEN (windows at x=-6000) plus disable-features=CalculateNativeWinOcclusion, else capturePage is blank |
| Child .tests run | `node ~/.claude/skills/plan/ladder.js` from the repo root; real-typing.js is manual (visible window) |

## Sources of truth

- model URLs, sizes, SHA-256 -> `src/asr/model-store.js`
- settings defaults -> `src/main/settings.js`

## Added 2026-10-13: commands, tone, translate, whisper, local-model cleanup, notes
Tests: .tests/{commands,tone,cleanup,notes,whisper,offparity}; .tests/features-e2e holds the shared Electron hook and the manual
real-newline.js. offparity compares today's typing with commit 185c72c (git show) on 2400 random scripts and on 4 real speech streams.
New limits: llm-runtime/ has its own package.json (install with --omit=optional, else CUDA/Vulkan packages add 600 MB); the model runs in a
worker thread, CPU only; commands match whole segments only; the pill window is 110 px high and now also holds the flag chips.
Settings and new keys: commands, tone, translate, whisper, cleanup, notes (no token in settings; token in secrets.json via safeStorage).

## Added 2026-10-13: Squirrel.Windows packaging (0.2.0)

What was wrong, diagnosed on this PC with the real app and the real data folder (offscreen windows, real microphone through the production capture path, real models, hotkey moved to F15 during the run): the app ran correctly from source and from the packaged build. Engine ready in about 1.8 s, the Behringer input delivered audio, dictation into an in-memory typer gave the full test sentence, the local model loaded. Not reproduced: a failure of the engine, microphone, native modules or windows (three monitors, one at negative x; the pill and window open on the primary screen). What the user saw is unknown. Causes that were real: the app had no installer, shortcut or uninstaller (only `npm start`); `npm start` dies silently when ELECTRON_RUN_AS_NODE is set in the shell (now cleared by scripts/start.js); a second start while a copy sits in the tray only shows its window. Not verifiable here: real hardware key events for the hotkey, Norton's reaction to the installer on other PCs.

Build recipe: `npm install --ignore-scripts`, `npm --prefix llm-runtime install --omit=optional --ignore-scripts`, `npm run installer` (writes D:/builds/parakeet-flow/<version>/squirrel-windows: Setup exe, nupkg, RELEASES). Proof: `node scripts/prove-install.js <Setup.exe> --out=<dir> --hook=scripts/proof-hook.js`.

| Limit | What it means |
|---|---|
| electron-builder 26.15.3 / electron-winstaller 5.4.0 | winstaller needs vendor/7z.exe from its script/select-7z-arch.js (scripts/build-installer.js runs it from inside that package; a relative-path script) |
| Output folder | EPERM when electron-builder deletes an old win-unpacked: every build goes to a NEW folder (D:/builds/parakeet-flow/<version>[-suffix]); build-installer refuses an existing one. Squirrel temp = D:/builds/parakeet-flow/tmp |
| asar off | sherpa-onnx native .node/.dll, llm-runtime (ESM, loaded by a worker) and the helper's .cs source must be real files; same choice as rl-screenswitcher. Installer 165 MB (no models) |
| Squirrel makes no shortcuts by itself | the app calls Update.exe --createShortcut (Start menu only) on --squirrel-install/-updated; src/main/squirrel.js |
| Squirrel uninstall leaves its own stub | Update.exe cannot delete the folder it runs from: %LOCALAPPDATA%/parakeet-flow keeps Update.exe (1.9 MB), a .dead marker and app-x/squirrel.exe; no app files, shortcut or registry entry remain. A detached cmd/rmdir cleanup was tried and dropped (it never ran, and a self-deleting cmd looks like malware to heuristic scanners). Delete the folder by hand or ignore it |
| Input helper | compiled ONCE at packaging time (version info, asInvoker manifest, icon; docs/antivirus.md) and shipped in src/typer/helper/bin; win32-typer uses it only when its .src-sha256 equals the hash of PfHelper.cs+AssemblyInfo.cs+pf-helper.manifest, else compiles into userData/bin. csc here is C# 5: no /deterministic, so every build has its own exe hash |
| Squirrel does not launch the app after a silent install | prove-install runs the installed exe itself |
| Unsigned | SmartScreen / Norton reputation warnings possible; no certificate was created |
| PNG to ICO crashes under Node 26 | assets/icon.ico is generated by scripts/make-icon.js (no dependencies) and committed |
| userData | pinned to %APPDATA%/parakeet-flow in main.js (a product name with a space would otherwise move it) |
| .tests/asr L4 acceptance | can fail by a word under heavy CPU load (other test runs in parallel); passes alone |

## Known problems

- **2026-10-13** Real Notion sync, Dutch voice commands on real audio, translation quality and a real microphone in whisper mode are unverified.
- **2026-10-13** Norton deleted llama-server.exe (llama.cpp b11583 launcher) from %APPDATA% after a few runs; node-llama-cpp is used instead.

- **2026-10-13** � sherpa-onnx npm build has no GPU support; provider `cuda` falls back to CPU. Dutch accuracy untested (no Dutch TTS voice). The microphone path (getUserMedia + AudioWorklet) was not run: no mic exercised, tests use a wav fed through the same pipeline.
- **2026-10-13** Ctrl+Space chord, not verifiable here: real hardware key events through the hook (only injected events were exercised), the Windows IME toggle itself, VS Code completion, and Alt/Win held as chord modifiers (releasing Alt or Win alone can pop the menu bar / Start menu; Ctrl is safe). A chosen lone Pause from before hotkeyV 2 cannot be told from the old default and is moved once. Auto-repeat of a held modifier during the sub-millisecond SendInput burst cannot interleave (one call), but the system-wide 300 ms hook timeout is the limit if the helper stalls.
- **2026-10-13** � final correction may exceed the 40-backspace live cap (bounded 400) so a mangled partial cannot stay.

## Dropped approaches

- **2026-10-13** llama.cpp llama-server as a child process: antivirus removed the launcher stub; replaced by node-llama-cpp in a worker thread.
