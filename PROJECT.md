# PROJECT.md — parakeet-flow

The map of the ground. Read before any task; update at the end of every task.

## Current state

Windows-native Electron app (2026-10-13, scaffold only): hold a global hotkey, speak, partial
words are typed into the focused app while talking, corrected in place, settled on release.
Tray + click-through floating pill. Everything local. Not yet built beyond the scaffold.

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
| Backspace + held Ctrl/Alt/Win = word-delete etc. | default hotkey is a lone key (Pause); modifier combos are released around corrections |
| Never log dictated text | logs carry counts and timings only |

## Sources of truth

- model URLs, sizes, SHA-256 -> `src/asr/model-store.js`
- settings defaults -> `src/main/settings.js`

## Known problems

none yet.

## Dropped approaches

none yet.
