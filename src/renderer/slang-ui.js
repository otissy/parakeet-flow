// Slang packs section of the Dictionary page. Plain functions over the shared state `S` and helpers of app.js (loaded after this file).
// State lives in SL; every action goes through window.pf.invoke('slang:*') and then reloads the pack list.
const SL = { state: null, view: null, terms: { total: 0, items: [] }, query: '', edit: null, msg: null, imp: null, tryText: 'no kap that was bussin, he got the goaded ceiling shot and a flip reset. gg', tryOut: null, biasMsg: null };
const BI = window.PFBias;

/* ---------- "Add a word": one form, used on the Dictionary page (prefix sl-add) and in the quick-add popover (prefix qa) ---------- */
const blankForm = () => ({ term: '', heard: '', pack: 'mine', bias: '', origin: '', msg: null, undo: null, busy: false });
SL.forms = { 'sl-add': blankForm(), qa: blankForm() };

function editablePacks() {
  const ps = (SL.state ? SL.state.packs : []).filter((p) => p.editable);
  return ps.some((p) => p.id === 'mine') ? ps : [{ id: 'mine', name: 'My terms' }, ...ps];
}
function globalBias() { return SL.state ? SL.state.biasing.percent : BI.DEFAULT_PCT; }
function addHint(px) {
  const f = SL.forms[px], t = f.term.trim();
  const keep = f.origin && t && t.toLowerCase() !== f.origin.toLowerCase() ? `"${f.origin}" is kept as "heard as", so it gets fixed too. ` : '';
  const on = SL.state && SL.state.biasing.enabled;
  return keep + `Bias empty = the global ${globalBias()}%${on ? '' : ' (biasing is off, so bias does nothing yet)'}. Same word in any case = updated, not added twice.`;
}
function addWordForm(px) {
  const f = SL.forms[px];
  if (!editablePacks().some((p) => p.id === f.pack)) f.pack = 'mine';
  const opts = editablePacks().map((p) => `<option value="${L.esc(p.id)}" ${p.id === f.pack ? 'selected' : ''}>${L.esc(p.name)}</option>`).join('');
  const msg = f.msg ? `${L.esc(f.msg.text)}${f.undo ? ` <button class="linkbtn" id="${px}-undo">Undo</button>` : ''}` : '';
  return `<div class="addword" id="${px}-form">
    <div class="aw-grid">
      <label class="aw-f"><span>Word</span><input type="text" id="${px}-term" value="${L.esc(f.term)}" placeholder="Spelled the way you want it" autocomplete="off" spellcheck="false"></label>
      <label class="aw-f"><span>Heard as <i>optional</i></span><input type="text" id="${px}-var" value="${L.esc(f.heard)}" placeholder="What it comes out as now, separate with |" autocomplete="off" spellcheck="false"></label>
      <label class="aw-f"><span>Pack</span><select id="${px}-pack">${opts}</select></label>
      <label class="aw-f aw-bias"><span>Bias <i>optional</i></span><span class="pct"><input type="text" inputmode="numeric" id="${px}-bias" value="${L.esc(f.bias)}" placeholder="${globalBias()}" maxlength="5" autocomplete="off" aria-label="Bias for this word, in percent"><b>%</b></span></label>
      <button class="btn primary" id="${px}-go" ${f.busy ? 'disabled' : ''}>Add</button>
    </div>
    <div class="awhint" id="${px}-hint">${L.esc(addHint(px))}</div>
    <div class="awmsg ${f.msg ? (f.msg.ok ? 'ok' : 'bad') : ''}" id="${px}-msg" role="status">${msg}</div></div>`;
}
function readForm(px) {
  const f = SL.forms[px], v = (id) => { const el = document.getElementById(px + '-' + id); return el ? el.value : null; };
  for (const [k, id] of [['term', 'term'], ['heard', 'var'], ['pack', 'pack'], ['bias', 'bias']]) { const x = v(id); if (x !== null) f[k] = x; }
  return f;
}
async function submitAdd(px, after) {
  const f = readForm(px);
  if (f.busy) return;
  const term = f.term.trim();
  if (!term) { f.msg = { ok: false, text: 'Type a word first.' }; f.undo = null; after(); return; }
  const variants = f.heard.split('|').map((x) => x.trim()).filter(Boolean);
  if (f.origin && f.origin.toLowerCase() !== term.toLowerCase() && !variants.some((x) => x.toLowerCase() === f.origin.toLowerCase())) variants.push(f.origin);
  f.busy = true;
  let r;
  try { r = await window.pf.invoke('slang:add', { term, variants, bias: f.bias.trim() }, { packId: f.pack }); } catch (e) { r = { ok: false, error: 'That did not work.' }; }
  f.busy = false;
  if (r && r.ok) {
    Object.assign(f, { term: '', heard: '', bias: '', origin: '', undo: r.undo });
    const also = r.alsoIn && r.alsoIn.length ? ` Also in ${r.alsoIn.join(', ')}.` : '';
    f.msg = { ok: true, text: `${r.merged ? 'Updated' : 'Added'} "${r.term}" ${r.merged ? 'in' : 'to'} ${r.packName}.${also}` };
  } else { f.msg = { ok: false, text: (r && r.error) || 'That did not work.' }; f.undo = null; }
  await loadSlang();
  after();
}
async function undoAdd(px, after) {
  const f = SL.forms[px];
  const r = await window.pf.invoke('slang:undo-add', f.undo);
  f.undo = null;
  f.msg = r && r.ok ? { ok: true, text: r.term ? `Undone: "${r.term}" is back as it was.` : 'Undone.' } : { ok: false, text: (r && r.error) || 'Nothing to undo.' };
  await loadSlang();
  after();
}
/** wire one form; after() re-renders whatever holds it and must leave the word field focused */
function bindAddForm(px, after, onEsc) {
  const el = (id) => document.getElementById(px + '-' + id);
  if (!el('term')) return;
  const f = SL.forms[px];
  const sync = () => { readForm(px); const h = el('hint'); if (h) h.textContent = addHint(px); };
  for (const id of ['term', 'var', 'bias']) {
    el(id).oninput = sync;
    el(id).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submitAdd(px, after); } else if (e.key === 'Escape' && onEsc) { e.preventDefault(); onEsc(); } };
  }
  el('pack').onchange = sync;
  el('pack').onkeydown = (e) => { if (e.key === 'Escape' && onEsc) { e.preventDefault(); onEsc(); } };
  el('go').onclick = () => submitAdd(px, after);
  const u = el('undo'); if (u) u.onclick = () => undoAdd(px, after);
  void f;
}

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
  const meta = [t.category, t.lang, t.casing && t.casing !== 'smart' ? t.casing : '', t.matchCase ? 'match case' : '', t.bias != null ? `bias ${t.bias}%` : ''].filter(Boolean).map((m) => `<span class="badge">${L.esc(m)}</span>`).join(' ');
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
  const restarting = st.biasing.enabled && S.info && S.info.engine === 'loading';
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
    <div class="srow" style="padding:11px 0"><div class="l"><b>Bias recognition toward these terms <span class="badge warn">experimental</span></b><div>Makes Parakeet more likely to hear your terms in the first place (contextual biasing). Switching it, or the packs, restarts the speech engine for a moment. Spelling fixes work without it.</div></div><div class="c" style="width:auto">${toggle('sl-bias', st.biasing.enabled, !st.enabled)}</div></div>
    <div class="srow biasrow" style="padding:11px 0"><div class="l"><b>Bias strength</b><div>How hard recognition leans toward your terms. 33% to 67% worked best in tests; near 100% it starts hearing terms that were not said. A word can have its own bias.${restarting ? ' <span class="badge warn" id="sl-restarting">Restarting the speech engine</span>' : ''}</div>${SL.biasMsg ? `<div id="sl-bias-msg" class="${SL.biasMsg.ok ? 'okc' : 'badc'}">${L.esc(SL.biasMsg.text)}</div>` : ''}</div>
      <div class="c" style="width:auto"><input type="range" id="sl-bias-range" min="${BI.MIN_PCT}" max="${BI.MAX_PCT}" step="1" value="${st.biasing.percent}" aria-label="Bias strength" ${st.enabled ? '' : 'disabled'}><span class="pct"><input type="text" inputmode="numeric" id="sl-bias-pct" value="${st.biasing.percent}" maxlength="5" aria-label="Bias strength in percent" ${st.enabled ? '' : 'disabled'}><b>%</b></span></div></div>${rows}</div>
  ${view}
  <h2 id="sec-addword">Add a word</h2>
  <div class="card awcard">${addWordForm('sl-add')}<div class="awfoot"><button class="btn" id="sl-imp-open">Import a list...</button></div></div>
  <div class="note" style="margin-top:8px">${mine ? `${nfmt(mine.count)} terms of yours.` : 'Nothing of yours yet.'} <a id="sl-mine-view" style="cursor:pointer;color:var(--accent)">${SL.view === 'mine' ? 'Hide' : 'Show and edit'}</a>${mine && mine.count ? ' &middot; <a id="sl-mine-export" style="cursor:pointer;color:var(--accent)">Export as file</a>' : ''}</div>${msg}
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
  bindAddForm('sl-add', () => { render(); const t = $$('#sl-add-term'); if (t) t.focus(); });
  // global bias: the number box and the slider set the same percent; committed on Enter / leaving the box / releasing the slider
  const setBias = async (v) => {
    const r = await window.pf.invoke('slang:set-bias', v);
    SL.biasMsg = r && r.ok ? (r.unchanged ? null : { ok: true, text: `Bias set to ${r.percent}%.${SL.state.biasing.enabled ? ' The speech engine restarts in a moment.' : ''}` }) : { ok: false, text: (r && r.error) || 'That did not work.' };
    await loadSlang(); render();
  };
  const bp = $$('#sl-bias-pct');
  if (bp) {
    bp.onchange = () => setBias(bp.value);
    bp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); bp.onchange = null; setBias(bp.value).then(() => { const b = $$('#sl-bias-pct'); if (b) b.focus(); }); } };
  }
  const br = $$('#sl-bias-range');
  if (br) {
    br.oninput = () => { const b = $$('#sl-bias-pct'); if (b) b.value = br.value; };
    br.onchange = () => setBias(Number(br.value)).then(() => { const r = $$('#sl-bias-range'); if (r) r.focus(); });
  }
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

