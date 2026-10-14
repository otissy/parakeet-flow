// Slang packs section of the Dictionary page. Plain functions over the shared state `S` and helpers of app.js (loaded after this file).
// State lives in SL; every action goes through window.pf.invoke('slang:*') and then reloads the pack list.
const SL = { state: null, view: null, terms: { total: 0, items: [] }, query: '', edit: null, msg: null, imp: null, tryText: 'no kap that was bussin, he got the goaded ceiling shot and a flip reset. gg', tryOut: null };

async function loadSlang() {
  SL.state = await window.pf.invoke('slang:state');
  if (SL.view && !SL.state.packs.some((p) => p.id === SL.view)) SL.view = null;
  if (SL.view) SL.terms = await window.pf.invoke('slang:terms', SL.view, { query: SL.query, limit: 120 });
  SL.tryOut = await window.pf.invoke('slang:preview', SL.tryText);
}
const nfmt = (n) => Number(n).toLocaleString('en');

function slangTryHtml() {
  const o = SL.tryOut;
  if (!o) return '';
  // show the output with the changed words marked: hits carry from/to; mark each `to` once, left to right
  let html = '', rest = o.text;
  for (const h of o.hits) {
    const i = rest.indexOf(h.to);
    if (i < 0) continue;
    html += L.esc(rest.slice(0, i)) + `<mark>${L.esc(h.to)}</mark>`; rest = rest.slice(i + h.to.length);
  }
  return html + L.esc(rest);
}

function termRow(t, mine) {
  const vs = [...(t.variants || []), ...(t.heard || [])];
  const meta = [t.category, t.lang, t.casing && t.casing !== 'smart' ? t.casing : '', t.matchCase ? 'match case' : ''].filter(Boolean).map((m) => `<span class="badge">${L.esc(m)}</span>`).join(' ');
  if (mine && SL.edit === t.term) {
    return `<div class="trow"><input type="text" id="sl-ed-term" value="${L.esc(t.term)}" style="flex:0 0 38%"><input type="text" id="sl-ed-var" value="${L.esc(vs.join(' | '))}" placeholder="heard as, separated by |"><button class="btn primary small" id="sl-ed-save" data-old="${L.esc(t.term)}">Save</button><button class="btn small" id="sl-ed-cancel">Cancel</button></div>`;
  }
  const act = mine ? `<button class="iconbtn" data-sl-edit="${L.esc(t.term)}" title="Edit"><svg viewBox="0 0 16 16"><path d="M3 13h2.5L13 5.5 10.5 3 3 10.5zM9.5 4l2.5 2.5"/></svg></button><button class="iconbtn danger" data-sl-del="${L.esc(t.term)}" title="Remove">${ICON_DEL}</button>` : '';
  return `<div class="trow"><div class="a"><b>${L.esc(t.term)}</b> ${meta}</div><div class="b" style="width:46%;justify-content:flex-start;color:var(--muted);flex-wrap:wrap">${vs.length ? L.esc(vs.slice(0, 6).join(' | ')) + (vs.length > 6 ? ' ...' : '') : '<span class="note">spelling only</span>'}${act}</div></div>`;
}

