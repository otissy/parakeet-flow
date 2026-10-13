# parakeet-flow

Hold a key, talk, and the words appear in the focused app while you are still talking. They are corrected in
place and settle into clean text when you let go. Everything runs on this PC (Parakeet TDT 0.6B v3, int8,
via sherpa-onnx). A small floating bar shows the level and the live text; a tray icon and a main window hold
the settings. The design follows the layout and feel of Wispr Flow without using its name or logo.

## Run

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
