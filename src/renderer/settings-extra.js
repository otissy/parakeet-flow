// Settings sections added after the first release (voice commands, app tone, translate + whisper, AI cleanup,
// notes + Notion) and the Notes page. Plain functions over the shared state `S` of app.js (loaded after this file).
const ACTION_LABELS = { delete: 'Delete last segment', undo: 'Undo last action', newline: 'New line', paragraph: 'New paragraph', capitalize: 'Capitalize each word', allcaps: 'ALL CAPS', formal: 'Make formal', casual: 'Make casual' };
const PROFILE_LABELS = { default: 'Default', casual: 'Casual', formal: 'Formal', code: 'Code / terminal' };
const X = { llm: null, notion: null, notes: [], dlLlm: null, notionMsg: '' };

const opt = (map, val) => Object.entries(map).map(([v, t]) => `<option value="${L.esc(v)}" ${v === val ? 'selected' : ''}>${L.esc(t)}</option>`).join('');
const sel = (id, map, val, extra = '') => `<select id="${id}" ${extra}>${opt(map, val)}</select>`;
const badge = (txt, cls = '') => `<span class="badge ${cls}">${L.esc(txt)}</span>`;

async function loadExtra() {
  [X.llm, X.notion, X.notes] = await Promise.all([window.pf.invoke('llm:status'), window.pf.invoke('notion:status'), window.pf.invoke('notes:list')]);
}

function secCommands() {
  const c = S.settings.commands;
  const rows = c.list.map((r, i) => `<div class="trow"><div class="a">${L.esc(r.phrase)}</div><div class="b">${sel('cmd-act-' + i, ACTION_LABELS, r.action, `data-cmd="${i}"`)}</div><button class="iconbtn danger" data-cmd-del="${i}" title="Remove">${ICON_DEL}</button></div>`).join('');
  return `<h2 id="sec-commands">Voice commands</h2><div class="card" style="padding:4px 18px">
    <div class="srow"><div class="l"><b>Voice commands</b><div>Say a command on its own, after a short pause: it is never typed. Works in English and Dutch, on finished sentences only. Edits only the last thing you dictated, and only while the same window has focus.</div></div><div class="c">${toggle('cmd-on', c.enabled)}</div></div>
    <div class="srow col"><div class="l"><b>Phrases</b><div>${c.list.length} phrases. Each one runs one action.</div></div>
      <div class="c" style="display:block"><div class="card tbl" style="padding:2px 14px;max-height:230px;overflow:auto">${rows || '<div class="empty">No phrases.</div>'}</div>
      <div class="add3"><input type="text" id="cmd-new" placeholder="New phrase, for example: wis dat" autocomplete="off">${sel('cmd-new-act', ACTION_LABELS, 'delete')}<button class="btn primary" id="cmd-add">Add</button><button class="btn" id="cmd-reset" title="Restore the built-in English and Dutch list">Reset</button></div></div></div>
  </div>`;
}

function secTone() {
  const t = S.settings.tone, builtin = (S.info && S.info.builtinApps) || [];
  const user = t.apps.map((r, i) => `<div class="trow"><div class="a">${L.esc(r.match)}</div><div class="b">${sel('tone-p-' + i, PROFILE_LABELS, r.profile, `data-tone="${i}"`)}</div><button class="iconbtn danger" data-tone-del="${i}" title="Remove">${ICON_DEL}</button></div>`).join('');
  const bi = builtin.map((r) => `<div class="trow dim"><div class="a">${L.esc(r.proc || r.title)}${r.title ? ' <span class="note">(window title)</span>' : ''}</div><div class="b">${badge(PROFILE_LABELS[r.profile], r.profile)} ${badge('built-in')}</div><span style="width:30px"></span></div>`).join('');
  return `<h2 id="sec-tone">App tone</h2><div class="card" style="padding:4px 18px">
    <div class="srow"><div class="l"><b>Adapt to the app in front</b><div>The program or window title decides the tone of finished text: casual, formal, code/terminal (no capital, no trailing space) or default. Your own windows and the never-type-into list still win.</div></div><div class="c">${toggle('tone-on', t.enabled)}</div></div>
    <div class="srow col"><div class="l"><b>App table</b><div>Your rows come first and override the built-ins. A row matches a process name (discord) or text in the window title (gmail).</div></div>
      <div class="c" style="display:block"><div class="card tbl" style="padding:2px 14px;max-height:250px;overflow:auto">${user}${bi}</div>
      <div class="add3"><input type="text" id="tone-new" placeholder="Process or window title, for example: slack" autocomplete="off">${sel('tone-new-p', PROFILE_LABELS, 'casual')}<button class="btn primary" id="tone-add">Add</button></div></div></div>
  </div>`;
}

