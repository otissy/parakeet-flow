# Changelog

## 0.2.65

- Fixed: the app didn't start with Windows after an update. "Start with Windows" used to store the path of the version folder (for example app-0.2.61), which an update deletes. It now registers the installer's stable launcher (Update.exe), and every start rewrites the entry from your setting: on repairs it, off removes the app's own entry. Other programs' entries are never touched.

## 0.2.64

Sync is easier to set up (still off by default, and it only ever syncs customization):

- One **Sync code**: on the first PC, Settings > Sync > Create Sync code gives a single string with the project URL, the publishable key and a link code. Paste it into the box at the top of Settings > Sync on the second PC and press Link this PC: it saves the project, switches sync on and links, in one step. The code works once and expires after 10 minutes; a used, expired, damaged or edited code gets a clear message, and a code with a secret or service-role key is refused. The short link codes remain under Advanced.
- The Sync section reads as steps: 1 Project, 2 switch on, 3 link another PC. A disabled control says why beside it, answers appear under the button you pressed, and the badge reads Off, Syncing, Up to date, Failed or Offline.
- Each PC has a name in the linked list. It starts as the Windows computer name (this is new: before, no computer name was sent); change it, or empty it to send no name.
- Linking with a Sync code asks first and says that a backup is saved and what will be replaced; Unlink, Restore backup and changing the project still ask.
- The text in the app and the README now agree on what is synced, including the install ID, the app version and the name.
- No database change: the same two migration files as before.

## 0.2.63

- Security update: Electron 31.7.7 to 45.2.2 (Chromium 156, Node 24). This clears the known Electron security advisories. Your settings, models, notes and saved tokens carry over.
- Meeting capture keeps working: Electron 45 asks separately for desktop capture, and the app now allows it next to the microphone.
- The installer is larger because Chromium grew.

## 0.2.62

Fixes from a UX review of 0.2.61:

- Icons: every icon inside the app is new, drawn for this app as filled shapes in one colour on a 24 grid (sidebar, small buttons, flow bar, list arrows, translate arrows), all in `src/renderer/icons.js`. No icon library, no download. App icon and tray icon unchanged. The dimmed "add to dictionary" button went from 55% to 70% opacity so its icon reaches 3:1 contrast. The tick and cross in the flow bar now actually show: the old ones were CSS mask images that the bar's content security policy blocked.
- First run: Home has a Download card with progress, and holding the key without a model tells you where to go.
- Keyboard: every sidebar page and every switch can be reached with Tab, and switches have a name for screen readers.
- Sync: the Project row comes first and the switch says why it is disabled. Answers appear under the button you pressed. A refused key leaves the box. Server errors read as sentences. A badge in the header says Off, On, Syncing, Offline or Failed. Sync and Updates moved under Privacy.
- Linked installs can show a name you type per PC, optional and empty by default. The Windows computer name is never sent.
- Unlink, Restore backup, Clear history and saving a different project URL ask first and say what is lost.
- What the app says about the network is corrected: Home no longer says nothing is sent, Settings > Privacy lists what can leave the PC, and the sync switch names everything it sends and who can read it.
- GPU can no longer be chosen (this build runs on the CPU). The dead Language box is gone. Aggressive/Stable moved under "Type while I speak". The CapsLock text names the tray item as it is called.
- Updates says when automatic checks are off. Faint text has more contrast.

## 0.2.61 (not released on its own, included in 0.2.62)

- The installer now carries the Visual C++ runtime (msvcp140, vcruntime140, vcruntime140_1) next to the app: the optional local AI model no longer needs the redistributable on the PC.
- README install section names the current version.
- Optional customization sync between your own PCs (Settings > Sync, off by default): each install has its own ID, installs link with a single-use code, and only an allowlist of customization goes to a Supabase project you own. The installer holds no database address or key. Dictated text, notes, meetings, tokens and logs never leave the PC, and while sync is off the app makes no network call for it. See docs/sync-setup.md.
- Auto-update: the installed app checks the latest GitHub release shortly after start and every 4 hours, downloads in the background and installs on the next quit, or Restart to update in the tray and Settings. Never during a dictation. Setting "Check for updates automatically", default on, with Check now and the current version. It sends a normal web request holding the app name, version and PC type.
- MCP server dependencies updated for audit findings (body-parser, fast-uri, qs). The docs now show how to run the server with the installed exe, so Node is not needed on the PC.
- README corrected: the NeMo runtime archive is SHA-256 checked, the meeting models are not.
- `npm test` works from a clean clone and runs the suites one at a time.

## 0.2.6 - 2026-11-03

- 0.2.6 — rebuild of 0.2.5 (same features); build output folder configurable (PF_BUILDS environment variable, default D:/builds/parakeet-flow).

## 0.2.5 - 2026-10-25

- The main window is never blank any more: it shows a loading card at once, draws the page as soon as the settings arrive, fills in the slower parts as they land, explains a slow start, and shows an error card with Try again when something fails (before, one slow or failed startup call left it empty).
- The keyboard helper is restarted if it ever exits by itself, and the hotkey, note chord, toggle key and claim are given back to it, so a crashed helper no longer leaves dictation without its keybind.
- The installer now includes the MCP server's and the AI runtime's dependencies (0.2.4 shipped without mcp/node_modules and llm-runtime/node_modules).

## 0.2.4 - 2026-10-25

