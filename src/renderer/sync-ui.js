// Settings > Sync: customization sync between the user's own installs (off by default). Plain functions over the shared state of
// app.js and settings-extra.js. The main process keeps the key and tokens: a page only ever sees the URL and this install's ID.
const XS = { name: null, url: null, key: '', join: '', paste: '', setup: null, adv: false, code: null, msg: '', msgRow: '', err: false, busy: false };

const syncAgo = (ms) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  if (s < 129600) return Math.round(s / 3600) + ' h ago';
  return new Date(ms).toLocaleDateString();
};

function syncStatusLine(st) {
  if (!st.enabled) return 'Sync is off. Nothing is sent and the server is not contacted.';
  const parts = [];
  if (st.lastError) parts.push(`${st.lastError} Your customization is safe on this PC${st.nextRetryAt > Date.now() ? '; trying again automatically' : ''}.`);
  else if (st.lastSyncAt) parts.push(`Last sync ${syncAgo(st.lastSyncAt)}: ${st.pulled} received, ${st.pushed ? 'customization sent' : 'nothing to send'}.`);
  else parts.push('Waiting for the first sync.');
  if (st.waiting) parts.push(`${st.waiting} change${st.waiting === 1 ? '' : 's'} waiting to send.`);
  if (st.notice) parts.push(st.notice);
  return parts.join(' ');
}

const SYNC_CONFIRM = {
  unlink: 'Unlink this PC? It stops sharing customization with your linked installs, and linking it again takes a new code. If only one other install is linked, that link ends too. Your customization stays on this PC.',
  restore: 'Restore the backup? It replaces your current customization on this PC, and words and rows added since the backup are removed. This also reaches your linked installs. There is no undo.',
  join: 'Link this PC with the Sync code? A backup of your customization is saved first. This PC then uses the project in the code (a different project means it leaves its current link and gets a new install ID there), joins the other PC\'s group, and values the other PC changed more recently replace yours on this PC. The code works once.',
  project: 'Switch to a different Supabase project? This PC drops its link and its list of linked installs, and gets a new install ID in the new project. Your customization stays on this PC, and what was uploaded stays in the old project.',
};
/** a valid URL (the main process checks it again) for another project than the saved one */
function changesProject(raw, st) {
  if (!st.url) return false;
  try {
    const u = new URL(String(raw).trim());
    const allowed = u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname));
    return allowed && !u.username && !u.password && u.origin !== st.url;
  } catch (_) { return false; }
}

/** the state in one word, next to the section title */
function syncBadge(st) {
  const [text, cls] = !st.enabled ? ['Off', ''] : st.lastError ? (st.offline ? ['Offline', 'warn'] : ['Failed', 'bad']) : st.syncing || st.waiting || !st.lastSyncAt ? ['Syncing', 'warn'] : ['Up to date', 'ok'];
  return `<span class="badge ${cls}" id="sy-badge">${text}</span>`;
}

/** the answer to a button, under the row that button is in */
function syncMsg(row) {
  if (!XS.msg || XS.msgRow !== row) return '';
  return `<div id="sy-msg" class="symsg" role="${XS.err ? 'alert' : 'status'}" ${XS.err ? 'style="color:var(--bad)"' : ''}>${L.esc(XS.msg)}</div>`;
}

/** why a control is off, written beside it (empty when it is on) */
function syncWhy(st, need) {
  if (!st.encryption) return 'Secure storage is not available on this PC.';
  if (need === 'project' && !st.configured) return 'Save the project URL and key above first.';
  if (need === 'on' && !st.enabled) return st.configured ? 'Switch sync on first (step 2).' : 'Save the project (step 1) and switch sync on (step 2) first.';
  return '';
}
const whyNote = (id, text) => (text ? `<div id="${id}" class="note" style="color:var(--text)">${L.esc(text)}</div>` : '');