function secTranslate() {
  const tr = S.settings.translate, w = S.settings.whisper;
  const gains = Object.fromEntries([1.5, 2, 3, 4, 6].map((g) => [String(g), g + 'x']));
  const vads = Object.fromEntries([0.2, 0.3, 0.4, 0.5].map((g) => [String(g), String(g)]));
  const ready = X.llm && X.llm.runtime && X.llm.model === 'ready';
  return `<h2 id="sec-translate">Translate and whisper</h2><div class="card" style="padding:4px 18px">
    <div class="srow"><div class="l"><b>Translate Dutch and English ${badge('experimental', 'warn')}</b><div>Speak one, type the other. Parakeet cannot translate, so the small local model does it. A 0.6B model is weak at this: expect wrong words and mixed languages. If the answer looks wrong, the original is typed instead. Finished sentences only.${ready ? '' : ' Needs the local model (see AI cleanup below).'}</div></div><div class="c">${toggle('tr-on', tr.enabled, !ready && !tr.enabled)}</div></div>
    <div class="srow"><div class="l"><b>Direction</b><div>Swap: Dutch becomes English and English becomes Dutch, detected per sentence.</div></div><div class="c">${seg('tr-target', [['swap', 'Swap'], ['en', 'To English'], ['nl', 'To Dutch']], tr.target)}</div></div>
    <div class="srow"><div class="l"><b>Whisper mode</b><div>For quiet speech: boosts the input and makes the voice detector more sensitive. A Whisper badge shows under the bar while it is on.</div></div><div class="c">${toggle('wh-on', w.enabled)}</div></div>
    <div class="srow"><div class="l"><b>Input gain</b><div>Applied before recognition. Louder than 4x may clip.</div></div><div class="c">${sel('wh-gain', gains, String(w.gain))}</div></div>
    <div class="srow"><div class="l"><b>Voice detection threshold</b><div>Lower hears quieter speech but also more noise. Normal is 0.5.</div></div><div class="c">${sel('wh-vad', vads, String(w.vadThreshold))}</div></div>
  </div>`;
}

