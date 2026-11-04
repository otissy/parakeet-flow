# PROJECT.md — parakeet-flow

The map of the ground. Read before any task; update at the end of every task.

## Current state

Windows-native Electron app (2026-10-13, scaffold only): hold a global hotkey, speak, partial
words are typed into the focused app while talking, corrected in place, settled on release.
Tray + click-through floating pill. Everything local. Built and tested 2026-10-13: engine, live typing, helper, tray, pill, main window. See README.

## How to run and test

- run: `npm start` (uses node_modules/electron 45.2.2)
- test: `npm test` (all suites, one file at a time), or `node --test --test-concurrency=1 ".tests/<feature>/*.test.js"`; the browser tests need `npx playwright-core install chromium` once
- models: downloaded once into `%APPDATA%\parakeet-flow\models`, SHA-256 verified (see README)

## Limits

| Limit | What it means |
|---|---|
| Node on PATH may differ from Electron 45.2.2 (Node 24) | native addons must be N-API; sherpa-onnx-node 1.13.8 is |
| `sherpa-onnx-win-x64` is CPU-only | GPU provider cannot be verified here; setting falls back to CPU |
| Parakeet TDT is an offline model | partials = re-decode of the growing VAD segment, not streaming |
| Electron has no postinstall since 42 | `npx install-electron` (or the first `npm start`) downloads and checks dist/; `npm install --ignore-scripts` is unaffected |
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
- what customization sync may send -> `src/sync/allowlist.js`

## Added 2026-10-13: commands, tone, translate, whisper, local-model cleanup, notes
Tests: .tests/{commands,tone,cleanup,notes,whisper,offparity}; .tests/features-e2e holds the shared Electron hook and the manual
real-newline.js. offparity compares today's typing with commit 185c72c (git show) on 2400 random scripts and on 4 real speech streams.
New limits: llm-runtime/ has its own package.json (install with --omit=optional, else CUDA/Vulkan packages add 600 MB); the model runs in a
worker thread, CPU only; commands match whole segments only; the pill window is 110 px high and now also holds the flag chips.
Settings and new keys: commands, tone, translate, whisper, cleanup, notes (no token in settings; token in secrets.json via safeStorage).

## Added 2026-10-13: Squirrel.Windows packaging (0.2.0)

What was wrong, diagnosed on this PC with the real app and the real data folder (offscreen windows, real microphone through the production capture path, real models, hotkey moved to F15 during the run): the app ran correctly from source and from the packaged build. Engine ready in about 1.8 s, the Behringer input delivered audio, dictation into an in-memory typer gave the full test sentence, the local model loaded. Not reproduced: a failure of the engine, microphone, native modules or windows (three monitors, one at negative x; the pill and window open on the primary screen). What the user saw is unknown. Causes that were real: the app had no installer, shortcut or uninstaller (only `npm start`); `npm start` dies silently when ELECTRON_RUN_AS_NODE is set in the shell (now cleared by scripts/start.js); a second start while a copy sits in the tray only shows its window. Not verifiable here: real hardware key events for the hotkey, Norton's reaction to the installer on other PCs.

Build recipe: `npm install --ignore-scripts`, `npx install-electron`, `npm --prefix llm-runtime install --omit=optional --ignore-scripts`, `npm run installer` (writes D:/builds/parakeet-flow/<version>/squirrel-windows: Setup exe, nupkg, RELEASES). Proof: `node scripts/prove-install.js <Setup.exe> --out=<dir> --hook=scripts/proof-hook.js`.

| Limit | What it means |
|---|---|
| electron-builder 26.18.0 / electron-winstaller 5.4.0 | winstaller needs vendor/7z.exe from its script/select-7z-arch.js (scripts/build-installer.js runs it from inside that package; a relative-path script) |
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

- **2026-10-14** 0.2.1 installer bundles mcp/ + skill; its silent install/uninstall was NOT re-run because an install of 0.2.0 exists in %LOCALAPPDATA%/parakeet-flow (prove-install refuses to touch it). Run scripts/prove-install.js on a PC without an install. The built 0.2.1 app was run off-screen from D:/builds/parakeet-flow/0.2.1/win-unpacked with a scratch user-data folder: engine ready, shipped helper used (nothing compiled), mcp/server.js answers initialize.