/* ---------- quick add from text: transcript history (Home) and meeting transcripts ----------
   Select text inside an element marked data-qa-src and an "Add to dictionary" button appears at the selection; or use the
   row's own button (keyboard: Tab to it, Enter), which offers the line's words as buttons. Both open the same small form
   (the Add a word form, prefix qa) prefilled. Nothing here is logged. */
SL.qa = null;            // open popover: { words, rect, opener }
function qaNodes() {
  let btn = document.getElementById('qa-btn'), pop = document.getElementById('qa-pop');
  if (!btn) {
    btn = document.createElement('button'); btn.id = 'qa-btn'; btn.className = 'qa-btn'; btn.type = 'button'; btn.hidden = true;
    btn.textContent = 'Add to dictionary';
    btn.onmousedown = (e) => e.preventDefault();       // keep the selection
    btn.onclick = () => { const p = qaPick(); if (p) openQuickAdd({ text: p.text, rect: p.rect, opener: null }); };
    document.body.appendChild(btn);
  }
  if (!pop) { pop = document.createElement('div'); pop.id = 'qa-pop'; pop.className = 'qa-pop card'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Add to dictionary'); document.body.appendChild(pop); }
  return { btn, pop };
}
/** the current selection, if it lies inside ONE data-qa-src element: {text, rect} */
function qaPick() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
  const home = (n) => (n && (n.nodeType === 1 ? n : n.parentElement) || null)?.closest('[data-qa-src]');
  const a = home(sel.anchorNode), b = home(sel.focusNode);
  if (!a || a !== b) return null;
  const text = L.cleanPick(sel.toString());
  if (!text) return null;
  return { text, rect: sel.getRangeAt(0).getBoundingClientRect() };
}
function qaSelectionChanged() {
  const { btn } = qaNodes();
  const p = SL.qa ? null : qaPick();
  if (!p) { btn.hidden = true; return; }
  btn.hidden = false;
  const w = btn.offsetWidth || 140;
  btn.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, p.rect.left + p.rect.width / 2 - w / 2)) + 'px';
  btn.style.top = (p.rect.bottom + 6 + 32 > window.innerHeight ? Math.max(8, p.rect.top - 38) : p.rect.bottom + 6) + 'px';
}
function openQuickAdd({ text = '', words = [], rect, opener = null }) {
  const f = SL.forms.qa;
  Object.assign(f, blankForm(), { pack: f.pack, term: text, origin: text });
  SL.qa = { words, rect, opener };
  qaNodes().btn.hidden = true;
  renderQa();
}
function closeQa() {
  if (!SL.qa) return;
  const opener = SL.qa.opener; SL.qa = null;
  const { pop } = qaNodes(); pop.hidden = true; pop.innerHTML = '';
  if (opener && document.body.contains(opener)) opener.focus();
}
function renderQa() {
  const { pop } = qaNodes();
  if (!SL.qa) { pop.hidden = true; return; }
  const words = SL.qa.words.length ? `<div class="qa-words" role="group" aria-label="Words in this line">${SL.qa.words.map((w) => `<button type="button" class="chipbtn" data-qa-word="${L.esc(w)}">${L.esc(w)}</button>`).join('')}</div>` : '';
  pop.innerHTML = `<div class="qa-head"><b>Add to dictionary</b><button type="button" class="iconbtn" id="qa-close" title="Close" aria-label="Close"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>${words}${addWordForm('qa')}`;
  pop.hidden = false;
  const r = SL.qa.rect || { left: 40, top: 40, bottom: 40 };
  const w = Math.min(640, window.innerWidth - 16);
  pop.style.width = w + 'px';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
  const h = pop.offsetHeight;
  pop.style.top = (r.bottom + 8 + h <= window.innerHeight - 8 ? r.bottom + 8 : Math.max(8, r.top - h - 8)) + 'px';
  const focusTerm = () => { const t = document.getElementById('qa-term'); if (t) t.focus(); };
  bindAddForm('qa', () => { renderQa(); focusTerm(); }, closeQa);
  document.getElementById('qa-close').onclick = closeQa;
  pop.querySelectorAll('[data-qa-word]').forEach((b) => b.onclick = () => { readForm('qa'); Object.assign(SL.forms.qa, { term: b.dataset.qaWord, origin: b.dataset.qaWord, msg: null, undo: null }); renderQa(); focusTerm(); });
  pop.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeQa(); } };
  focusTerm();
}
/** row buttons ([data-qa-row]) in whatever page was just rendered; called from app.js render() */
function bindQuickAdd(page) {
  if (SL.qa && page !== 'home' && page !== 'meetings') closeQa();
  qaNodes().btn.hidden = true;
  document.querySelectorAll('[data-qa-row]').forEach((b) => b.onclick = () => {
    const src = b.closest('[data-qa-line]')?.querySelector('[data-qa-src]');
    const sel = qaPick();
    const inRow = sel && src && src.contains(window.getSelection().anchorNode) ? sel.text : '';
    openQuickAdd({ text: inRow, words: L.wordsOf(src ? src.textContent : ''), rect: b.getBoundingClientRect(), opener: b });
  });
}
document.addEventListener('selectionchange', () => qaSelectionChanged());
document.addEventListener('mousedown', (e) => { if (SL.qa && !e.target.closest('#qa-pop') && !e.target.closest('[data-qa-row]')) closeQa(); });
window.addEventListener('resize', () => { if (SL.qa) { readForm('qa'); renderQa(); } else qaSelectionChanged(); });
document.getElementById('main').addEventListener('scroll', () => { if (!SL.qa) qaSelectionChanged(); });
