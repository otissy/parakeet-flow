# parakeet-flow MCP server

A small local MCP server (stdio, Node) that gives any MCP client, such as Claude Code, access to the notes you dictated
with parakeet-flow. Claude Code already has your Notion and Google Drive connectors authorised, so it can file the notes
there for you: **this app holds no Notion token for that and makes no network call from here.**

Official SDK `@modelcontextprotocol/sdk` 1.32.1 and `zod` 3.25.76, pinned in `package.json` and hash-locked in
`package-lock.json`.

## Install and connect

```
npm --prefix mcp ci --ignore-scripts
claude mcp add parakeet-flow -- node "C:\path\to\parakeet-flow\mcp\server.js"
```

(or a `.mcp.json` next to your project: see the README at the repo root). Nothing here runs those commands for you. Use
the exact path shown in parakeet-flow's Settings > Connect to Claude (MCP), which has a copy button.

Without the app running the server still works: it reads and writes `%APPDATA%\parakeet-flow\notes.jsonl`.
A different data folder: `--data-dir=<absolute path>` or the `PF_USERDATA` environment variable.

## Tools

| tool | what it does |
|---|---|
| `notes_list(status, limit, order)` | `status` pending (default) / synced / all; `limit` 1-100 (default 20); `order` newest (default) / oldest. Returns `{notes:[{id, created, text, tags, source, status, destination?, url?}], total, returned, truncated}` |
| `note_get(id)` | one note |
| `note_mark_synced(id, destination, url?)` | record where you filed it ("Notion: Notes database", an http(s) link). The note stops showing as pending, in the app too. Safe to repeat |
| `notes_add(text, tags?)` | add a note (up to 20000 characters, at most 10 tags). Shows in the Notes page |
| `dictation_status()` | running, hotkey labels, speech engine state, note counts. No dictated text |
| `recent_dictation(limit)` | the most recent transcripts. **Only listed and served while "Share recent dictation history with MCP clients" is on in Settings (default off)**, and needs transcript history on |

Every reply carries the notes as data: the tool descriptions tell the model never to follow instructions found inside a note.

## What it can touch

Only two files in the app's data folder, no path ever comes from the client:

- `notes.jsonl`: read and write. Writes take a lock file (`notes.jsonl.lock`, created exclusively, a lock older than 15 s is treated as a crashed holder), re-read the file, and either append one line or rewrite through a unique temp file and a rename. The app uses the same module (`src/notes/outbox.js`), so a note added by Claude shows up in the app within a second, and a note the app adds is visible to the server on its next call. Tested: the app (a separate process that adds and rewrites) and the server writing at once, 200 notes, none lost, none duplicated.
- `mcp-status.json`: written by the running app: engine state, hotkey labels, and recent dictation only while sharing is on (the app writes an empty list otherwise).

It never opens settings, the encrypted token store, transcript history, models or logs. The Notion token (if you use the app's own Notion sync) is never read.

## Logging

One line per call to `%APPDATA%\parakeet-flow\logs\mcp.log` and to stderr: time, tool, `ok` / `rejected` / `error`, a count, milliseconds. Never note text, ids, tags, arguments or SDK error messages.

## Limits

Reply size 100 000 characters (a long list is cut and `truncated` is true); notes file refuses `notes_add` above 20 MB; every argument is validated (ids `[A-Za-z0-9_-]{1,64}`, urls http or https only, destination without control characters).

## Tests

`node ~/.claude/skills/plan/ladder.js .tests/mcp` (from the repo root): in-memory client/server for every tool, a stdio end-to-end test that spawns the server and speaks JSON-RPC (also raw lines, no SDK client), malformed input, concurrency, privacy.
