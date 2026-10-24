# Antivirus notes: pf-helper.exe, the installer, and Norton "IDP.Generic"

parakeet-flow is unsigned and its helper watches the keyboard and types text. Both are things heuristic scanners
dislike. IDP.Generic is Norton's reputation/heuristic detection ("this file is rare and behaves like..."). It is
not a statement that the file contains malware. Everything below is what the program really does so you can judge it,
and how to deal with a detection without turning your protection off.

## Which file

`pf-helper.exe`, about 60 KB, built from `src/typer/helper/` (`PfHelper.cs`, `AssemblyInfo.cs`,
`pf-helper.manifest`, icon `assets/icon.ico`) with the C# compiler that ships with Windows
(`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`). Version 0.2.0 and later are compiled once when the
installer is built and shipped inside the install folder
(`%LOCALAPPDATA%\parakeet-flow\app-<version>\resources\app\src\typer\helper\bin\pf-helper.exe`), so nothing is compiled on your PC at first run.
A source checkout (`npm start`) still compiles it into `%APPDATA%\parakeet-flow\bin`.

It carries a version resource (Company otissy, Product "parakeet-flow input helper", Description, Version, Copyright), an
embedded manifest (`asInvoker`, UI access not requested, supported-OS entries) and the app icon. That makes it
identifiable; it does not guarantee a scanner will like it.

SHA-256 of the 0.2.2 helper shipped in `Parakeet Flow Setup 0.2.2.exe`: `3606ef1734592dec450167e0d0f97cdc8ff492dc3768678f3da9688aebbe5c74`
SHA-256 of that installer: `096f961cb01477ff8eee9540132b7c49f3004687e974bbb906665c0ecd27b9ab`
SHA-256 of the 0.2.3 helper shipped in `Parakeet Flow Setup 0.2.3.exe`: `80dfe320e928d6964202494582ee334b44f982ca0db3c3193a11ab96be67d531`
SHA-256 of that installer: `e34e6667faf645227cbf2f29c97882a7cebba8d277d3dd4863d11e896a71f5aa`
(The compiler does not produce identical bytes twice, so every rebuild has its own hash; the hash of the shipped file is
recorded here and in the README for each release.)

## Why it needs a keyboard hook and SendInput

- **Hotkey (hold Ctrl+Space, CapsLock toggle).** Windows has no "key released" notification for global shortcuts, and
  Ctrl+Space or CapsLock must be swallowed so Windows does not toggle the IME or caps state. That needs a low-level
  keyboard hook (`SetWindowsHookEx`, `WH_KEYBOARD_LL`) plus `GetAsyncKeyState`.
- **Typing.** Dictated words are typed into the focused app with `SendInput` (Unicode keystrokes), and corrected
  with Backspace. That is the same call every dictation tool, on-screen keyboard and macro tool uses.

## What it does not do

- No network access of any kind (no `System.Net`, no sockets; the file imports only `user32`/`kernel32` calls).
- No logging, storing or sending of keys. The hook only tests whether the pressed key is part of the configured chord
  (or CapsLock when the toggle is on); every other key is passed on untouched and forgotten. It writes no files.
- No registry writes, no startup entry, no scheduled task, no persistence, no injection into other processes, no admin rights.
- It talks only to its parent app over stdin/stdout. It reads the foreground window's title and process name so it
  can refuse to type into a window that is not the one you started in.

## Verify it yourself

1. The source is in the install folder and in the repository: `src/typer/helper/PfHelper.cs`.
2. `resources\app\src\typer\helper\bin\pf-helper.exe.src-sha256` holds the SHA-256 over `PfHelper.cs` + `AssemblyInfo.cs`
   + `pf-helper.manifest` (in that order, concatenated). The app uses the shipped helper only when that value equals
   the hash of the source files next to it, and otherwise compiles the source itself. Recompute:

        node -e "const c=require('crypto'),fs=require('fs');const d='<...>/src/typer/helper/';console.log(c.createHash('sha256').update(Buffer.concat(['PfHelper.cs','AssemblyInfo.cs','pf-helper.manifest'].map(f=>fs.readFileSync(d+f)))).digest('hex'))"

3. `Get-FileHash <path>\pf-helper.exe` against the SHA-256 above. Right-click > Properties > Details shows the version info.
4. You can build your own: `npm run installer` (needs the repo) or delete the helper and run from source.

## If Norton blocks or quarantines it

Menus differ a little between Norton versions; the idea is the same.

1. Open Norton > **My Norton** > **Security** > **History** > filter **Quarantine** (or Security History). Find
   `pf-helper.exe`, open it and choose **Restore & Exclude** (Restore if only that is offered).
2. Exclude only that one file: Norton > **Settings** > **Antivirus** > **Scans and Risks** > **Exclusions / Low Risks** >
   **Items to Exclude from Scans** (and **Items to Exclude from Auto-Protect, SONAR and Download Intelligence Detection**) >
   **Add Files**, and pick the single `pf-helper.exe` path. Do not exclude `%LOCALAPPDATA%\parakeet-flow`, `%APPDATA%\parakeet-flow` or a
   whole drive, and do not turn protection off.
3. If the file is gone, start Parakeet Flow again: it compiles the helper from the shipped source into
   `%APPDATA%\parakeet-flow\bin` (that is the path to exclude in that case) when the shipped one is missing or not matching.
4. Dictation does not work while the helper is missing; the app keeps running and shows no typing.

## Report a false positive (your action, takes a few minutes)

Open Norton's file submission page (https://submit.norton.com/), choose "I believe a file is wrongly detected / a
false positive", upload `pf-helper.exe` (and the installer if that was flagged), and give the detection name
(IDP.Generic) and what the program is. Symantec/Norton then reviews it; reputation also builds as more users run the same file.

## Unsigned installer and SmartScreen

The installer and helper are not code-signed (no certificate was bought or created). Expect "Windows protected
your PC" (More info > Run anyway) and possible reputation warnings. Metadata and a manifest reduce how suspicious the
file looks; they cannot promise that Norton will not flag it. The durable fix is a trusted code-signing certificate, which
also builds SmartScreen reputation over time.
