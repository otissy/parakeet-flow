// Settings > Sync: customization sync between the user's own installs (off by default). Plain functions over the shared state of
// app.js and settings-extra.js. The main process keeps the key and tokens: a page only ever sees the URL and this install's ID.
const XS = { url: null, key: '', join: '', code: null, msg: '', err: false, busy: false };

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

function secSync() {
  const st = X.sync;
  if (!st) return `<h2 id="sec-sync">Sync</h2><div class="card" style="padding:4px 18px"><div class="srow"><div class="l"><b>Sync</b><div>The sync status could not be read. Everything else works as usual.</div></div></div></div>`;
  const off = st.enabled ? '' : 'disabled';
  const url = XS.url === null ? st.url : XS.url;
  const members = st.members.filter((m) => !m.isMe);
  const rows = members.map((m) => `<div class="trow"><div class="a" style="font-family:Consolas,monospace;font-size:12.5px">${L.esc(m.id)}</div><div class="b"><span class="note">${L.esc(m.version)}</span></div></div>`).join('');
  const conflicts = st.conflicts.map((c) => `<div class="trow"><div class="a">${L.esc(c.label)}</div><div class="b"><span class="note">kept ${c.kept === 'this' ? 'this PC' : 'the other PC'} (newer); replaced ${L.esc(c.lost)}</span></div></div>`).join('');
  return `<h2 id="sec-sync">Sync</h2><div class="card" style="padding:4px 18px" id="sync-card">
    <div class="srow"><div class="l"><b>Sync my customization</b><div>Off by default. Sends only your customization to the Supabase project below: tone, voice commands, translate and cleanup preferences, typing preferences, hotkeys, your own words with their bias, and which packs are on. Dictated text, notes, meetings, tokens and logs never leave this PC. While this is off, sync contacts nothing.</div></div><div class="c">${toggle('sy-on', st.enabled, !st.configured || !st.encryption)}</div></div>
    <div class="srow col"><div class="l"><b>Project</b><div>${st.encryption ? 'Your own Supabase project. The key is stored encrypted with Windows; a secret or service-role key is refused.' : 'Secure storage is not available on this PC, so sync cannot be used.'}</div></div>
      <div class="c"><input type="text" id="sy-url" value="${L.esc(url)}" placeholder="https://your-project.supabase.co" autocomplete="off" ${st.encryption ? '' : 'disabled'}><input type="password" id="sy-key" value="${L.esc(XS.key)}" placeholder="${st.configured ? 'Saved (hidden)' : 'sb_publishable_...'}" autocomplete="off" ${st.encryption ? '' : 'disabled'}><button class="btn primary" id="sy-save" ${st.encryption ? '' : 'disabled'}>Save</button></div></div>
    <div class="srow"><div class="l"><b>This install's ID</b><div style="font-family:Consolas,monospace;overflow-wrap:anywhere">${st.installId ? L.esc(st.installId) : 'Created when sync is first switched on.'}</div></div></div>
    <div class="srow"><div class="l"><b>Link another PC</b><div>${XS.code ? `Enter <b>${L.esc(XS.code.code)}</b> on the other PC. It works once, for 10 minutes.` : 'Creates a code for one other install. Linked installs share this customization, so link only your own.'}</div></div><div class="c"><button class="btn" id="sy-code" ${off}>Create link code</button></div></div>
    <div class="srow"><div class="l"><b>Join with a code</b><div>A code from another install. A backup of your customization is saved first.</div></div><div class="c"><input type="text" id="sy-join" value="${L.esc(XS.join)}" placeholder="ABC-234" autocomplete="off" maxlength="12" ${off}><button class="btn" id="sy-join-go" ${off}>Join</button></div></div>
    <div class="srow col"><div class="l"><b>Linked installs</b><div>${members.length ? members.length + ' linked.' : 'None. This install syncs only with its own copy.'}</div></div>${rows ? `<div class="c" style="display:block"><div class="card tbl" style="padding:2px 14px">${rows}</div></div>` : ''}</div>
    <div class="srow"><div class="l"><b>Last sync</b><div id="sy-status" ${st.lastError ? 'style="color:var(--bad)"' : ''}>${L.esc(syncStatusLine(st))}</div>${XS.msg ? `<div ${XS.err ? 'style="color:var(--bad)"' : ''}>${L.esc(XS.msg)}</div>` : ''}</div><div class="c"><button class="btn" id="sy-now" ${off}>Sync now</button>${st.linked ? `<button class="btn danger" id="sy-unlink" ${off}>Unlink</button>` : ''}</div></div>
    ${st.backup ? '<div class="srow"><div class="l"><b>Backup</b><div>A copy of your customization from before the first pull. Restoring counts as a new edit, so it also reaches your linked installs.</div></div><div class="c"><button class="btn" id="sy-restore">Restore backup</button></div></div>' : ''}
    ${conflicts ? `<div class="srow col"><div class="l"><b>Changed on two PCs</b><div>The newer value was kept on every PC. What it replaced:</div></div><div class="c" style="display:block"><div class="card tbl" style="padding:2px 14px">${conflicts}</div></div></div>` : ''}
  </div>`;
}

function bindSync() {
  const q = (id) => document.getElementById(id);
  if (!q('sync-card')) return;
  const act = async (fn, ok = '') => {
    if (XS.busy) return;
    XS.busy = true; XS.msg = ''; XS.err = false;
    let r;
    try { r = await fn(); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
    XS.busy = false;
    if (r && r.ok === false && r.error) { XS.msg = r.error; XS.err = true; } else XS.msg = ok;
    await syncRefresh();
    return r;
  };
  const input = (id, key) => { const e = q(id); if (e) e.oninput = () => { XS[key] = e.value; }; };
  input('sy-url', 'url'); input('sy-key', 'key'); input('sy-join', 'join');
  const on = (id, fn) => { const e = q(id); if (e) e.onclick = fn; };
  on('sy-on', () => act(() => window.pf.invoke('sync:set-enabled', !X.sync.enabled)));
  on('sy-save', () => act(async () => {
    const r = await window.pf.invoke('sync:configure', { url: q('sy-url').value, key: q('sy-key').value });
    if (r && r.ok) { XS.url = null; XS.key = ''; }
    return r;
  }, 'Saved. Switch sync on when you are ready.'));
  on('sy-code', () => act(async () => { const r = await window.pf.invoke('sync:create-code'); XS.code = r && r.ok ? r : null; return r; }));
  on('sy-join-go', () => act(async () => { const r = await window.pf.invoke('sync:join', q('sy-join').value); if (r && r.ok) XS.join = ''; return r; }, 'Linked.'));
  on('sy-now', () => act(() => window.pf.invoke('sync:now')));
  on('sy-unlink', () => act(() => window.pf.invoke('sync:unlink'), 'Unlinked. Your customization stays on this PC.'));
  on('sy-restore', () => act(() => window.pf.invoke('sync:restore'), 'Backup restored.'));
}

async function syncRefresh() {
  try { X.sync = await window.pf.invoke('sync:status'); } catch (_) { X.sync = null; }
  if (S.page === 'settings') render();
}
window.pf.on('sync:changed', syncRefresh);
