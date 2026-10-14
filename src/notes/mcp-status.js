'use strict';
/* mcp-status.json: the ONE small file (besides notes.jsonl) the MCP server may read. The running app writes it; it holds
   no secret, no setting other than what dictation_status reports, and dictated text ONLY when the user turned on
   "Share recent dictation history with MCP clients" (Settings, default off). When that switch is off the app writes
   `recent: []`, so there is nothing for the server to leak even if it were asked. The server reads it through
   readStatus(), which copies out a whitelist of fields and re-checks every one. */
const fs = require('fs');
const path = require('path');

const FILE = 'mcp-status.json';
const ENGINES = ['ready', 'loading', 'missing', 'error'];
const FRESH_MS = 60 * 1000;
const MAX_RECENT = 50, MAX_RECENT_TEXT = 2000;

const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);

/** @param s {pid, engine, hotkeys:{dictation, note}, shareHistory, recent:[{ts,text}], version} */
function writeStatus(dir, s, now = Date.now()) {
  const share = !!s.shareHistory;
  const out = {
    v: 1, pid: Number.isInteger(s.pid) ? s.pid : process.pid, updatedAt: now, version: str(s.version, 20),
    engine: ENGINES.includes(s.engine) ? s.engine : 'loading',
    hotkeys: { dictation: str(s.hotkeys?.dictation, 40), note: str(s.hotkeys?.note, 40) },
    shareHistory: share,
    recent: share && Array.isArray(s.recent) ? s.recent.slice(0, MAX_RECENT).map((e) => ({ ts: +e.ts || 0, text: String(e.text ?? '').slice(0, MAX_RECENT_TEXT) })) : [],
  };
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, FILE), tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out));
  for (let i = 0; i < 20; i++) { try { fs.renameSync(tmp, f); return out; } catch (e) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; } }
  try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  return null;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/** @returns {{running:boolean, engine:string, hotkeys:{dictation:string,note:string}|null, shareHistory:boolean, recent:object[], updatedAt:number|null}} */
function readStatus(dir, now = Date.now()) {
  const none = { running: false, engine: 'unknown', hotkeys: null, shareHistory: false, recent: [], updatedAt: null };
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8')); } catch (_) { return none; }
  if (!j || typeof j !== 'object') return none;
  const updatedAt = Number.isFinite(j.updatedAt) ? j.updatedAt : null;
  const fresh = updatedAt != null && now - updatedAt <= FRESH_MS && Number.isInteger(j.pid) && alive(j.pid);
  const share = j.shareHistory === true;
  return {
    running: fresh, engine: fresh && ENGINES.includes(j.engine) ? j.engine : 'unknown',
    hotkeys: j.hotkeys && typeof j.hotkeys === 'object' ? { dictation: str(j.hotkeys.dictation, 40), note: str(j.hotkeys.note, 40) } : null,
    shareHistory: share,
    recent: share && Array.isArray(j.recent) ? j.recent.slice(0, MAX_RECENT).map((e) => ({ ts: +e?.ts || 0, text: String(e?.text ?? '').slice(0, MAX_RECENT_TEXT) })) : [],
    updatedAt,
  };
}

module.exports = { writeStatus, readStatus, FILE, FRESH_MS, ENGINES };