function secCleanup() {
  const c = S.settings.cleanup, l = X.llm || { runtime: false, model: 'unknown' };
  const ready = l.runtime && l.model === 'ready';
  const parts = [l.runtime ? badge('runtime installed', 'ok') : badge('runtime missing', 'bad'), l.model === 'ready' ? badge('model verified', 'ok') : badge(l.model === 'missing' ? 'model not downloaded' : 'model check failed', 'bad')];
  const last = l.last ? `Last use: ${l.last.kind}, ${l.last.used ? 'applied' : 'original kept (' + l.last.reason + ')'}, ${l.last.ms} ms.` : '';
  return `<h2 id="sec-cleanup">AI cleanup (local model)</h2><div class="card" style="padding:4px 18px">
    <div class="srow"><div class="l"><b>Local model</b><div>Qwen3 0.6B (Q8_0, 639 MB) from Qwen/Qwen3-0.6B-GGUF, checked against its SHA-256, run on the CPU only inside this app. ${l.runtime ? '' : 'The runtime is installed with: npm --prefix llm-runtime install --omit=optional --ignore-scripts.'}</div>${X.dlLlm ? `<div class="progress"><i style="width:${X.dlLlm.pct}%"></i></div>` : ''}<div style="margin-top:8px">${parts.join(' ')}</div></div>
      <div class="c">${l.model === 'ready' ? '' : `<button class="btn primary" id="llm-dl" ${X.dlLlm ? 'disabled' : ''}>${X.dlLlm ? X.dlLlm.pct + '%' : 'Download'}</button>`}</div></div>
    <div class="srow"><div class="l"><b>Clean up finished sentences</b><div>Off by default. Fixes grammar, punctuation and capitals of each finished sentence, never the live preview. If the model is slow, fails, or changes the words too much, your text is typed unchanged.${last ? '<br>' + L.esc(last) : ''}</div></div><div class="c">${toggle('cu-on', c.enabled, !ready && !c.enabled)}</div></div>
    <div class="srow"><div class="l"><b>Time limit</b><div>After this the original text is typed.</div></div><div class="c">${sel('cu-timeout', { 1000: '1.0 s', 1500: '1.5 s', 2000: '2.0 s', 3000: '3.0 s' }, String(c.timeoutMs))}</div></div>
    <div class="srow"><div class="l"><b>CPU threads</b><div>Two keeps games and streams smooth.</div></div><div class="c">${sel('cu-threads', { 1: '1', 2: '2', 3: '3', 4: '4' }, String(c.threads))}</div></div>
    <div class="srow"><div class="l"><b>Free the model after</b><div>The model loads when you start talking and is released after this many idle minutes.</div></div><div class="c">${sel('cu-idle', { 1: '1 minute', 5: '5 minutes', 15: '15 minutes', 60: '1 hour' }, String(c.idleMin))}</div></div>
  </div>`;
}

function secNotes() {
  const n = S.settings.notes, nt = n.notion, st = X.notion || { hasToken: false, encryption: false, counts: {} };
  return `<h2 id="sec-notes">Notes and Notion</h2><div class="card" style="padding:4px 18px">
    <div class="srow"><div class="l"><b>"Note to self"</b><div>Saying <i>note to self</i> or <i>notitie aan mezelf</i> followed by your note saves it to the Notes page instead of typing it. Nothing leaves this PC unless you turn on Notion sync below.</div></div><div class="c">${toggle('nt-on', n.enabled)}</div></div>
    <div class="srow col"><div class="l"><b>Trigger phrases</b><div>Comma separated.</div></div><div class="c"><input type="text" id="nt-trig" value="${L.esc(n.triggers.join(', '))}"></div></div>
    <div class="srow"><div class="l"><b>Sync to Notion</b><div>Uses the official Notion API with your own integration token. Notes that fail to sync stay saved here and are retried with a growing delay. ${badge('not verified against real Notion', 'warn')}</div></div><div class="c">${toggle('nn-on', nt.enabled)}</div></div>
    <div class="srow"><div class="l"><b>Send notes to</b><div>A database (new row per note) or a page (new sub-page per note).</div></div><div class="c">${seg('nn-type', [['database', 'Database'], ['page', 'Page']], nt.targetType)}</div></div>
    <div class="srow col"><div class="l"><b>${nt.targetType === 'page' ? 'Page' : 'Database'} ID or link</b><div>Share it with your integration first (the ... menu, Connections).</div></div><div class="c"><input type="text" id="nn-id" value="${L.esc(nt.targetId)}" placeholder="32-character id or the page link" autocomplete="off"></div></div>
    ${nt.targetType === 'database' ? `<div class="srow"><div class="l"><b>Title column</b><div>Name of the database's title property. Notion's default is Name.</div></div><div class="c"><input type="text" id="nn-title" value="${L.esc(nt.titleProperty)}"></div></div>` : ''}
    <div class="srow"><div class="l"><b>Integration token</b><div>${st.encryption ? 'Stored encrypted with Windows (safeStorage). It is never shown, logged or read from a file.' : 'Secure storage is not available on this PC, so a token cannot be saved.'}${X.notionMsg ? '<br>' + L.esc(X.notionMsg) : ''}</div></div>
      <div class="c"><input type="password" id="nn-token" placeholder="${st.hasToken ? 'Saved (hidden)' : 'secret_... or ntn_...'}" autocomplete="off" ${st.encryption ? '' : 'disabled'}><button class="btn primary" id="nn-save" ${st.encryption ? '' : 'disabled'}>Save</button>${st.hasToken ? '<button class="btn danger" id="nn-clear">Clear</button>' : ''}</div></div>
  </div>`;
}

