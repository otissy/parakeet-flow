# parakeet-flow

Hold a key and talk: the live words show in a small bar, and when you let go the finished, punctuated text is
inserted into the focused app once (like Wispr Flow; typing while you speak is an opt-in experiment). Everything runs on this PC (Parakeet TDT 0.6B v3, int8,
via sherpa-onnx). A small floating bar shows the level and the live text; a tray icon and a main window hold
the settings. The design follows the layout and feel of Wispr Flow without using its name or logo.

## Install (Windows installer, 0.2.4)

Run `Parakeet Flow Setup 0.2.4.exe`. It installs for your user only (no admin prompt) into
`%LOCALAPPDATA%\parakeet-flow`, adds a Start-menu shortcut (Start > otissy > Parakeet Flow) and an entry in
Settings > Apps. It does NOT start with Windows: no startup entry, no scheduled task, no Run key. "Launch at login"
exists in Settings and is off until you switch it on.

First run:

1. Open Parakeet Flow from the Start menu. A tray icon appears (hidden icons arrow, bottom right), the main
   window opens, and a small bar sits at the bottom centre of the primary screen. Closing the window keeps it in the
   tray; Quit is in the tray menu.
2. Settings > Speech engine > Download. About 670 MB from the official model hosts, SHA-256 checked. Until the model
   is there the engine shows "missing" and nothing is typed. The installer itself is 165 MB and holds no models.
   Models live in `%APPDATA%\parakeet-flow\models`; an existing folder there is picked up as it is.
3. Windows must allow microphone access for desktop apps (Settings > Privacy > Microphone). Pick the input
   device in Settings if the default is not the one you speak into.
4. Hold **Ctrl+Space** and talk; the words appear in the focused app. **CapsLock** toggles hands-free. Both are
   described below and can be changed in Settings.
5. Optional local AI cleanup/translate: Settings > AI cleanup > Download (a further 639 MB). The runtime is already
   in the installer.

## Local meetings

The Meetings page records microphone and primary-display system audio locally. It processes the recording after you
stop, then saves a speaker-labelled transcript, an editable summary, and action items in
`%APPDATA%\parakeet-flow\meetings.json`. Audio is held in a temporary WAV file only while recording/processing and is
deleted after processing; incomplete staging files are cleaned up at the next launch. Meeting content is not sent to
Notion or a remote transcription service.

On first use, Meetings downloads NVIDIA's NeMo-Speech.cpp 0.2.0 Windows runtime and the Parakeet TDT v3 and
Nemotron-3-Diarization models (about 930 MB total with an NVIDIA GPU; model/runtime files are SHA-256 checked).
The RTX/CUDA runtime is selected when `nvidia-smi` detects an NVIDIA GPU; otherwise the CPU runtime is used.
The existing optional local Qwen model is used for summaries and action items; if it is not installed, download it
from Settings > AI cleanup and use the meeting's summary retry action.

Meetings do not use Sherpa or Python. The Windows native runtime supports regular Parakeet TDT transcription plus
Nemotron speaker diarization for up to eight speakers. It is not the overlap-specialized Multitalker Parakeet model,
so simultaneous speech may not be transcribed as accurately as separate speaker streams. Recording is live; transcript,
speaker attribution, and summary are generated after you stop the meeting.

Licence: the app is MIT (`LICENSE`). Third-party software and the models are listed in `NOTICE`. The models are separate downloads
under their own licences (Parakeet TDT v3 CC-BY-4.0 with attribution, Silero VAD MIT, Qwen3-0.6B Apache-2.0), not part of this MIT licence
and not in the installer.

The installer is not signed. Windows SmartScreen may say "Windows protected your PC": More info > Run anyway.
Norton may show a reputation warning (for example IDP.Generic) for a new unsigned installer or for the little helper `pf-helper.exe`
(built from `src/typer/helper/PfHelper.cs`, shipped inside the install with version info and a manifest; it types text and watches the hotkey).
What it does, how to verify it, how to restore and exclude only that file, and how to report a false positive: `docs/antivirus.md`.
Helper SHA-256 (0.2.4): ``. The app makes no network calls except the model downloads
(and Notion, only if you turned it on).