- Meetings: a Meetings page records the microphone and the main display's audio locally and produces a speaker-labelled transcript, an editable summary and action items (nothing is sent anywhere).
- One Parakeet Flow at a time, newest wins: starting it again makes the running copy quit and the new start takes over (copies older than 0.2.4 only show their window).
- Dictionary: "Add a word" box (word, heard as, pack, optional own bias), duplicates in any case are merged, Undo.
- "Add to dictionary" from the transcript history on Home and from meeting transcripts (select a word, or the line's button).
- Hotword bias is shown and set as a percentage (1-100%, default 50%); a word can have its own bias. Old settings load unchanged.

## 0.2.3 - 2026-10-24

Rebuilt the Windows installer with the correct 0.2.3 package version so installing it upgrades the existing 0.2.2 app
instead of presenting the same version again. The bundled helper's Windows file version is aligned to 0.2.3.

- The installer includes the current source, including the Dictionary slang packs and optional contextual biasing.
- Squirrel release assets are published together so the pinned Parakeet Flow shortcut continues to use its existing install.

## 0.2.2 - 2026-10-14

Installer rebuilt on 29a321a so it contains the slang packs (src/slang and the English and Dutch starter packs), which 0.2.1 lacked.

- MIT LICENSE (otiyyy, 2026) and a NOTICE listing third-party software and models with versions; both ship in the installer. Model licences (Parakeet CC-BY-4.0, Silero MIT, Qwen3 Apache-2.0) are marked "not verified locally": no model card is on the build PC.
- A packaging test checks that the BUILT package holds every src/slang file, both starter packs, the MCP server, the licence files and the shipped helper.
- Silent install and uninstall were not run for this build (a live 0.2.1 install exists; it is updated with Update.exe --update).

## 0.2.1 - 2026-10-14

Installer rebuilt on the insert-once typing, note mode and MCP notes server (5f4a024, cc911c6).

- The installer now carries mcp/ (server plus its production dependencies, installed with `npm --prefix mcp ci --ignore-scripts`) and the sync-parakeet-notes skill.
- pf-helper.exe is rebuilt fresh on every installer build; scripts/build-installer.js deletes src/typer/helper/bin before and after, so a stale shipped helper can never be picked up by a later dev run or test.
- Not re-proven this round: a clean silent install and uninstall (a copy of 0.2.0 is installed on the PC and was left alone); the 0.2.0 proof still stands for the mechanism.

## Unreleased

- Slang packs on the Dictionary page: two built-in starter packs (English 507 terms, Dutch 64), your own packs, My terms (add, edit,
  delete in one step), import of pasted text or .txt/.csv/.json, export, per-pack switches, a Try it box. Applied to finished
  sentences only, whole words, longest match first, never inside links, paths or code.
- The local cleanup prompt names the pack terms that occur in the sentence; a model answer that drops or re-cases one is rejected.
- Optional contextual biasing (sherpa-onnx hotwords, beam search), off by default.
- docs/slang-packs.md.
## 0.2.0 - 2026-10-13

Packaging release. The app is now a normal Windows install.

- Squirrel.Windows installer (per user, `%LOCALAPPDATA%\parakeet-flow`), Start-menu shortcut, uninstall entry,
  own icon (`assets/icon.ico`, a waveform glyph drawn by `scripts/make-icon.js`).
- No startup entry of any kind: no Run key, no scheduled task, no Startup-folder item. Launch at login stays an
  opt-in setting that is off by default.
- Uninstall removes only the install folder, the shortcut and the uninstall entry. `%APPDATA%\parakeet-flow`
  (models, settings, notes, logs) is never touched.
- The app answers Squirrel's `--squirrel-*` start-up flags (creates the Start-menu shortcut itself, exits at
  once on install, update and uninstall) and always keeps its data in `%APPDATA%\parakeet-flow`.
- `npm start` now goes through `scripts/start.js`, which removes `ELECTRON_RUN_AS_NODE` (when that variable is
  set Electron runs as plain Node and the app dies silently on its first line).
- `npm run installer` builds into a fresh `D:\builds\parakeet-flow\<version>` folder; `scripts/prove-install.js`
  is the install / run / uninstall proof.
- The input helper (pf-helper.exe) now has version info (company, product, description, copyright), an asInvoker manifest and the app icon, and is compiled once when the installer is built and shipped inside it instead of being compiled on the user's PC at first run (the source-hash check stays). docs/antivirus.md explains what it does and how to restore/exclude/report it if Norton flags it.
- Unsigned. Nothing is published and there is no update server.

## 0.1.0 - 2026-10-13

Live-typing dictation, voice commands, per-app tone, translate, whisper mode, local-model cleanup, notes, and the
Ctrl+Space hotkey. See the git log.

## Unreleased - 2026-10-14

- **Wispr-style flow is the default.** Nothing is typed while you hold the key; the bar shows the live words and the finished, punctuated text is inserted once on release (one paced burst of Unicode keys, or an optional clipboard paste that restores your clipboard). Reason: live Backspace corrections corrupted text in Claude Code's prompt and other raw-mode terminals. The old mode is Settings > How text gets in > "Type while I speak (experimental)".
- Per-app insert method table; terminals use Ctrl+J for "new line" (Shift+Enter would send the line); optional "Press Enter after I finish".
- More terminals recognised for the code tone (console windows report the program inside them: node, cmd, powershell, claude ...). The code tone keeps punctuation.
- **Note mode:** hold Ctrl+Shift+Space (changeable) to save a dictation as a note; dictating with the Desktop, no window or this app in front saves a note too ("Saved as note").
- **MCP server** (`mcp/`, stdio, official SDK pinned): lets Claude Code read, file (Notion, Drive ...) and add your notes with its own connectors; no token in this app. `.claude/skills/sync-parakeet-notes` tells Claude how.
- Markdown export of notes (Obsidian etc.).
- The notes file is now safe for two writers (lock + re-read).
