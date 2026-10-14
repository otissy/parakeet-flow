# Changelog

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