function slangImportHtml() {
  const m = SL.imp;
  if (!m) return '';
  const pv = m.preview;
  const pvHtml = pv ? `<div class="note" style="margin-top:8px">${pv.stats.accepted ? `<b style="color:var(--ok)">${nfmt(pv.stats.accepted)} terms</b> found` : '<b style="color:var(--bad)">No terms found</b>'}${pv.stats.duplicates ? `, ${pv.stats.duplicates} duplicates ignored` : ''}${pv.stats.skipped ? `, ${pv.stats.skipped} skipped` : ''}.${pv.sample.length ? ' For example: ' + pv.sample.map((t) => L.esc(t.term + (t.variants.length ? ' (' + t.variants.join(' | ') + ')' : ''))).join(', ') : ''}${pv.warnings.length ? '<br>' + L.esc(pv.warnings.slice(0, 3).join(' ')) : ''}</div>` : '';
  const res = m.result ? `<div class="note" style="margin-top:8px;color:${m.result.ok ? 'var(--ok)' : 'var(--bad)'}">${L.esc(m.result.ok ? `Imported ${nfmt(m.result.added)} terms${m.result.merged ? `, ${m.result.merged} updated` : ''}.` : m.result.error || 'Nothing imported.')}</div>` : '';
  return `<div class="card" id="sl-import" style="margin-top:12px"><b>Import terms</b>
    <div class="note" style="margin:4px 0 8px">One term per line, or <code>term,misheard1|misheard2</code> (CSV or tab separated; quote a term that contains a comma). Paste a list or choose a .txt, .csv or .json file. Only spellings are read.</div>
    <textarea id="sl-imp-text" rows="6" placeholder="rizz&#10;no cap,no kap|no cab&#10;&quot;lekker bezig&quot;,lekker bezig">${L.esc(m.text)}</textarea>
    <div class="add3" style="grid-template-columns:1fr auto auto auto"><input type="text" id="sl-imp-name" placeholder="Pack name (for a new pack)" value="${L.esc(m.name)}" maxlength="60">
      ${seg('sl-imp-target', [['new', 'New pack'], ['mine', 'Add to My terms']], m.target)}<button class="btn" id="sl-imp-file">Choose file...</button><button class="btn primary" id="sl-imp-go" ${m.text.trim() ? '' : 'disabled'}>Import</button></div>
    ${pvHtml}${res}<div class="note" style="margin-top:8px"><a id="sl-imp-close" style="cursor:pointer;color:var(--accent)">Close</a></div></div>`;
}

function slangSection() {
  const st = SL.state;
  if (!st) return '<h2>Slang packs</h2><div class="card empty">Loading...</div>';
  const mine = st.packs.find((p) => p.id === 'mine');
  const rows = st.packs.map((p) => `<div class="srow" style="padding:11px 0"><div class="l"><b>${L.esc(p.name)}</b> <span class="badge">${L.esc(p.language)}</span> ${p.builtin ? '<span class="badge">built-in</span>' : ''}
      <div>${nfmt(p.count)} terms, ${nfmt(p.variants)} misheard spellings${p.warnings.length ? ` <span class="badge warn" title="${L.esc(p.warnings.join('\n'))}">${p.warnings.length} notes</span>` : ''}</div></div>
      <div class="c" style="width:auto"><button class="btn small" data-sl-view="${L.esc(p.id)}">${SL.view === p.id ? 'Hide terms' : 'Terms'}</button><button class="btn small" data-sl-export="${L.esc(p.id)}" title="Save this pack as a file">Export</button>${p.builtin ? '' : `<button class="iconbtn danger" data-sl-delpack="${L.esc(p.id)}" title="Delete this pack">${ICON_DEL}</button>`}${toggle('sl-pk-' + p.id, p.enabled && st.enabled, !st.enabled)}</div></div>`).join('');
  const view = SL.view ? (() => {
    const p = st.packs.find((x) => x.id === SL.view); const isMine = SL.view === 'mine';
    return `<div class="card" id="sl-view" style="margin-top:12px;padding:12px 16px"><div style="display:flex;gap:10px;align-items:center;margin-bottom:6px"><b style="flex:none">${L.esc(p.name)}</b><input type="text" id="sl-q" placeholder="Search ${nfmt(SL.terms.total)} terms" value="${L.esc(SL.query)}" autocomplete="off"></div>
      <div class="tbl" style="max-height:300px;overflow:auto">${SL.terms.items.length ? SL.terms.items.map((t) => termRow(t, isMine)).join('') : '<div class="empty">No terms match.</div>'}</div>${SL.terms.total > SL.terms.items.length ? `<div class="note" style="margin-top:6px">Showing the first ${SL.terms.items.length} of ${nfmt(SL.terms.total)}. Search to narrow it down.</div>` : ''}</div>`;
  })() : '';
  const msg = SL.msg ? `<div class="note" style="margin-top:6px;color:${SL.msg.ok ? 'var(--ok)' : 'var(--bad)'}">${L.esc(SL.msg.text)}</div>` : '';
  return `<h2 id="sec-slang">Slang packs</h2>
  <div class="sub" style="margin:-4px 0 12px">Spelling and casing for slang, gamer and streamer words, fixed on finished sentences only. Whole words, longest match first, never inside links, file paths or code. Packs are plain files in <code>%APPDATA%\\parakeet-flow\\dictionary\\packs</code>. Your Replace rows above always win.</div>
  <div class="card" style="padding:4px 18px"><div class="srow"><div class="l"><b>Use slang packs</b><div>${nfmt(st.active)} terms active.</div></div><div class="c" style="width:auto">${toggle('sl-all', st.enabled)}</div></div>
    <div class="srow" style="padding:11px 0"><div class="l"><b>Bias recognition toward these terms <span class="badge warn">experimental</span></b><div>Makes Parakeet more likely to hear your terms in the first place (contextual biasing). Switching it, or the packs, restarts the speech engine for a moment. Spelling fixes work without it.</div></div><div class="c" style="width:auto">${toggle('sl-bias', st.biasing.enabled, !st.enabled)}</div></div>${rows}</div>
  ${view}
  <h2>My terms</h2>
  <div class="add" style="grid-template-columns:1fr 1.3fr auto auto"><input type="text" id="sl-add-term" placeholder="Term, spelled the way you want it" autocomplete="off" maxlength="80"><input type="text" id="sl-add-var" placeholder="Heard as (optional), separate with |" autocomplete="off"><button class="btn primary" id="sl-add-go">Add</button><button class="btn" id="sl-imp-open">Import...</button></div>
  <div class="note">${mine ? `${nfmt(mine.count)} terms of yours.` : 'Nothing of yours yet.'} <a id="sl-mine-view" style="cursor:pointer;color:var(--accent)">${SL.view === 'mine' ? 'Hide' : 'Show and edit'}</a>${mine && mine.count ? ' &middot; <a id="sl-mine-export" style="cursor:pointer;color:var(--accent)">Export as file</a>' : ''}</div>${msg}
  ${slangImportHtml()}
  <h2>Try it</h2><div class="card"><input type="text" id="sl-try" value="${L.esc(SL.tryText)}" autocomplete="off"><div class="note" style="margin:10px 0 4px">After the packs:</div><div id="sl-try-out" class="tryout">${slangTryHtml()}</div></div>`;
}