Update: run the newer Setup; it replaces the app and keeps your data. There is no update server and no
auto-update.

Uninstall: Settings > Apps > Parakeet Flow > Uninstall (or `%LOCALAPPDATA%\parakeet-flow\Update.exe --uninstall`).
It removes the app, the shortcut and the Settings entry. Squirrel cannot delete the file it runs from, so an empty-ish `%LOCALAPPDATA%\parakeet-flow` (Update.exe, 1.9 MB, plus a `.dead` marker) stays; delete that folder by hand if you want it gone. `%APPDATA%\parakeet-flow` (models, settings,
notes, logs) stays; delete that folder by hand to remove everything.

Troubleshooting:

| Symptom | Check |
|---|---|
| Nothing happens when launched | A copy may already be running in the tray (second start only shows its window). From a terminal, `npm start` now clears `ELECTRON_RUN_AS_NODE`; with that variable set Electron behaved as plain Node and died silently. |
| Hold the key, nothing is typed | Tray: "Dictation enabled" must be ticked. Settings must show the engine as ready (model downloaded). The target window must be the same one that had focus when you pressed the key, and not in the never-type list. |
| Ctrl+Space also toggles the Windows IME or VS Code completion | The helper swallows the chord only while dictation can use it; if another keyboard tool grabs Ctrl+Space first, pick a different hotkey in Settings. |
| Level bar flat | Wrong input device or Windows microphone privacy switch off. |
| Model "failed its SHA-256 check" | Delete the file named and download again; a damaged file is never used. |
| Logs | `%APPDATA%\parakeet-flow\logs\app.log` (counts and timings only, never what you said). |

