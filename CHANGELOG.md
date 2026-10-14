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