async function slangAct(channel, ...args) {
  const r = await window.pf.invoke(channel, ...args);
  if (r && r.cancelled) return r;
  if (r && r.ok === false) SL.msg = { ok: false, text: r.error || 'That did not work.' };
  else if (r && r.ok) SL.msg = null;
  await loadSlang();
  if (S.settings) S.settings = await window.pf.invoke('settings:get');
  render();
  return r;
}

function bindSlang() {
  const $$ = (s) => main.querySelector(s);
  const on = (id, fn) => { const el = $$('#' + id); if (el) el.onclick = fn; };
  on('sl-all', () => slangAct('slang:set-enabled', '*', !SL.state.enabled));
  on('sl-bias', () => slangAct('slang:set-biasing', !SL.state.biasing.enabled));
  for (const p of (SL.state ? SL.state.packs : [])) on('sl-pk-' + p.id, () => slangAct('slang:set-enabled', p.id, !p.enabled));
  main.querySelectorAll('[data-sl-view]').forEach((b) => b.onclick = () => { SL.view = SL.view === b.dataset.slView ? null : b.dataset.slView; SL.query = ''; SL.edit = null; slangAct('slang:state'); });
  main.querySelectorAll('[data-sl-export]').forEach((b) => b.onclick = async () => { const r = await window.pf.invoke('slang:export', b.dataset.slExport, 'json'); if (r && !r.cancelled) { SL.msg = { ok: !!r.ok, text: r.ok ? 'Saved ' + r.path : r.error }; render(); } });
  main.querySelectorAll('[data-sl-delpack]').forEach((b) => b.onclick = () => { if (window.confirm('Delete this pack file? Your other packs are not touched.')) slangAct('slang:delete-pack', b.dataset.slDelpack); });
  main.querySelectorAll('[data-sl-edit]').forEach((b) => b.onclick = () => { SL.edit = b.dataset.slEdit; render(); });
  main.querySelectorAll('[data-sl-del]').forEach((b) => b.onclick = () => slangAct('slang:remove', b.dataset.slDel));
  on('sl-ed-cancel', () => { SL.edit = null; render(); });
  on('sl-ed-save', () => { const old = $$('#sl-ed-save').dataset.old; SL.edit = null; slangAct('slang:update', old, { term: $$('#sl-ed-term').value, variants: $$('#sl-ed-var').value.split('|') }); });
  on('sl-add-go', async () => {
    const term = $$('#sl-add-term').value.trim(); if (!term) return;
    const r = await slangAct('slang:add', { term, variants: $$('#sl-add-var').value.split('|') });
    if (r && r.ok) { SL.msg = { ok: true, text: r.merged ? `Updated "${r.term}".` : `Added "${r.term}".` }; render(); }
  });
  for (const id of ['sl-add-term', 'sl-add-var']) { const el = $$('#' + id); if (el) el.onkeydown = (e) => { if (e.key === 'Enter') $$('#sl-add-go').click(); }; }
  on('sl-mine-view', () => { SL.view = SL.view === 'mine' ? null : 'mine'; SL.query = ''; SL.edit = null; slangAct('slang:state'); });
  on('sl-mine-export', async () => { const r = await window.pf.invoke('slang:export', 'mine', 'json'); if (r && !r.cancelled) { SL.msg = { ok: !!r.ok, text: r.ok ? 'Saved ' + r.path : r.error }; render(); } });
  const q = $$('#sl-q'); if (q) q.oninput = async () => { SL.query = q.value; SL.terms = await window.pf.invoke('slang:terms', SL.view, { query: SL.query, limit: 120 }); const keep = q.selectionStart; render(); const q2 = $$('#sl-q'); if (q2) { q2.focus(); q2.setSelectionRange(keep, keep); } };
  const tr = $$('#sl-try'); if (tr) tr.oninput = async () => { SL.tryText = tr.value; SL.tryOut = await window.pf.invoke('slang:preview', SL.tryText); const out = $$('#sl-try-out'); if (out) out.innerHTML = slangTryHtml(); };
  // import dialog
  on('sl-imp-open', () => { SL.imp = SL.imp || { text: '', name: '', target: 'new', preview: null, result: null }; render(); const t = $$('#sl-imp-text'); if (t) t.focus(); });
  on('sl-imp-close', () => { SL.imp = null; render(); });
  const t = $$('#sl-imp-text');
  if (t) t.oninput = async () => {
    SL.imp.text = t.value; SL.imp.result = null;
    const go = $$('#sl-imp-go'); if (go) go.disabled = !t.value.trim();
    SL.imp.preview = t.value.trim() ? await window.pf.invoke('slang:parse-preview', t.value) : null;
    const pv = $$('#sl-import'); const keepScroll = main.scrollTop; const pos = t.selectionStart; render(); main.scrollTop = keepScroll; const t2 = $$('#sl-imp-text'); if (t2) { t2.focus(); t2.setSelectionRange(pos, pos); }
  };
  const nm = $$('#sl-imp-name'); if (nm) nm.oninput = () => { SL.imp.name = nm.value; };
  const tg = $$('#sl-imp-target'); if (tg) tg.querySelectorAll('button').forEach((b) => b.onclick = () => { SL.imp.target = b.dataset.v; render(); });
  on('sl-imp-go', async () => {
    const r = await window.pf.invoke('slang:import-text', SL.imp.text, { name: SL.imp.name, target: SL.imp.target });
    SL.imp.result = r; await loadSlang(); if (r.ok) { SL.imp.text = ''; SL.imp.preview = null; } render();
  });
  on('sl-imp-file', async () => {
    const r = await window.pf.invoke('slang:import-file', { name: SL.imp.name, target: SL.imp.target });
    if (r.cancelled) return;
    SL.imp.result = r; await loadSlang(); render();
  });
}