function extraSettings() { return secCommands() + secTone() + secTranslate() + secCleanup() + secNotes(); }

function relTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return 'in ' + s + ' s';
  if (s < 5400) return 'in ' + Math.round(s / 60) + ' min';
  return 'in ' + Math.round(s / 3600) + ' h';
}
function syncLine(n, now = Date.now()) {
  if (n.sync === 'synced') return badge('Synced to Notion', 'ok');
  if (n.sync === 'pending') return badge('Waiting to sync', 'warn');
  if (n.sync === 'failed') return badge('Sync failed', 'bad') + ` <span class="note">${L.esc(n.error || '')} · retrying ${relTime(n.nextAt - now)}</span>`;
  return badge('Saved on this PC');
}

function notesPage() {
  const list = X.notes, c = (X.notion && X.notion.counts) || {};
  const body = !list.length ? `<div class="card empty">No notes yet. Say <b>note to self</b> and then your note while holding the key.</div>`
    : L.groupByDay(list).map((g) => `<div class="day">${L.esc(g.label)}</div><div class="card" style="padding:4px 14px">${g.items.map((n) =>
      `<div class="row note-row"><div class="time">${L.fmtTime(n.ts)}</div><div class="tx">${L.esc(n.text)}<div class="syncline">${syncLine(n)}</div></div>
      <button class="btn small" data-ncopy="${L.esc(n.id)}" title="Copy the note">Copy</button><button class="btn small" data-nresend="${L.esc(n.id)}" title="Send to Notion again now">Resend</button><button class="iconbtn danger" data-ndel="${L.esc(n.id)}" title="Delete this note">${ICON_DEL}</button></div>`).join('')}</div>`).join('');
  return `<div class="wrap"><h1>Notes</h1><div class="sub">Say "note to self" and your note, and it lands here. ${list.length} saved${c.failed ? `, ${c.failed} waiting to retry` : ''}.</div>${body}</div>`;
}