Building the installer yourself (needs Node, the repo's `node_modules`, `llm-runtime` installed):

    npm install --ignore-scripts
    npm --prefix llm-runtime install --omit=optional --ignore-scripts
    npm run installer             # builds into D:/builds/parakeet-flow/<version> (fresh folder, never reused)
    node scripts/prove-install.js "<Setup.exe>" --out=<folder> --hook=scripts/proof-hook.js   # install, run, uninstall, compare

## Run (from source)

    npm install            # electron@31.7.7, sherpa-onnx-node@1.13.8 (exact pins)
    npm start              # first run: Settings > Speech engine > Download (about 670 MB, SHA-256 checked)

If `npm install` leaves `node_modules/electron/dist` nearly empty (it did here), unzip the cached
`electron-v31.7.7-win32-x64.zip` into it and write `electron.exe` to `node_modules/electron/path.txt`.

Two gestures. **Ctrl+Space (either Ctrl) = hold to talk**: press and hold starts, release stops (there is no double-tap).
**CapsLock = toggle**: one press starts dictation hands-free (the pill shows stop and cancel buttons), the next press
(or the stop button) stops it. Esc cancels either one and removes the live segment's text. Both keys have a picker
with a Reset button in Settings, and the switch "Use CapsLock as the dictation toggle" (default on) turns the toggle off.
While the toggle is active the helper swallows CapsLock (down, repeat and up) so Windows never flips the caps state or
its light; a CapsLock that was already on at start is left as it is. CapsLock is normal again instantly when the switch
is turned off, dictation is paused in the tray, a hotkey picker is open, or the app exits or crashes (the hook lives in
the helper process, which ends with the app). If you hold Ctrl+Space during a toggle session, hold wins: the session keeps
running, a CapsLock press while the hold is down is ignored, and releasing the hold does not stop it. Only CapsLock
is swallowed; another toggle key you pick is typed as usual. Upgrading: the old double-tap setting is dropped, and an old
saved "toggle" mode makes CapsLock the toggle once (hold goes back to Ctrl+Space).
Launch-at-login is off and is only registered when you
switch it on. Upgrading: a saved lone Pause from before this default is moved to Ctrl+Space once; a key you pick
afterwards is kept.

How the chord behaves (all in `src/typer/helper/PfHelper.cs`):

- It is a real chord: it starts only when Space goes down while Ctrl is already down. A lone Ctrl, a lone Space,
  or Space then Ctrl never starts dictation.
- While dictation can use it, the helper swallows the chord's Space (down, auto-repeat and up) with a low-level
  keyboard hook, so the focused app never sees Ctrl+Space (Windows IME toggle, VS Code completion). Ctrl alone and
  Space alone always pass through. The chord is not swallowed when dictation is paused in the tray, while the
  Settings hotkey picker is listening, or for a lone-key hotkey such as Pause.
- Corrections while Ctrl is held: Ctrl + Backspace deletes a word, so around every typing burst the helper sends a
  logical Ctrl-up, the keystrokes, and a Ctrl-down again only if you still hold Ctrl, all in one SendInput call. If
  you let go mid-burst the real key-up is swallowed (the app already saw one) and no down is sent; if the down had
  already gone out a matching up follows. Apps never see a stuck or unmatched Ctrl. Rejected alternatives:
  Shift+Left select-and-overtype (Ctrl+Shift+Left selects a word, same problem, and a typed letter with Ctrl down is a
  shortcut) and deferring corrections until Ctrl is released (no live correction at all in hold mode).

## How the words get into the app (Wispr style, since 2026-10-14)

Hold the key and talk: the bar under the screen shows what you are saying as it is recognised. **Nothing is typed into the
app while you hold the key.** When you let go (or press CapsLock again), the finished text, already punctuated and
capitalised by the model, with fillers removed, is inserted **once**. This is the same idea as Wispr Flow.

Why it changed: typing partial words and fixing them with Backspace breaks in raw-mode terminal prompts such as Claude Code's.
Dictating "hello world, it is a nice day. second sentence here" left `hello wor ld i, it  is a nice day  second  sentence here`
in the prompt, and a 480-word stress dictation had a defect every 8 to 12 words (a space inside a word, double spaces, stray
letters). The old behaviour is still there as **Settings > How text gets in > Type while I speak (experimental)**, off by
default, and it can misbehave in terminals.

- **Insert method**, chosen per app (Settings table, your rows first, then "terminals" and "everywhere else"): `Type it` = one
  paced burst of Unicode key events (24 characters at a time, 8 ms apart, the foreground window is re-checked before each
  slice, no Backspace at all); `Paste` = save the clipboard, put the text there (kept out of Windows clipboard history and
  cloud sync), send Ctrl+V, put your clipboard back 220 ms later (not if you copied something meanwhile; if the clipboard holds
  something that cannot be restored exactly, nothing is pasted and the text is typed instead); `Paste (Shift+Insert)`.
- **Measured** (this PC, harmless raw-mode echo programs in console windows this project launches off-screen, never your windows):
  see "Insert method measurements" below. Type it works everywhere tested. Paste does not reach a raw-mode program in a classic
  console window at all (it receives the key itself, 0x16), so the default is Type it everywhere.
- **Spacing:** exactly one space between sentences; no space at the start; one space before the next insertion in the same window
  (within 2 minutes), trailing space optional (never in terminals).
- **Terminals** (Windows Terminal, console windows, PowerShell, cmd, VS Code, Claude Code ...): the `code` tone skips the capital
  on the first word but keeps punctuation. The voice command "new line" presses **Ctrl+J** there, because a console delivers
  Shift+Enter as a plain Enter (measured) and that would send your prompt; everywhere else it is Shift+Enter. Enter is never
  pressed for you unless you turn on **Press Enter after I finish** (off).
- Voice commands still work: they edit the waiting text before it is inserted ("delete that", "new line", "capitalize that"),
  or the previous insertion if nothing is waiting.
- If you switch windows while holding the key, nothing is inserted and the words are saved as a note ("Window changed: saved as note").

### Insert method measurements (2026-10-14)

Harness: `.tests/terminals/real-terminals.js` launches harmless raw-mode key-echo programs (`echo-raw.js`: stdin in raw mode, logs every byte it
receives, runs nothing) in NEW console windows placed at x=-6000 (never visible), types into them only through pf-helper (which refuses unless that
window is the foreground window, and now re-checks before every 24-character slice), then puts the previously focused window back. The echo program is
what a Node TUI such as Claude Code's prompt reads. Each run replays "hello world, it is a nice day. second sentence here." (6 partials, 2 finals) or
the 480-word stress dictation (word0..word96 x5, 6 segments, partials with corrections) through the real session, or 6 consecutive holds through the real
Controller (each utterance different, duplicate final events injected). A run is **corrupt** when characters arrive that are not a prefix of the
intended text, **refused/short** when the window lost focus mid-run (the helper refuses and nothing is typed anywhere else).

| host (what the window owner reports) | method | short sentence | 480 words | 6 holds | corrupt |
|---|---|---|---|---|---|
| console window, `node.exe` | Type it (burst) | 7 of 8 exact, 1 refused | 0 of 2 complete (focus kept being taken, 54 re-focus attempts) | refused part-way | 0 |
| `cmd.exe` | Type it (burst) | 8 of 8 exact | 2 of 2 exact (3309 characters) | exact | 0 |
| `powershell.exe` | Type it (burst) | 8 of 8 exact | 1 of 2 exact, 1 refused | refused part-way | 0 |
| console window | Paste (Ctrl+V) | 0 of 6: the program receives byte 0x16, no text | 0 | 0 | 0 (nothing arrives) |
| console window | Paste (Shift+Insert) | 0 of 3: the program receives ESC [ 2 ; 2 ~ | not run | not run | 0 |

The clipboard was byte-for-byte what it was before in every paste run (hash before = hash after). Windows Terminal is not installed on this PC and VS Code was not
driven (it can only be started as a visible window), so paste in those two is **unmeasured**; the per-app table lets you switch an app to paste once you
have tried it. Where the shorts come from: something on this PC keeps taking the foreground away from the test windows (up to 54 times in one run); the helper
refuses to type when that happens, which is the safe outcome. For comparison, live typing with Backspace corrections (`PF_LIVE=1`) is also clean in this
ideal echo program; Claude Code's own input handling (Ink) is what drops and merges rapid bursts, and it is not available to test here without running claude
itself, so the real Claude Code prompt has been verified only by the user's own dictation, not by this harness.

## Notes: note mode, routing, Claude (MCP), Markdown export

- **Note mode:** hold **Ctrl+Shift+Space** (change it in Settings), talk, let go: the dictation is saved as a note and nothing is
  typed. A lone tap does nothing. "Note to self ..." keeps working.
- **Automatic fallback:** if the window in front is the Desktop or taskbar, there is no window, or it is this app, there is nowhere
  to type, so the dictation is saved as a note and the bar says "Saved as note". It never does this inside another program's window.
  Switch it off in Settings.
- **Connect to Claude (MCP):** parakeet-flow ships a small local MCP server in `mcp/` so Claude Code can read your notes and file
  them in the Notion / Google Drive it is already connected to. This app never holds a Notion token for that. See `mcp/README.md`.

  ```
  npm --prefix mcp ci --ignore-scripts
  claude mcp add parakeet-flow -- node "C:\path\to\parakeet-flow\mcp\server.js"
  ```

  or in `.mcp.json`:

  ```json
  { "mcpServers": { "parakeet-flow": { "command": "node", "args": ["C:\\path\\to\\parakeet-flow\\mcp\\server.js"] } } }
  ```

  (You run these yourself; the app does not touch Claude's settings. Settings > Connect to Claude shows your exact path with a Copy
  button.) Then ask Claude "sync my parakeet notes": the project skill `.claude/skills/sync-parakeet-notes/SKILL.md` tells it to find
  your Notes database in Notion, create one entry per note (title, text, date, tags), and call `note_mark_synced`. Tools:
  `notes_list`, `note_get`, `note_mark_synced`, `notes_add`, `dictation_status`, and `recent_dictation` only if you switch on
  "Share recent dictation history with MCP clients" (off by default).
- **Markdown export** for apps without MCP (an Obsidian vault, any folder): Settings > Markdown export. One `.md` per note with
  front matter (title, id, created, tags, source), always the same file name for the same note.
- The built-in Notion sync with your own integration token (above) is unchanged and optional.

## How it works

- `src/asr/segmenter.js`: Silero VAD finds speech; the live segment is re-decoded every ~400 ms (adaptive: a
  decode never overlaps the next) for `partial`; a 500 ms pause or the key release finalises it; segments
  are cut at 9 s (earlier at a quiet moment after 6 s). A finalised segment is immutable.
- `src/core/live-typer.js`: keeps what it typed; each hypothesis = longest common prefix, Backspace x the
  rest, then the new tail. Live corrections over 40 backspaces wait. The final may rewrite the segment
  (bounded at 400) so a mangled partial never stays on screen. Types only while the key is held plus 1.5 s;
  stops when the foreground window changes or is on the deny-list; never into its own windows.
  `aggressive` types every partial, `stable` only words that survived two passes.
- `src/typer/helper/PfHelper.cs`: the only native code, compiled from source at first run with the csc that
  ships with Windows. One persistent process: a low-level keyboard hook tracks the hotkey chord (it ignores the keys the helper injects
  itself), GetAsyncKeyState polling every 30 ms reports it plus Esc and the foreground window, and SendInput with KEYEVENTF_UNICODE. It refuses to type if the foreground window is not the
  one the session started in.
- Finals only: filler removal, dictionary, snippets, casual style (`src/core/postprocess.js`).
- Logs hold counts and timings, never dictated text. Audio is never written to disk. History is off by default.

## Voice commands, tone, notes, local model (added 2026-10-13)

All of it is local and optional. Defaults: voice commands, per-app tone and "note to self" on; translate, whisper and AI cleanup off.

- **Voice commands** (`src/core/commands.js`): a segment that says only a command phrase is never typed. English and Dutch:
  delete that / scratch that / verwijder dat, new line / nieuwe regel, new paragraph / nieuwe alinea, undo that / maak dat ongedaan,
  capitalize that (each word), all caps that, make that formal / casual (maak dat formeel / informeel). Matched on finals, whole segment
  only; say the command after a short pause. The phrase list is editable in Settings. They edit only the last typed segment, only while the
  same window has focus, bounded by 400 backspaces, also from the next hold (up to 2 minutes later). A partial that might become a command
  ("note to the first" can be a misheard "note to self") is held back instead of typed; the cost is that a sentence starting with "note to"
  or "new line ..." appears when final instead of live. "New line" types Shift+Enter (never a bare Enter, so no chat message or terminal
  command is sent; a terminal may still treat Shift+Enter as Enter). Dutch commands are tested on text only: the only Dutch voice here is an
  English voice, which Parakeet hears as "Vervader", so Dutch commands are not verified on real audio.
- **Per-app tone** (`src/core/tone.js`): the foreground process or window title (from the existing Win32 helper) picks casual, formal,
  code/terminal or default. Built-ins: Discord/WhatsApp/Telegram/Signal casual; Outlook/Gmail/Thunderbird formal; VS Code, Cursor,
  Windows Terminal, cmd, PowerShell, mintty code (no capital, no final stop, no trailing space). Your rows in Settings win over built-ins; the
  never-type-into list wins over everything. Applied to finals only: the live preview stays as the model writes it.
- **Translate (experimental)**: speak Dutch or English, get the other. Parakeet cannot translate, so the 0.6B local model is used with a
  translate-only prompt. Be realistic: it is weak. Measured here it produced "We moeten het tomorrow om tien" and "Bekijk de rapport eerst
  bij de vergelijking" for correct Dutch/English sentences, and good output for easy ones. A guard rejects empty, wrong-language, CJK or
  prompt-echo answers and types the original, but it cannot judge quality. Quality is NOT verified.
- **Whisper mode**: input gain (default 3x) plus a lower VAD threshold (0.3 instead of 0.5), a Whisper chip under the bar, tray toggle. On
  synthesised speech scaled to -56 dBFS rms, normal mode lost "I would like to" (14 words heard of 23), whisper mode heard all 23. A real
  whisper through a real microphone was not tested.
- **AI cleanup (off by default)**: Qwen3 0.6B Q8_0 from Qwen/Qwen3-0.6B-GGUF, run by node-llama-cpp 3.22.1 (prebuilt CPU binary,
  `llm-runtime/`) in a worker thread, CPU only, 2 threads by default. Finals only, never partials; fixed few-shot prompt, thinking disabled,
  temperature 0, 1.5 s hard limit (start-up included), then the original text is typed. The reply must keep the words (word-level
  Levenshtein <= 0.34, char similarity >= 0.8, Jaccard >= 0.6, length 0.7-1.4x) or the original is typed. It starts when you press the key
  and is freed after 5 idle minutes (setting). Measured on this PC (Ryzen 7 7800X3D, 8 cores, 6 sentences, warm): median 475 ms, max 645 ms
  at 2 threads, 1.87 cores busy = 23% of the machine while generating; 4 threads: median 471 ms, 43% of the machine, so 2 is the default.
  Cold start 1.2 s. Quality is modest: it adds capitals and stops, but does not fix "their going" -> "they're going". Without the model
  files or runtime every call falls back to the original text.
  First runtime tried was llama.cpp's llama-server b11583 (official release, hash-verified); Norton deleted its 9 KB launcher after a few
  runs and blocked re-creating it, so it was dropped for node-llama-cpp, which loads in-process.
- **Notes**: "note to self, <text>" / "notitie aan mezelf, <text>" (or the trigger alone, then the note as the next sentence) saves the note
  instead of typing it, shows "Saved note" in the bar, and appends a JSON line to `<userData>/notes.jsonl`
  (`{id, ts, text, sync, attempts, nextAt, error?, pageId?}`). The Notes page lists them with Copy, Resend and Delete. Optional Notion
  sync (Settings): POST https://api.notion.com/v1/pages with `Notion-Version: 2022-06-28`, your integration token (encrypted with Electron
  safeStorage in secrets.json, never logged, never read from .env) and a database or page id. Failures stay in the outbox and retry after
  30 s, 1 min, 2 min ... up to 1 h (Retry-After honoured). Developed against a local mock server only: **real Notion is unverified**. A
  timeout after Notion accepted a page can create a duplicate on retry (the API has no idempotency key).

Install the model runtime once: `npm --prefix llm-runtime install --omit=optional --ignore-scripts` (82 MB; integrity pinned by its lock file),
then Settings > AI cleanup > Download fetches the 639 MB model (SHA-256 checked).

## Measured (this PC, 8 cores, Rocket League + OBS not running, synthesised speech, real-time pacing)

| utterance | audio | onset to first char | release to final | decode RTF | CPU (2 thr / 4 thr, % of machine) |
|---|---|---|---|---|---|
| English 12.5 s | 12.5 s | 441 / 451 ms | 178 / 72 ms | 0.38 / 0.32 | 10.6 / 20.3 |
| Dutch 12 s (TTS accent) | 12.0 s | 447 / 395 ms | 479 / 75 ms | 0.40 / 0.30 | 11.3 / 20.1 |
| English with 1.3 s pause | 8.8 s | 445 / 461 ms | 557 / 210 ms | 0.32 / 0.25 | 9.3 / 16.1 |

GPU: the npm build of sherpa-onnx is CPU-only. Asking for `cuda` logs "compile with SHERPA_ONNX_ENABLE_GPU"
and falls back to CPU, so no GPU number exists. Default is CPU, 2 threads (8 s of audio decodes in ~0.5 s with
2 threads and with 4, so more threads only cost CPU).

## Slang packs (Dictionary page, added 2026-10-14)

Dictionary > Slang packs fixes the spelling and casing of slang, gamer and streamer words on finished sentences: "riz" becomes
"rizz", "goaded" becomes "goated", "Gee Gee" becomes "GG", "tick tock" stays what you said. Two built-in packs ship with the app
(English: 507 terms in slang, gaming, Rocket League and streaming; Dutch: 64), each switchable on its own. Add a term in one step,
edit or delete it, paste or import a .txt/.csv/.json list (one term per line, or `term,misheard1|misheard2`), export a pack,
and try a sentence in the "Try it" box. Format, matching rules and limits: docs/slang-packs.md.

**Where the words come from.** The starter packs were written by hand (spellings, misrecognitions, categories; no definitions).
Nothing was scraped or copied from Urban Dictionary and the app never contacts it. If you paste words from Urban Dictionary
into Import, whether bulk-importing from that site is allowed under its terms of service is your decision, not the app's.

**Measured** (synthesised speech, Kokoro voices af_heart and am_michael, a carrier sentence around each of 507 English terms,
decoded with the app's real Parakeet recognizer; Dutch is unmeasured, there is no Dutch voice here). "Right" = the preferred
spelling, case-sensitive, appears in the text.

| | voice af_heart | voice am_michael |
|---|---|---|
| right with no pack | 218 of 507 (43%) | 209 of 507 (41%) |
| right ignoring case, no pack | 310 | 288 |
| guessed variants only | 324 | 306 |
| shipped pack (guessed + measured, in-sample) | 402 (79%) | 381 (75%) |
| held-out: measured variants from af_heart only | n/a | 329 (65%) |
| terms the pack made worse | 0 | 0 |

Beam search with sherpa-onnx hotwords (opt-in, below), voice am_michael, pack measured on the other voice: greedy 209 right,
333 with the pack; hotwords at bias 33%: 238 / 368; at 50%: 245 / 384; at 67%: 248 / 392; at 100% the model starts inventing words.
(The app shows bias as a percent: percent = sherpa-onnx hotwords score / 3 x 100; see docs/slang-packs.md.)
Neutral sentences (40, no slang): word error rate 0.55% in every setting, no injected terms, the pack changes none of them.

**Hotwords.** sherpa-onnx 1.13.8 does support contextual biasing for this model, with `modified_beam_search` and a bpe
modeling unit only (the app builds the vocabulary from `tokens.txt`). Off by default: "Bias recognition toward these terms"
(experimental) restarts the speech engine when it or the packs change. Details: docs/slang-packs.md.

Proof: `pf-proof/slang-*.png` (Dictionary page at 1000x680), `slang-dictation.json` (off versus on through the real VAD + Parakeet).
## Tests

    node ~/.claude/skills/plan/ladder.js            # whole suite (asr, typing, app)
    electron .tests/app/real-typing.js             # one short real typing test into its own window (visible ~8 s)

Fixtures (`.tests/fixtures/*.wav`) are synthesised with the Kokoro model files of claude-voice and are not
committed; the tests regenerate them. Kokoro has no Dutch voice, so the Dutch fixture is Dutch text read with
an English voice: it proves the pipeline, not Dutch word accuracy.

## Models and packages

| item | size | SHA-256 |
|---|---|---|
| encoder.int8.onnx (huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8) | 652,184,281 | acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247 |
| decoder.int8.onnx | 11,845,275 | 179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e |
| joiner.int8.onnx | 6,355,277 | 3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3 |
| tokens.txt | 93,939 | d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d |
| silero_vad.onnx (k2-fsa/sherpa-onnx release asr-models) | 643,854 | 9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6 |
| Qwen3-0.6B-Q8_0.gguf (huggingface.co/Qwen/Qwen3-0.6B-GGUF, Apache-2.0) | 639,446,688 | 9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031 |
| llama-addon.node (@node-llama-cpp/win-x64 3.22.1) | | e0c2ccf0433a9b0a382334b332dc900728a0e293c00e6f21429e44e3d3cbdc5f |
| electron-v31.7.7-win32-x64.zip | 110,740,332 | e91986dd243d55947e6c5d3fad21795562ec21fa0eec5e95f7e28c830571467f |

npm: electron 31.7.7, sherpa-onnx-node 1.13.8, sherpa-onnx-win-x64 1.13.8 (23 MB, sha512 in package-lock.json).
The Parakeet hashes match the pins in rl-screenswitcher's model-store; the Silero hash was recorded at first
download (no upstream hash published).
