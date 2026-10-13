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

Default hotkey: **Pause** (hold to talk). It is a lone key on purpose: Ctrl, Alt or Win held down would turn a
correction Backspace into a word-delete. Change it in Settings. Double-tap starts hands-free, any press or the
stop button ends it, Esc cancels and removes the live segment's text. Launch-at-login is off and is only
registered when you switch it on.

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
  ships with Windows. One persistent process: GetAsyncKeyState polling every 30 ms (hotkey, Esc, foreground
  window) and SendInput with KEYEVENTF_UNICODE. It refuses to type if the foreground window is not the
  one the session started in.
- Finals only: filler removal, dictionary, snippets, casual style (`src/core/postprocess.js`).
- Logs hold counts and timings, never dictated text. Audio is never written to disk. History is off by default.

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
| electron-v31.7.7-win32-x64.zip | 110,740,332 | e91986dd243d55947e6c5d3fad21795562ec21fa0eec5e95f7e28c830571467f |

npm: electron 31.7.7, sherpa-onnx-node 1.13.8, sherpa-onnx-win-x64 1.13.8 (23 MB, sha512 in package-lock.json).
The Parakeet hashes match the pins in rl-screenswitcher's model-store; the Silero hash was recorded at first
download (no upstream hash published).