function bindExtra() {
  const q = (id) => document.getElementById(id);
  const on = (id, fn) => { const e = q(id); if (e) e.onclick = fn; };
  const val = (id, fn) => { const e = q(id); if (e) e.onchange = () => fn(e.value); };
  const s = S.settings;
  // voice commands
  on('cmd-on', () => save({ commands: { ...s.commands, enabled: !s.commands.enabled } }));
  main.querySelectorAll('[data-cmd]').forEach((e) => e.onchange = () => save({ commands: { ...s.commands, list: s.commands.list.map((r, i) => (i === +e.dataset.cmd ? { ...r, action: e.value } : r)) } }));
  main.querySelectorAll('[data-cmd-del]').forEach((b) => b.onclick = () => save({ commands: { ...s.commands, list: s.commands.list.filter((_, i) => i !== +b.dataset.cmdDel) } }));
  on('cmd-add', () => { const p = q('cmd-new').value.trim(); if (p) save({ commands: { ...s.commands, list: [...s.commands.list, { phrase: p, action: q('cmd-new-act').value }] } }); });
  on('cmd-reset', async () => { const d = await window.pf.invoke('settings:get', 'defaults'); save({ commands: { ...s.commands, list: d.commands.list } }); });
  // app tone
  on('tone-on', () => save({ tone: { ...s.tone, enabled: !s.tone.enabled } }));
  main.querySelectorAll('[data-tone]').forEach((e) => e.onchange = () => save({ tone: { ...s.tone, apps: s.tone.apps.map((r, i) => (i === +e.dataset.tone ? { ...r, profile: e.value } : r)) } }));
  main.querySelectorAll('[data-tone-del]').forEach((b) => b.onclick = () => save({ tone: { ...s.tone, apps: s.tone.apps.filter((_, i) => i !== +b.dataset.toneDel) } }));
  on('tone-add', () => { const m = q('tone-new').value.trim(); if (m) save({ tone: { ...s.tone, apps: [{ match: m, profile: q('tone-new-p').value }, ...s.tone.apps] } }); });
  // translate + whisper
  on('tr-on', () => save({ translate: { ...s.translate, enabled: !s.translate.enabled } }));
  const trs = q('tr-target'); if (trs) trs.querySelectorAll('button').forEach((b) => b.onclick = () => save({ translate: { ...s.translate, target: b.dataset.v } }));
  on('wh-on', () => save({ whisper: { ...s.whisper, enabled: !s.whisper.enabled } }));
  val('wh-gain', (v) => save({ whisper: { ...s.whisper, gain: +v } }));
  val('wh-vad', (v) => save({ whisper: { ...s.whisper, vadThreshold: +v } }));
  // cleanup
  on('cu-on', () => save({ cleanup: { ...s.cleanup, enabled: !s.cleanup.enabled } }));
  val('cu-timeout', (v) => save({ cleanup: { ...s.cleanup, timeoutMs: +v } }));
  val('cu-threads', (v) => save({ cleanup: { ...s.cleanup, threads: +v } }));
  val('cu-idle', (v) => save({ cleanup: { ...s.cleanup, idleMin: +v } }));
  on('llm-dl', () => window.pf.invoke('llm:download'));
  // notes
  on('nt-on', () => save({ notes: { ...s.notes, enabled: !s.notes.enabled } }));
  val('nt-trig', (v) => save({ notes: { ...s.notes, triggers: v.split(',') } }));
  const nn = (patch) => save({ notes: { ...s.notes, notion: { ...s.notes.notion, ...patch } } });
  on('nn-on', () => nn({ enabled: !s.notes.notion.enabled }));
  const ty = q('nn-type'); if (ty) ty.querySelectorAll('button').forEach((b) => b.onclick = () => nn({ targetType: b.dataset.v }));
  val('nn-id', (v) => nn({ targetId: v }));
  val('nn-title', (v) => nn({ titleProperty: v }));
  on('nn-save', async () => {
    const t = q('nn-token'); const v = t.value; t.value = '';
    if (!v.trim()) return;
    const r = await window.pf.invoke('notion:set-token', v);
    X.notionMsg = r.ok ? 'Token saved.' : r.error; await loadExtra(); render();
  });
  on('nn-clear', async () => { await window.pf.invoke('notion:clear-token'); X.notionMsg = 'Token removed.'; await loadExtra(); render(); });
  // notes page
  main.querySelectorAll('[data-ncopy]').forEach((b) => b.onclick = async () => { await window.pf.invoke('notes:copy', b.dataset.ncopy); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 900); });
  main.querySelectorAll('[data-nresend]').forEach((b) => b.onclick = async () => { b.disabled = true; b.textContent = 'Sending'; await window.pf.invoke('notes:resend', b.dataset.nresend); await loadExtra(); render(); });
  main.querySelectorAll('[data-ndel]').forEach((b) => b.onclick = async () => { await window.pf.invoke('notes:delete', b.dataset.ndel); await loadExtra(); render(); });
}

window.pf.on('notes:changed', async () => { X.notes = await window.pf.invoke('notes:list'); X.notion = await window.pf.invoke('notion:status'); if (S.page === 'notes') render(); });
window.pf.on('llm:progress', async (p) => { X.dlLlm = p.done ? null : { pct: Math.round(p.pct) }; if (p.done) await loadExtra(); if (S.page === 'settings') render(); });