- **2026-10-24** 0.2.3 installer rebuild aligns the app and helper version metadata to 0.2.3; installing it over 0.2.2 must be verified to preserve the existing per-user install and pinned shortcut.
- **2026-10-14** 0.2.2 installer (D:/builds/parakeet-flow/0.2.2) adds slang packs, LICENSE and NOTICE. Not run: silent install/uninstall (a real 0.2.1 install is live, updated with Update.exe --update). The squirrel L4 packaging test checks the built win-unpacked folder against the source tree.

## Known problems

- **2026-10-14** Unverified: a real Claude Code session (its Ink input handling is where live Backspace typing broke), a real Notion write through Claude Code, paste insertion in Windows Terminal (not installed) and VS Code's terminal (only starts as a visible window, skipped on the user's rule), Ctrl+Shift+Space through the real keyboard hook (only injected/simulated events were exercised), self-corrections like "no wait, Tuesday" (not done: the 0.6B cleanup model cannot do it reliably).
- **2026-10-14** The terminal harness measures with the foreground stolen away from its off-screen windows many times (54 in one run): something on this PC grabs focus; the helper refuses to type then, so runs come out "short", never corrupt.
- **2026-10-14** `mcp/` must stay a normal folder next to `src/` (it requires `../src/notes/outbox.js` and its own `node_modules`); the installer ships it unpacked since 0.2.1 (asar is off). Stale part removed 2026-11-03: packaging is done. Still true: the installed app does not carry Node, so the documented `claude mcp add ... -- node "<path>\mcp\server.js"` needs Node on the user's PC (the bundled Electron exe runs the same file with ELECTRON_RUN_AS_NODE=1; verified 2026-11-03, not yet offered in Settings).

- **2026-10-13** Real Notion sync, Dutch voice commands on real audio, translation quality and a real microphone in whisper mode are unverified.
- **2026-10-13** Norton deleted llama-server.exe (llama.cpp b11583 launcher) from %APPDATA% after a few runs; node-llama-cpp is used instead.

- **2026-10-13** � sherpa-onnx npm build has no GPU support; provider `cuda` falls back to CPU. Dutch accuracy untested (no Dutch TTS voice). The microphone path (getUserMedia + AudioWorklet) was not run: no mic exercised, tests use a wav fed through the same pipeline.
- **2026-10-13** Ctrl+Space chord, not verifiable here: real hardware key events through the hook (only injected events were exercised), the Windows IME toggle itself, VS Code completion, and Alt/Win held as chord modifiers (releasing Alt or Win alone can pop the menu bar / Start menu; Ctrl is safe). A chosen lone Pause from before hotkeyV 2 cannot be told from the old default and is moved once. Auto-repeat of a held modifier during the sub-millisecond SendInput burst cannot interleave (one call), but the system-wide 300 ms hook timeout is the limit if the helper stalls.
- **2026-10-13** � final correction may exceed the 40-backspace live cap (bounded 400) so a mangled partial cannot stay.

## Dropped approaches

- **2026-10-13** llama.cpp llama-server as a child process: antivirus removed the launcher stub; replaced by node-llama-cpp in a worker thread.