function secSync() {
  const st = X.sync;
  if (!st) return `<h2 id="sec-sync">Sync</h2><div class="card" style="padding:4px 18px"><div class="srow"><div class="l"><b>Sync</b><div>The sync status could not be read. Everything else works as usual.</div></div></div></div>`;
  const whyOn = syncWhy(st, 'project'), whyLink = syncWhy(st, 'on');
  const off = whyLink ? 'disabled' : '';
  const url = XS.url === null ? st.url : XS.url;
  const members = st.members.filter((m) => !m.isMe);
  const rows = members.map((m) => `<div class="trow"><div class="a"><div>${L.esc(m.name || m.machine || 'Unnamed install')}</div><div class="note" style="font-family:Consolas,monospace;font-size:11.5px;overflow-wrap:anywhere">${L.esc(m.id)}</div></div><div class="b"><span class="note">${L.esc(m.version)}</span></div></div>`).join('');
  const conflicts = st.conflicts.map((c) => `<div class="trow"><div class="a">${L.esc(c.label)}</div><div class="b"><span class="note">kept ${c.kept === 'this' ? 'this PC' : 'the other PC'} (newer); replaced ${L.esc(c.lost)}</span></div></div>`).join('');
  const live = XS.setup && XS.setup.expiresAtMs > Date.now() ? XS.setup : null;
  const setupBox = XS.setup ? (live
    ? `<div style="margin-top:8px"><textarea id="sy-setup-code" readonly rows="3" style="width:100%;box-sizing:border-box;font-family:Consolas,monospace;font-size:11.5px" aria-label="Sync code">${L.esc(live.setupCode)}</textarea><div class="note">Paste it in Settings > Sync on the other PC, in the box at the top. It works once and stops working at ${L.esc(new Date(live.expiresAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))} (10 minutes). It holds this project's URL and publishable key, so share it only with your own PC.</div><button class="btn" id="sy-copy" style="margin-top:6px">Copy code</button></div>`
    : '<div id="sy-setup-expired" class="note" style="margin-top:8px">That Sync code has expired. Create a new one.</div>') : '';
  return `<h2 id="sec-sync">Sync ${syncBadge(st)}</h2><div class="card" style="padding:4px 18px" id="sync-card">
    <div class="srow col"><div class="l"><b>Already set up on another PC?</b><div>Paste its <b>Sync code</b> here. This PC saves the project, switches sync on and links itself in one step; you can skip steps 1 to 3.</div></div>
      <div class="c"><input type="text" id="sy-paste" value="${L.esc(XS.paste)}" placeholder="PFS1-..." autocomplete="off" spellcheck="false" ${st.encryption ? '' : 'disabled'}><button class="btn primary" id="sy-paste-go" ${st.encryption ? '' : 'disabled'}>Link this PC</button></div>${whyNote('sy-paste-why', st.encryption ? '' : syncWhy(st))}${syncMsg('paste')}</div>
    <div class="srow col"><div class="l"><b>Step 1 · Project</b><div>${st.encryption ? 'Your own Supabase project. The key is stored encrypted with Windows; a secret or service-role key is refused.' : 'Secure storage is not available on this PC, so sync cannot be used.'}</div></div>
      <div class="c"><input type="text" id="sy-url" value="${L.esc(url)}" placeholder="https://your-project.supabase.co" autocomplete="off" ${st.encryption ? '' : 'disabled'}><input type="password" id="sy-key" value="${L.esc(XS.key)}" placeholder="${st.configured ? 'Saved (hidden)' : 'sb_publishable_...'}" autocomplete="off" ${st.encryption ? '' : 'disabled'}><button class="btn primary" id="sy-save" ${st.encryption ? '' : 'disabled'}>Save</button></div>${syncMsg('project')}</div>
    <div class="srow"><div class="l"><b>Step 2 · Sync my customization</b>${whyNote('sy-on-why', whyOn)}<div>Off by default. While on, this install sends to the Supabase project above: hotkeys; typing and style preferences, with your per-app rows; tone and voice commands; note phrases; translate and cleanup preferences; filler words; your Dictionary rows; your words in My terms with their bias; and which packs are on. It also sends a random install ID, the app version and this PC's name (below), and each request carries the project's publishable key and this install's sign-in token. The server sees your IP address. The data is stored unencrypted: the project's owner can read it, and your linked installs can read and change it. Sync never sends dictated text, transcript history, notes, meetings, audio, snippets, your Notion token or logs. While this is off, sync contacts nothing.</div>${syncMsg('on')}</div><div class="c">${toggle('sy-on', st.enabled, !!whyOn)}</div></div>
    <div class="srow"><div class="l"><b>Step 3 · Link another PC</b>${whyNote('sy-setup-why', whyLink)}<div>Creates one <b>Sync code</b> for your other PC. It holds this project, so the other PC needs nothing else. Linked installs share this customization, so link only your own.</div>${setupBox}${syncMsg('setup')}</div><div class="c"><button class="btn primary" id="sy-setup" ${off}>Create Sync code</button></div></div>
    <div class="srow"><div class="l"><b>This PC's name</b><div>Shown next to this install's ID on your linked installs. It starts as this computer's Windows name${st.nameIsDefault ? ' (that name is what is sent now)' : ''}; change it, or empty it to send no name.</div>${syncMsg('name')}</div><div class="c"><input type="text" id="sy-name" value="${L.esc(XS.name === null ? st.name || '' : XS.name)}" placeholder="For example: Desk PC" autocomplete="off" maxlength="40"></div></div>
    <div class="srow"><div class="l"><b>This install's ID</b><div style="font-family:Consolas,monospace;overflow-wrap:anywhere">${st.installId ? L.esc(st.installId) : 'Created when sync is first switched on.'}</div></div></div>
    <div class="srow col"><div class="l"><b>Linked installs</b><div>${members.length ? members.length + ' linked.' : 'None. This install syncs only with its own copy.'}</div></div>${rows ? `<div class="c" style="display:block"><div class="card tbl" style="padding:2px 14px">${rows}</div></div>` : ''}</div>
    <div class="srow"><div class="l"><b>Last sync</b><div id="sy-status" ${st.lastError ? 'style="color:var(--bad)"' : ''}>${L.esc(syncStatusLine(st))}</div>${whyNote('sy-now-why', whyLink)}${syncMsg('now')}</div><div class="c"><button class="btn" id="sy-now" ${off}>Sync now</button>${st.linked ? `<button class="btn danger" id="sy-unlink" ${off}>Unlink</button>` : ''}</div></div>
    ${st.backup ? '<div class="srow"><div class="l"><b>Backup</b><div>A copy of your customization from before the first pull. Restoring counts as a new edit, so it also reaches your linked installs.</div>' + syncMsg('backup') + '</div><div class="c"><button class="btn" id="sy-restore">Restore backup</button></div></div>' : ''}
    ${conflicts ? `<div class="srow col"><div class="l"><b>Changed on two PCs</b><div>The newer value was kept on every PC. What it replaced:</div></div><div class="c" style="display:block"><div class="card tbl" style="padding:2px 14px">${conflicts}</div></div></div>` : ''}
    <details id="sy-adv" ${XS.adv ? 'open' : ''} style="padding:10px 0"><summary style="cursor:pointer"><b>Advanced: short link codes</b></summary>
      <div class="note" style="margin:6px 0">The older route: both PCs already hold the same project, and a short 6-character code links them.</div>
      <div class="srow"><div class="l"><b>Link another PC</b><div>${XS.code ? `Enter <b>${L.esc(XS.code.code)}</b> on the other PC. It works once, for 10 minutes.` : 'Creates a short code for one other install.'}</div>${whyNote('sy-code-why', whyLink)}${syncMsg('code')}</div><div class="c"><button class="btn" id="sy-code" ${off}>Create link code</button></div></div>
      <div class="srow"><div class="l"><b>Join with a code</b><div>A short code from another install. A backup of your customization is saved first.</div>${whyNote('sy-join-why', whyLink)}${syncMsg('join')}</div><div class="c"><input type="text" id="sy-join" value="${L.esc(XS.join)}" placeholder="ABC-234" autocomplete="off" maxlength="12" ${off}><button class="btn" id="sy-join-go" ${off}>Join</button></div></div>
    </details>
  </div>`;
}

