'use strict';
/* Optional Notion sync for the notes outbox, over the official REST API: POST https://api.notion.com/v1/pages
   with an Authorization bearer token and a Notion-Version header. The integration token is supplied by the user in
   Settings and kept encrypted (src/main/secret.js); this file only ever receives it as a function result,
   puts it in the Authorization header and never logs, stores or returns it, not even in an error message.
   Real Notion was not reachable in development: the tests run against a local mock server. */
const NOTION_VERSION = '2022-06-28';
const API = 'https://api.notion.com';
const TITLE_MAX = 100, BLOCK_MAX = 2000, MAX_BLOCKS = 90;

/** production is always https://api.notion.com; tests may point at a loopback http server and nothing else */
function resolveBase(base) {
  if (!base) return API;
  try {
    const u = new URL(base);
    if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return u.origin;
  } catch (_) { /* fall through */ }
  return API;
}

const rt = (content) => [{ type: 'text', text: { content } }];

/** the body of POST /v1/pages. targetType: 'database' (title property `titleProperty`) | 'page' (child page) */
function buildPageBody(note, { targetType = 'database', targetId = '', titleProperty = 'Name' } = {}) {
  const text = String(note.text || '');
  const firstLine = text.split(/\r?\n/)[0].trim();
  const title = (firstLine.length > TITLE_MAX ? firstLine.slice(0, TITLE_MAX - 1) + '…' : firstLine) || 'Note';
  const chunks = [];
  for (let i = 0; i < text.length && chunks.length < MAX_BLOCKS; i += BLOCK_MAX) chunks.push(text.slice(i, i + BLOCK_MAX));
  const children = chunks.map((c) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(c) } }));
  if (targetType === 'page') return { parent: { page_id: targetId }, properties: { title: { title: rt(title) } }, children };
  return { parent: { database_id: targetId }, properties: { [titleProperty || 'Name']: { title: rt(title) } }, children };
}

const redact = (s, token) => { let t = String(s ?? ''); if (token) t = t.split(token).join('[token]'); return t.replace(/(secret_|ntn_)[A-Za-z0-9]+/g, '[token]'); };

/** one POST. Never throws; never returns the token. -> {ok, status, id?, retryAfterMs?, error?} */
async function createPage({ token, body, base, fetchImpl = (...a) => fetch(...a), timeoutMs = 15000 }) {
  try {
    const res = await fetchImpl(resolveBase(base) + '/v1/pages', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    let j = null; try { j = await res.json(); } catch (_) { /* not json */ }
    if (res.ok) return { ok: true, status: res.status, id: j && j.id };
    const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
    return { ok: false, status: res.status, retryAfterMs: Number.isFinite(ra) && ra > 0 ? Math.min(ra, 3600) * 1000 : 0,
      error: redact(`HTTP ${res.status}${j && j.code ? ' ' + j.code : ''}${j && j.message ? ': ' + String(j.message).slice(0, 120) : ''}`, token) };
  } catch (e) {
    return { ok: false, status: 0, error: redact(e && e.name === 'TimeoutError' ? 'timeout' : 'network error', token) };
  }
}

/** pushes outbox notes to Notion; failures stay in the outbox and retry with backoff (see outbox.backoffMs) */
class NotionSync {
  constructor({ outbox, getConfig, getToken, fetchImpl, now = Date.now, base, onChange = () => {} }) {
    Object.assign(this, { outbox, getConfig, getToken, fetchImpl, now, base, onChange });
    this.busy = false; this.timer = null;
  }

  ready() {
    const c = this.getConfig();
    return !!(c && c.enabled && c.targetId && this.getToken());
  }

  async syncNote(id) {
    const n = this.outbox.get(id); if (!n || n.sync === 'synced') return null;
    if (!this.ready()) return null;
    const c = this.getConfig();
    const r = await createPage({ token: this.getToken(), body: buildPageBody(n, c), base: this.base, fetchImpl: this.fetchImpl });
    if (r.ok) this.outbox.markSynced(id, r.id); else this.outbox.markFailed(id, r.error, { retryAfterMs: r.retryAfterMs });
    this.onChange(id);
    return r;
  }

  /** every note whose turn has come, one at a time and in order. Re-entrancy safe. */
  async runDue() {
    if (this.busy || !this.ready()) return 0;
    this.busy = true; let n = 0;
    try { for (const note of this.outbox.due(this.now())) { await this.syncNote(note.id); n++; } } finally { this.busy = false; }
    return n;
  }

  /** a new note: queue it when sync is configured, try straight away */
  async submit(id) {
    const n = this.outbox.get(id); if (!n) return;
    if (!this.ready()) return;
    if (n.sync === 'local') { n.sync = 'pending'; this.outbox.resend(id); }
    await this.runDue();
  }

  async resend(id) {
    const n = this.outbox.resend(id); if (!n) return null;
    this.onChange(id);
    return this.syncNote(id);
  }

  start(everyMs = 30000) { this.stop(); this.timer = setInterval(() => { this.runDue().catch(() => {}); }, everyMs); if (this.timer.unref) this.timer.unref(); }
  stop() { clearInterval(this.timer); this.timer = null; }
}

module.exports = { NOTION_VERSION, API, resolveBase, buildPageBody, createPage, NotionSync, redact };