## Added 2026-10-14: Wispr-style insertion, terminals, notes routing, MCP server
- **Default flow changed (why):** the user dictated into the Claude Code prompt and got "hello wor ld i, it  is a nice day  second  sentence here" and, on a 480-word stress test, a defect every 8-12 words. Cause: live partial typing with Backspace corrections into a raw-mode TUI, which batches and drops rapid key bursts. Now (`typing.live` false) nothing is typed while the key is held: the pill shows the live words and the finished text is inserted ONCE on release (`LiveTyper` deferred mode, `src/core/live-typer.js`). The old behaviour stays as "Type while I speak (experimental)".
- **Insert methods** (`src/core/insert-method.js`, per-app table in Settings): `burst` = one paced SendInput of Unicode key events (24-character slices, 8 ms apart, focus re-checked before every slice; a slice never goes anywhere but the target window); `paste` = PfHelper PASTE: every memory format of the clipboard saved, text set (kept out of clipboard history and cloud sync), Ctrl+V, old clipboard restored 220 ms later unless somebody changed it meanwhile; if the clipboard holds something that cannot be restored exactly (GDI-handle formats) nothing is pasted and the text is typed instead. Measured in a classic console window (conhost, running a raw-mode node echo): burst exact, paste/Shift+Insert NOT delivered (the program receives 0x16 / ESC[2;2~), so the default everywhere is burst. Windows Terminal is not installed here and VS Code was not run (a visible window, see Known problems), so paste there is untested: the table lets the user switch an app to paste.
- **Terminals:** in a classic console window the window's owner process is the program running in it (`node.exe`, `cmd.exe`, `powershell.exe`, `claude.exe`), not conhost; `src/core/terminals.js` lists them and the window classes, the helper's FG line now carries the class. Terminals get the `code` tone: first-word capital skipped, punctuation kept. "New line" is Shift+Enter, which a console delivers as a plain Enter (it would send the prompt, measured), so in terminals it presses Ctrl+J (LF, measured) (`src/typer/newline.js`, setting). Optional "Press Enter after I finish", off.
- **Notes routing** (`src/core/routing.js`): the note-mode chord (default Ctrl+Shift+Space, `HOTKEY2` / `KEY2` in the helper, checked before the dictation chord) and the conservative fallback (Desktop/taskbar class, no window, own window => saved as a note, pill "Saved as note"). Never inside another program's window. A window change before release in Wispr mode saves the words as a note instead of losing them.
- **Notes file is shared by two processes** (app and `mcp/server.js`): `src/notes/outbox.js` re-reads under a lock file on every change (the old in-memory copy would have erased MCP-added notes on the next rewrite). The app polls the file once a second (`src/notes/service.js`) and refreshes the Notes page and the Markdown export. `mcp-status.json` is the only other file the server reads. See mcp/README.md.
- **Markdown export** (`src/notes/export-md.js`): one .md per note with front matter, stable file name `<date>-<slug>-<id>.md`.
- Tests: `.tests/terminals` (L2 Wispr + routing + terminal detection; `real-terminals.js` is the manual real-keys harness: launches its OWN console windows off-screen, never types into anything else, restores the previous foreground window; needs `PF_METHOD=burst|paste PF_LIVE=1`), `.tests/mcp` (L1-L4).

## Added 2026-10-14: slang packs

Code in `src/slang/` (matcher, import parser, pack validation, service, ipc, hotwords), UI in `src/renderer/slang-ui.js`, packs in
`src/slang/packs/`, user packs in `%APPDATA%parakeet-flowdictionarypacks`. Pipeline: `clean()` runs the matcher on finals after
snippets, before the Dictionary (Dictionary heard-texts are excluded from the matcher). Tests: `.tests/slang/` (L1-L4, real-Electron
UI hook, measurement tools in `.tests/slang/tools/`). Docs: docs/slang-packs.md.

| Limit | What it means |
|---|---|
| sherpa-onnx 1.13.8 hotwords on Parakeet TDT | work only with modified_beam_search + modelingUnit bpe + a bpeVocab; a plain hotwordsFile of words fails ("Cannot find ID for token"). The vocab is written from tokens.txt (all pieces equal cost). Opt-in (slang.biasing), restarts the engine. Score 3 hurts |
| Starter-pack misrecognitions | measured on Kokoro TTS (2 voices), not on real voices; Dutch not measured at all |
| Variants that are real words | dropped or kept deliberately; see docs/slang-packs.md Limits |
| Urban Dictionary | never scraped or shipped; the user may paste words (their call under its terms) |

Known problems: real-voice accuracy of the starter pack is unverified; only the Dictionary page UI exists (no Settings entry).

## Added 2026-10-25: add words + bias as a percentage (branch claude/add-words-bias, on the meetings merge)

- Bias is a whole percent everywhere (Dictionary > Bias strength slider/box, per-word Bias box, log line `bias=N%`, docs). The ONE
  conversion is `src/slang/bias.js` (UMD: main process and renderer): percent = score / 3 x 100, 1..100, default 50 (= 1.5).
  settings.json keeps `slang.biasing.score` (no version bump; old scores load as is, min clamp is now 0.03 instead of 0.1).
- Per-word bias: term field `bias` (percent) -> hotwords line `word :score`. Verified in sherpa-onnx 1.13.8 SOURCE only
  (utils.cc EncodeHotwords/EncodeBase, context-graph.cc); not measured on audio.
- Add a word (Dictionary) and quick add (Home transcript history, meeting transcripts: select text -> "Add to dictionary", or
  the row's add button with word buttons). Same service/IPC (`slang:add` now takes {packId} and `bias`; new `slang:undo-add`,
  `slang:set-bias`). Target packs: My terms or a user pack stored as `<id>.json`; built-in and .csv/.txt packs are refused.
  Duplicates merge case-insensitively (also heard-as spellings); emoji refused; undo = last add only.
- Engine restart debounce moved to `hotwords.settleRestart` (same 2.5 s, same condition) so it is testable.
- Tests: `.tests/addwords/` L1-L4. L4 = REAL renderer files in headless Chromium (Playwright 1.64.1 from a scratch folder,
  `PF_PLAYWRIGHT=<dir with node_modules/@playwright/test>`, default `../pf-add-words-scratch`), real preload via a require
  shim, real slang IPC/service/settings/meeting store on a temp folder; only the speech engine is faked. No Electron window.
  `tools/mutants.js <dir>` = broken-build proof (every family must fail on its mutants).

| Limit | What it means |
|---|---|
| Playwright is not a repo dependency | L4 of `.tests/addwords` is skipped (reported UNVERIFIED) without PF_PLAYWRIGHT / the scratch folder |
| Chromium fires `change` on Enter in a text box | an Enter-only bug in the bias box is invisible to tests (equivalent mutant, see tools/mutants.js) |
| `.tests/capslock` L3 "Ctrl+Space ... side by side" | failed once in a full parallel run, passes alone (timing under load), with and without this change |
- **2026-10-25** One Parakeet Flow at a time, NEWEST WINS (`src/main/single-instance.js`, tests `.tests/single-instance/`, 18 tests): a second start sends `{kind:'parakeet-flow:handover'}` with its lock request; the running copy quits, the new start waits up to 10 s for the lock, then `releaseSingleInstanceLock` + `relaunch` + `exit(0)` so a clean process boots. An older build (sends no data, e.g. 0.2.3) still only makes the running copy show its window. If the running copy never leaves, the new start exits and the old copy stays. Proof: each of 5 deliberately broken variants fails 1-3 tests (`../pf-newest-wins-proof/broken-build-proof.txt`). Not verified: the real Electron lock between two real processes (needs a visible app start; the fake lock models Electron's documented behaviour).

- **2026-11-03** Dependency check of 0.2.6 (branch claude/verify-deps): node-llama-cpp's DLLs import msvcp140/vcruntime140/vcruntime140_1, which 0.2.6 did not ship (a PC without the VC++ redistributable could not load the local AI model). 0.2.61 ships them next to the exe (build-installer copies them from System32 into build-extra/vcruntime; `.tests/squirrel/l4-imports.test.js` reads every native file of the built package). sherpa-onnx and Electron import only Windows DLLs. `npm test` points at `.claude/skills/plan/ladder.js`, which is not in the repo: run `node --test --test-concurrency=1 ".tests/<dir>/*.test.js"` (parallel files share %TEMP%\pf-cs-bin and race on the helper compile). boot L4 needs `playwright-core` (not declared; use NODE_PATH to a folder that has it). Real-engine/ASR L4 tests are skipped without the Kokoro files in ~/.claude/claude-voice. Squirrel install/uninstall cannot be redirected with LOCALAPPDATA/APPDATA (the known-folder API ignores them), so it needs a PC without an install.

## Added 2026-11-03: customization sync (0.2.61, branch claude/verify-deps)

Code in `src/sync/`: `allowlist.js` (what may go; the only upload builder), `merge.js` (per-key last write wins), `client.js` (Supabase REST, key refusal, codes), `service.js` (cycle, retry, backup), `ipc.js`. UI `src/renderer/sync-ui.js`. SQL `supabase/migrations`, setup `docs/sync-setup.md`. Design copied from parakeet-check, re-implemented in JS, main process only.

| Limit | What it means |
|---|---|
| Off is enforced in one place | every network path goes through `SyncService._client()`, which returns null while `settings.sync.enabled` is false; `.tests/sync/l3` patches net, tls, http, https, dns and fetch and expects zero calls |
| A new setting is local by default | `.tests/sync/l2` fails until the setting is on `SETTING_PATHS` or `LOCAL_ONLY` |
| No database address or key in the repo | `.tests/sync/l4-ui` greps tracked files. Keep the real project ref out of docs, tests and this file. Live test: `PF_SYNC_TEST_URL`, `PF_SYNC_TEST_KEY`, `PF_SYNC_TEST_IDS` |
| First-scan timestamps | a value equal to the default gets t=0 (loses to any customization, never a conflict); another value gets the mtime settings.json had before the switch, so a fresh PC does not overwrite an old one |
| Clocks decide | per-key last write wins uses PC clocks; a time more than 5 minutes ahead is pulled back to now |
| A row needs both PCs to poll | after a code, the creator polls every 20 s until someone joined (at most 10 min); the joiner polls for 2 min; otherwise every 5 min |
| Refresh tokens are single use | one client instance per service and one refresh at a time; only `refresh_token_not_found` / `user_not_found` make a new identity |
| Not synced on purpose | snippets (may hold personal text), never-type-into list, whisper settings (depend on the mic), user pack contents (only My terms and pack on/off) |
| `npm audit` left over | mcp: zod 3 (fix is a major; stdio server fed only by the local MCP client). llm-runtime: simple-git via node-llama-cpp, latest 3.22.2 still wants ^3.36 (only used to fetch llama.cpp sources; the app calls getLlama with build:'never', skipDownload:true). Electron: see 2026-11-04 Electron 45 below. `npm audit --omit=dev` at the root never lists Electron (it is a devDependency there): run the full `npm audit` |
| NeMo models | hash-pinned only for the runtime archive; `nemo-speech pull` fetches the models and the app does not check them |

## Added 2026-11-03: auto-update (0.2.61)

`src/main/updater.js`: Electron autoUpdater, feed `https://github.com/otissy/parakeet-flow/releases/latest/download`. Inert unless `isInstalled` (packaged, in app-<version>, Update.exe above): autoUpdater is not even loaded. Tests: `.tests/updater` (L2 fake autoUpdater and clock; L4 the real Squirrel.exe renamed Update.exe in a temp folder against a GitHub-shaped server on 127.0.0.1, redirect included).

| Limit | What it means |
|---|---|
| Only a real release proves | real update 0.2.61 -> next on an installed copy: GitHub's redirect for RELEASES and the nupkg, Electron's autoUpdater events from a real Update.exe, applying into app-<new>, shortcut and pinned icon afterwards, Restart to update, the tray item, Norton's reaction to the update, and that the old folder is cleaned up later |
| 0.2.6 cannot update itself | it has no updater: move to 0.2.61 by Setup |
| Release asset names | build-installer's `checkReleaseFolder` fails the build if RELEASES and the nupkg disagree; GitHub renames spaces to dots, so the Setup exe's asset gets dots (harmless, the feed never fetches it) |
| A version must be newer as NuGet sees it | 0.2.62 after 0.2.61; a draft or pre-release is not `latest` |
| Check request | Squirrel adds `?id=&localVersion=&arch=` (seen in the L4 test); README and Settings say so |

## Added 2026-11-04: UX review fixes (0.2.62, branch claude/verify-deps)

17 findings from `../pf-ux-review/report.md`. Tests: `.tests/ux` (real renderer files, headless Chromium, mocked main process, real key presses), additions in `.tests/sync/l3` and `.tests/app/l3`. Before/after: `../pf-compare/index.html`.

| Limit | What it means |
|---|---|
| A test copy of the app hooks the real keyboard | every test that starts it seeds F15, no CapsLock toggle, Ctrl+F15 for notes (`.tests/features-e2e/safe-keys.js`). A new test that starts the app must do the same |
| Installs table name and machine | exist in the schema and list_group returns them. `machine` stays null; `name` is sent only when the user typed one (Settings > Sync > This PC's name, kept in sync-state.json). README and the switch text say so |
| The sync switch text is tied to the allowlist | `.tests/ux/l4-privacy` fails on a new `SETTING_PATHS` entry until the text covers it |
| Confirmations are native window.confirm | the same as deleting a meeting; tests answer them through Playwright's dialog event |
| Faint text | #7a7a86 is about 4:1 on cards: better, but under the 4.5:1 of WCAG AA for small text |
| Clean-PATH proof | `.tests/squirrel/l4-imports.test.js` reads the imports of every native file of the built package; the built exe then runs with PATH=System32 only, loads the native addons and boots |

## Added 2026-11-04: own icon set (0.2.62)

`src/renderer/icons.js` holds every in-app icon: `PFIcons.svg(name, { label, cls })`, and `<i data-icon="name">` in a page is swapped when the file loads. 24 grid, filled, one path per icon, evenodd for cut-outs, currentColor, aria-hidden unless a label is passed. The select arrow is a data URI from the same file (`--ic-chevron`, colour fixed to --muted because a CSS background cannot use currentColor). Not icons and left alone: arrow-key names in `<kbd>` (text), status dots, the boot spinner, the app and tray icons. Test: `.tests/ux/l4-icons.test.js`.

## Added 2026-11-04: Electron 45 (0.2.63, branch claude/electron-update)

Electron 31.7.7 -> 45.2.2 (Chromium 156, Node 24.22), electron-builder 26.18.0, electron-winstaller stays 5.4.0. Support policy: the latest three stable majors (45, 44, 43 on this date); 45 end of life about 2027-04-27. Installer about 213 MB, app folder 319 MB (was 252 MB).

| Limit | What it means |
|---|---|
| Desktop capture is its own permission since 45 | `display-capture`, no longer `media`. With media only, meeting capture failed with "Permission denied" on the real page. `src/main/permissions.js`, `.tests/app/l2-permissions.test.js` |
| Synchronous safeStorage is deprecated in 45, REMOVED in 46 (tentatively 2027-01-05) | `src/main/secret.js` still uses it and logs deprecation lines on stderr. Move to the async calls before Electron 46. `decryptStringAsync` returns an object with `result`. Every caller of `secrets.get` then becomes async |
| `console-message` positional arguments are deprecated | three test hooks (.tests/app/e2e-hook.js, features-e2e/hook.js, slang/hook.js) still use them; they will stop reporting console errors when Electron removes them |
| `electron_wer.dll` | must carry the exe's name; electron-builder leaves it, `scripts/after-pack.js` renames it. The app does not start crashReporter |
| `npm audit --omit=dev` at the root | shows 0 before and after because Electron is a devDependency. Use the full `npm audit`: high 3 -> 0, moderate 16 -> 15 (build tooling). llm-runtime and mcp are unchanged (see the audit row above) |
| Real Squirrel update without touching the install | Update.exe works on its own folder, so a scratch root is possible (root folder not named parakeet-flow), but two things reach outside it: the app's --squirrel-updated hook calls ..\\Update.exe --createShortcut (real Start menu), and Update writes HKCU Uninstall\\<folder name>. Proof run: when the nupkg was requested, the running Update.exe was renamed and whoami.exe put in its place; afterwards the stray key was deleted. Not run: the Start-menu shortcut step, and quitAndInstall (it restarts through Update.exe; an env that did not survive would start a copy on the real userData) |

Measured with the packaged 0.2.62-icons and 0.2.63, scratch userData, 3 runs each, medians: engine ready 3953 ms -> 3749 ms; working set 20 s after ready 1252 MB -> 1406 MB; private bytes 980 MB -> 1040 MB. One old run reported a working set of 6 MB (trimmed by Windows) and was left out. The first run on a new folder takes longer.

Proved on the 0.2.63 build with PATH=System32: engine ready, shipped helper, dummy Notion and Sync tokens written by 0.2.62 readable, new writes readable, dictation capture and meeting capture through the real pages with `--use-fake-device-for-media-stream` (no real microphone), node-llama-cpp in its worker generating text, mcp/server.js through the exe with ELECTRON_RUN_AS_NODE. Squirrel: 0.2.62's own autoUpdater, local feed shaped like GitHub, to app-0.2.63, then that copy's autoUpdater reports no update. Same screens old and new. Not run: real microphone, real hotkeys, the real lock between two copies, a real GitHub release.

The real-speech tests skip without `.tests/fixtures/*.wav` (ignored by git). gen-audio.py needs a claude-voice venv that is not on this PC; for this work the same sentences were made with kokoro-say.exe (voice af_heart) and the fixtures were removed afterwards.