function bindSync() {
  const q = (id) => document.getElementById(id);
  if (!q('sync-card')) return;
  const act = async (row, fn, ok = '') => {
    if (XS.busy) return;
    XS.busy = true; XS.msg = ''; XS.err = false; XS.msgRow = row;
    let r;
    try { r = await fn(); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
    XS.busy = false;
    if (r && r.ok === false && r.error) { XS.msg = r.error; XS.err = true; } else XS.msg = ok;
    await syncRefresh();
    const m = q('sy-msg');
    if (m) m.scrollIntoView({ block: 'nearest' });
    return r;
  };
  const input = (id, key) => { const e = q(id); if (e) e.oninput = () => { XS[key] = e.value; }; };
  input('sy-name', 'name'); input('sy-url', 'url'); input('sy-key', 'key'); input('sy-join', 'join'); input('sy-paste', 'paste');
  const adv = q('sy-adv'); if (adv) adv.ontoggle = () => { XS.adv = adv.open; };
  const on = (id, fn) => { const e = q(id); if (e) e.onclick = fn; };
  if (q('sy-name')) q('sy-name').onchange = () => act('name', async () => { const r = await window.pf.invoke('sync:set-name', q('sy-name').value); if (r && r.ok) XS.name = null; return r; }, 'Saved.');
  on('sy-on', () => act('on', () => window.pf.invoke('sync:set-enabled', !X.sync.enabled)));
  on('sy-save', () => changesProject(q('sy-url').value, X.sync) && !window.confirm(SYNC_CONFIRM.project) ? undefined : act('project', async () => {
    const r = await window.pf.invoke('sync:configure', { url: q('sy-url').value, key: q('sy-key').value });
    if (r && r.ok) XS.url = null;
    XS.key = '';      // saved, or refused: either way a key never stays in the box or in this page's memory
    return r;
  }, 'Saved. Switch sync on when you are ready.'));
  on('sy-paste-go', () => { if (!q('sy-paste').value.trim()) { XS.msgRow = 'paste'; XS.msg = 'Paste the Sync code from the other PC.'; XS.err = true; render(); return; } if (window.confirm(SYNC_CONFIRM.join)) act('paste', async () => { const r = await window.pf.invoke('sync:join-setup', q('sy-paste').value); XS.paste = ''; return r; }, 'Linked. This PC is set up and syncing.'); });
  on('sy-setup', () => act('setup', async () => { const r = await window.pf.invoke('sync:create-setup-code'); XS.setup = r && r.ok ? r : null; return r; }));
  on('sy-copy', () => act('setup', async () => { const t = q('sy-setup-code'); try { await navigator.clipboard.writeText(t.value); } catch (_) { t.select(); document.execCommand('copy'); } return { ok: true }; }, 'Copied.'));
  on('sy-code', () => act('code', async () => { const r = await window.pf.invoke('sync:create-code'); XS.code = r && r.ok ? r : null; return r; }));
  on('sy-join-go', () => act('join', async () => { const r = await window.pf.invoke('sync:join', q('sy-join').value); if (r && (r.ok || r.refused)) XS.join = ''; return r; }, 'Linked.'));
  on('sy-now', () => act('now', () => window.pf.invoke('sync:now')));
  on('sy-unlink', () => { if (window.confirm(SYNC_CONFIRM.unlink)) act('now', () => window.pf.invoke('sync:unlink'), 'Unlinked. Your customization stays on this PC.'); });
  on('sy-restore', () => { if (window.confirm(SYNC_CONFIRM.restore)) act('backup', () => window.pf.invoke('sync:restore'), 'Backup restored.'); });
}

async function syncRefresh() {
  try { X.sync = await window.pf.invoke('sync:status'); } catch (_) { X.sync = null; }
  if (S.page === 'settings') render();
}
window.pf.on('sync:changed', syncRefresh);
