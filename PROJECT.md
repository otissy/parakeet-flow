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

## Known problems

- **2026-10-13** Real Notion sync, Dutch voice commands on real audio, translation quality and a real microphone in whisper mode are unverified.
- **2026-10-13** Norton deleted llama-server.exe (llama.cpp b11583 launcher) from %APPDATA% after a few runs; node-llama-cpp is used instead.

- **2026-10-13** � sherpa-onnx npm build has no GPU support; provider `cuda` falls back to CPU. Dutch accuracy untested (no Dutch TTS voice). The microphone path (getUserMedia + AudioWorklet) was not run: no mic exercised, tests use a wav fed through the same pipeline.
- **2026-10-13** Ctrl+Space chord, not verifiable here: real hardware key events through the hook (only injected events were exercised), the Windows IME toggle itself, VS Code completion, and Alt/Win held as chord modifiers (releasing Alt or Win alone can pop the menu bar / Start menu; Ctrl is safe). A chosen lone Pause from before hotkeyV 2 cannot be told from the old default and is moved once. Auto-repeat of a held modifier during the sub-millisecond SendInput burst cannot interleave (one call), but the system-wide 300 ms hook timeout is the limit if the helper stalls.
- **2026-10-13** � final correction may exceed the 40-backspace live cap (bounded 400) so a mangled partial cannot stay.

## Dropped approaches

- **2026-10-13** llama.cpp llama-server as a child process: antivirus removed the launcher stub; replaced by node-llama-cpp in a worker thread.
