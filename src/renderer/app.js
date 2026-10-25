// Main window. One small page-per-nav renderer; state comes from the main process over IPC.
const L = window.PFLib;
const $ = (s, r = document) => r.querySelector(s);
const main = $('#main');
let meetingStatusTimer = null;
const S = { page: 'home', settings: null, stats: { words: 0, wpm: 0, streak: 0 }, history: [], info: null, devices: [], dl: null, capturing: null, hkError: '', meetings: [], meetingStatus: null, meetingProgress: null, recordingId: null, processingId: null, selectedMeetingId: null, meetingsError: '', meetingStatusError: '', meetingsBusy: false, meetingsActionError: '', meetingsLoading: false };

const ICON_COPY = '<svg viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 5.5V4a1.5 1.5 0 00-1.5-1.5H4A1.5 1.5 0 002.5 4v5A1.5 1.5 0 004 10.5h1.5"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 16 16"><path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8"/></svg>';
const ICON_ADDWORD = '<svg viewBox="0 0 16 16"><path d="M3 3.5h6.5a1.5 1.5 0 011.5 1.5v3M3 3.5V12a1.5 1.5 0 001.5 1.5H8M12.5 10v4.5M10.25 12.25h4.5"/></svg>';

async function save(patch) { S.settings = await window.pf.invoke('settings:set', patch); render(); }

function toggle(id, on, disabled) { return `<button class="sw ${on ? 'on' : ''}" id="${id}" role="switch" aria-checked="${on}" ${disabled ? 'disabled' : ''}></button>`; }
function seg(id, opts, val) { return `<div class="seg" id="${id}">${opts.map(([v, t]) => `<button data-v="${v}" class="${v === val ? 'on' : ''}">${t}</button>`).join('')}</div>`; }
function keys(vks) { return vks.map((v) => `<kbd>${L.esc(L.vkLabel(v))}</kbd>`).join('<span class="note"> + </span>'); }

/* ---------- pages ---------- */
function home() {
  const s = S.settings, st = S.stats;
  const hint = `Hold ${s.hotkey.label} to dictate${s.toggleOn ? `, or press ${s.toggleKey.label} to start and stop` : ''}`;
  let hist;
  if (!s.historyEnabled) hist = `<div class="card empty">History is off, so nothing you dictate is kept.<br><br><button class="btn" id="hist-on">Turn on history</button></div>`;
  else if (!S.history.length) hist = `<div class="card empty">Nothing here yet. Dictate something and it shows up here.</div>`;
  else hist = L.groupByDay(S.history).map((g) => `<div class="day">${L.esc(g.label)}</div><div class="card" style="padding:4px 14px">${g.items.map((e) =>
    `<div class="row" data-qa-line><div class="time">${L.fmtTime(e.ts)}</div><div class="tx" data-qa-src>${L.esc(e.text)}</div><button class="iconbtn" data-qa-row title="Add a word from this line to the dictionary" aria-label="Add a word from this line to the dictionary">${ICON_ADDWORD}</button><button class="iconbtn" data-copy="${L.esc(e.id)}" title="Copy">${ICON_COPY}</button></div>`).join('')}</div>`).join('');
  return `<div class="wrap">
    <h1>${L.esc(L.greeting(new Date().getHours(), s.userName))}</h1>
    <div class="sub">Everything runs on this computer. Nothing is sent anywhere.</div>
    <div class="card hint"><div><div class="t">${L.esc(hint)}</div><div class="s">${s.typing && s.typing.live ? 'Words are typed as you speak. ' : 'Your words show in the bar while you talk and the finished text goes in once when you let go. '}Press Esc to cancel.</div></div></div>
    <div class="stats">
      <div class="card stat"><div class="n">${st.words.toLocaleString('en')}</div><div class="l">Words dictated</div></div>
      <div class="card stat"><div class="n">${st.wpm || '–'}<span class="u">${st.wpm ? 'wpm' : ''}</span></div><div class="l">Average speed</div></div>
      <div class="card stat"><div class="n">${st.streak}<span class="u">${st.streak === 1 ? 'day' : 'days'}</span></div><div class="l">Streak</div></div>
    </div>
    <h2>Transcripts</h2>${hist}</div>`;
}

function pairsPage({ title, blurb, listKey, a, b, phA, phB, multi }) {
  const list = S.settings[listKey];
  return `<div class="wrap"><h1>${title}</h1><div class="sub">${blurb}</div>
    <div class="add"><input type="text" id="add-a" placeholder="${phA}" autocomplete="off"><span class="arrow">→</span>${multi ? `<textarea id="add-b" rows="1" placeholder="${phB}"></textarea>` : `<input type="text" id="add-b" placeholder="${phB}" autocomplete="off">`}<button class="btn primary" id="add-go">Add</button></div>
    <div class="card pairs" style="padding:4px 14px">${list.length ? list.map((p, i) => `<div class="row"><div class="a">${L.esc(p[a])}</div><div class="b">${L.esc(p[b])}</div><button class="iconbtn danger" data-del="${i}" title="Remove">${ICON_DEL}</button></div>`).join('') : '<div class="empty">Nothing yet.</div>'}</div></div>`;
}

function style() {
  const c = S.settings.style.casual;
  return `<div class="wrap"><h1>Style</h1><div class="sub">How finished text is punctuated. Applied when you stop talking, never to the live preview.</div>
    <div class="styles">
      <div class="card sty ${!c ? 'on' : ''}" data-style="formal"><h3>Formal</h3><p>Capital letters and a full stop, as the model writes it.</p><div class="ex">Let's meet tomorrow at ten.</div></div>
      <div class="card sty ${c ? 'on' : ''}" data-style="casual"><h3>Casual</h3><p>No full stop at the end, lower-case start for a chatty feel.</p><div class="ex">let's meet tomorrow at ten</div></div>
    </div>
    <div class="note" style="margin-top:14px">Fillers (um, uh, erm, hmm) and your dictionary are handled in Settings and Dictionary.</div></div>`;
}

function settingsPage() {
  const s = S.settings, i = S.info || {};
  const devs = [['', 'System default'], ...S.devices.map((d, n) => [d.deviceId, d.label || 'Microphone ' + (n + 1)])];
  const gpuOk = !!i.gpuAvailable;
  return `<div class="wrap"><h1>Settings</h1><div class="sub">Hold-to-talk, microphone, speech engine and privacy.</div>
  <h2>Dictation</h2><div class="card" style="padding:4px 18px">
    <div class="srow"><div class="l"><b>Hold to talk</b><div>${S.capturing && S.capTarget === 'hold' ? 'Press the key or combination, then let go. Esc cancels.' : 'Default Ctrl+Space. Press and hold to talk, release to stop. While it is used for dictation the chord is swallowed; Ctrl or Space alone still work. Avoid keys OBS or your games use.'}</div>${S.hkError && S.capTarget === 'hold' ? `<div style="color:var(--bad)">${L.esc(S.hkError)}</div>` : ''}</div>
      <div class="c">${S.capturing && S.capTarget === 'hold' ? `<span class="chip" id="cap">${S.capturing.length ? keys(S.capturing) : 'Listening…'}</span>` : keys(s.hotkey.vks)}<button class="btn" id="hk-change">${S.capturing && S.capTarget === 'hold' ? 'Cancel' : 'Change'}</button>${S.capturing && S.capTarget === 'hold' ? '' : '<button class="btn" id="hk-reset">Reset</button>'}</div></div>
    <div class="srow"><div class="l"><b>Use CapsLock as the dictation toggle</b><div>One press starts dictation hands-free, the next press stops it. While this is on, CapsLock no longer switches capital letters (its state and light are left untouched); turn it off, pause dictation in the tray or quit the app and CapsLock works normally again.</div></div><div class="c">${toggle('tk-on', s.toggleOn)}</div></div>
    <div class="srow"><div class="l"><b>Toggle key</b><div>${S.capturing && S.capTarget === 'toggle' ? 'Press one key. Esc cancels. (While picking, CapsLock still acts as normal CapsLock; Reset sets it without pressing it.)' : 'Default CapsLock. Only CapsLock is swallowed; another key you pick is still typed as usual. If you also hold the hold key during a toggle session, hold wins and releasing it does not stop the session.'}</div>${S.hkError && S.capTarget === 'toggle' ? `<div style="color:var(--bad)">${L.esc(S.hkError)}</div>` : ''}</div>
      <div class="c">${S.capturing && S.capTarget === 'toggle' ? `<span class="chip" id="cap">${S.capturing.length ? keys(S.capturing) : 'Listening…'}</span>` : keys(s.toggleKey.vks)}<button class="btn" id="tk-change">${S.capturing && S.capTarget === 'toggle' ? 'Cancel' : 'Change'}</button>${S.capturing && S.capTarget === 'toggle' ? '' : '<button class="btn" id="tk-reset">Reset</button>'}</div></div>
    <div class="srow"><div class="l"><b>Live typing</b><div>Aggressive types every partial and corrects in place. Stable types only words that held for two passes.</div></div><div class="c">${seg('live', [['aggressive', 'Aggressive'], ['stable', 'Stable']], s.liveMode)}</div></div>
    <div class="srow"><div class="l"><b>Language</b><div>Parakeet v3 detects the language itself: English, Dutch and 23 more.</div></div><div class="c"><select disabled><option>Auto-detect</option></select></div></div>
    <div class="srow"><div class="l"><b>Trailing space</b><div>Add a space after the last word.</div></div><div class="c">${toggle('trail', s.trailingSpace)}</div></div>
  </div>
  <h2>Microphone</h2><div class="card" style="padding:4px 18px">
    <div class="srow"><div class="l"><b>Input device</b><div>Audio is processed in memory and never saved.</div></div><div class="c"><select id="mic">${devs.map(([v, t]) => `<option value="${L.esc(v)}" ${v === s.micId ? 'selected' : ''}>${L.esc(t)}</option>`).join('')}</select><button class="btn" id="mic-refresh" title="Ask Windows for device names">Refresh</button></div></div>
    <div class="srow"><div class="l"><b>Keep microphone open</b><div>Instant start, but Windows shows the mic as in use. Off: it opens when you press the key.</div></div><div class="c">${toggle('warm', s.keepMicOpen)}</div></div>
  </div>
  <h2>Speech engine</h2><div class="card" style="padding:4px 18px">
    <div class="srow"><div class="l"><b>Model</b><div>${i.modelsOk ? 'Parakeet TDT 0.6B v3 (int8), checked against its SHA-256.' : 'Parakeet TDT 0.6B v3 (int8), about 670 MB, downloaded once.'}</div>${S.dl ? `<div class="progress"><i style="width:${S.dl.pct}%"></i></div>` : ''}</div>
      <div class="c">${i.modelsOk ? '<span class="chip">Ready</span>' : `<button class="btn primary" id="dl" ${S.dl ? 'disabled' : ''}>${S.dl ? S.dl.pct + '%' : 'Download'}</button>`}</div></div>
    <div class="srow"><div class="l"><b>Run on</b><div>${gpuOk ? 'GPU shares memory with games and OBS.' : 'This build has no GPU support yet, so GPU falls back to CPU.'}</div></div><div class="c">${seg('prov', [['cpu', 'CPU'], ['cuda', 'GPU']], s.provider)}</div></div>
    <div class="srow"><div class="l"><b>CPU threads</b><div>Two is plenty and keeps streams smooth.</div></div><div class="c"><select id="threads">${[1, 2, 3, 4, 6, 8].map((n) => `<option ${n === s.threads ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
  </div>
  <h2>Text</h2><div class="card" style="padding:4px 18px">
    <div class="srow col"><div class="l"><b>Filler words to remove</b><div>Comma separated. Removed from finished text only.</div></div><div class="c"><input type="text" id="fillers" value="${L.esc(s.fillers.join(', '))}"></div></div>
    <div class="srow col"><div class="l"><b>Never type into</b><div>Comma separated. Matches process or window title. Your own windows are always excluded.</div></div><div class="c"><input type="text" id="deny" value="${L.esc(s.deny.join(', '))}"></div></div>
  </div>
  ${extraSettings()}
  <h2>Privacy</h2><div class="card" style="padding:4px 18px">
    <div class="srow"><div class="l"><b>Keep transcript history</b><div>Off by default. Stored only on this computer.</div></div><div class="c">${s.historyEnabled ? '<button class="btn danger" id="hist-clear">Clear</button>' : ''}${toggle('hist', s.historyEnabled)}</div></div>
    <div class="srow"><div class="l"><b>Start with Windows</b><div>Off. Turning it on adds a login item for this app.</div></div><div class="c">${toggle('login', s.launchAtLogin)}</div></div>
    <div class="srow"><div class="l"><b>Your name</b><div>Used in the greeting on Home.</div></div><div class="c"><input type="text" id="uname" value="${L.esc(s.userName)}" maxlength="40"></div></div>
  </div>
  <div class="note" style="margin-top:16px">Logs hold timings and counts only, never what you said.</div></div>`;
}

/* ---------- meetings ---------- */
function errorText(err) { return String(err && err.message ? err.message : err || 'Unknown error'); }
function meetingById(id) { return S.meetings.find((m) => m.id === id) || null; }
function formatMeetingDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'Date unavailable' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function formatOffset(value) {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
function actionItemsValue(value) {
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : item && (item.text || item.title) || '').filter(Boolean).join('\n');
  return typeof value === 'string' ? value : '';
}
function actionItemsPatch(original, value) {
  const lines = value.split(/\r?\n/).map((line) => line.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean);
  return Array.isArray(original) || original == null ? lines : lines.join('\n');
}
async function loadMeetings() {
  try {
    const meetings = await window.pf.invoke('meetings:list');
    S.meetings = Array.isArray(meetings) ? meetings : [];
    S.meetingsError = '';
    if (!meetingById(S.selectedMeetingId)) S.selectedMeetingId = S.meetings[0] ? S.meetings[0].id : null;
  } catch (err) {
    S.meetingsError = errorText(err);
  }
}
function syncMeetingStatusPolling() {
  const downloading = S.page === 'meetings' && S.meetingStatus && S.meetingStatus.downloading;
  if (downloading && !meetingStatusTimer) {
    meetingStatusTimer = setInterval(async () => {
      await loadMeetingStatus();
      if (S.page === 'meetings') render();
      syncMeetingStatusPolling();
    }, 1000);
  } else if (!downloading && meetingStatusTimer) {
    clearInterval(meetingStatusTimer);
    meetingStatusTimer = null;
  }
}
async function loadMeetingStatus() {
  try {
    S.meetingStatus = await window.pf.invoke('meetings:status');
    S.meetingStatusError = '';
  } catch (err) {
    S.meetingStatusError = errorText(err);
  }
  syncMeetingStatusPolling();
}
async function loadMeetingsPage() {
  S.meetingsLoading = true;
  render();
  await Promise.all([loadMeetings(), loadMeetingStatus()]);
  S.meetingsLoading = false;
  if (S.page === 'meetings') render();
}
function meetingStatusCard() {
  const st = S.meetingStatus || {};
  if (st.downloading) {
    const pct = Math.max(0, Math.min(100, Number(st.progress) || 0));
    return `<div class="card meeting-setup"><div class="meeting-setup-top"><div><b>Preparing local meeting processing</b><div class="note">${L.esc(st.error || 'Downloading and setting up on this computer.')}</div></div><span class="badge warn">${Math.round(pct)}%</span></div><div class="progress"><i style="width:${pct}%"></i></div></div>`;
  }
  if (st.ready) return `<div class="card meeting-setup ready"><span class="badge ok">Local processing ready</span><span class="note">Audio and transcripts stay on this computer.</span></div>`;
  const issue = S.meetingStatusError || st.error;
  return `<div class="card meeting-setup"><div class="meeting-setup-top"><div><b>${issue ? 'Meeting setup needs attention' : 'Set up local meeting processing'}</b><div class="note">${L.esc(issue || 'Download the local processing components before recording your first meeting.')}</div></div><button class="btn primary" id="meeting-setup" ${S.meetingsBusy ? 'disabled' : ''}>${S.meetingsBusy ? 'Working…' : 'Set up'}</button></div></div>`;
}
function meetingsPage() {
  const selected = meetingById(S.selectedMeetingId);
  const processing = S.processingId && S.processingId === (selected && selected.id);
  const rows = S.meetings.map((m) => {
    const recording = S.recordingId === m.id;
    const busy = S.processingId === m.id || m.status === 'processing';
    const status = recording ? 'Recording' : busy ? 'Processing' : (m.status || 'Saved');
    return `<div class="meeting-list-row ${m.id === S.selectedMeetingId ? 'on' : ''}">
      <button class="meeting-open" data-meeting-open="${L.esc(m.id)}"><span class="meeting-list-title">${L.esc(m.title || 'Untitled meeting')}</span><span class="meeting-list-meta">${L.esc(formatMeetingDate(m.createdAt))}<span class="badge ${recording ? 'bad' : busy ? 'warn' : ''}">${L.esc(status)}</span></span></button>
      <button class="iconbtn danger meeting-delete" data-meeting-delete="${L.esc(m.id)}" title="Delete meeting" aria-label="Delete ${L.esc(m.title || 'meeting')}">${ICON_DEL}</button>
    </div>`;
  }).join('');
  let details = '<div class="card empty meeting-empty">Choose a meeting to view its transcript, or start a new recording.</div>';
  if (selected) {
    const progress = S.meetingProgress && S.meetingProgress.meetingId === selected.id ? S.meetingProgress : null;
    const pct = Math.max(0, Math.min(100, Number(progress && progress.percent) || 0));
    const lines = Array.isArray(selected.segments) ? selected.segments : [];
    const transcript = lines.length ? lines.map((segment) => `<div class="transcript-entry" data-qa-line><div class="transcript-meta"><span class="speaker">${L.esc(segment.speaker || 'Speaker')}</span><span>${L.esc(formatOffset(segment.start))}</span></div><div class="transcript-text" data-qa-src>${L.esc(segment.text || '')}</div><button class="iconbtn transcript-add" data-qa-row title="Add a word from this line to the dictionary" aria-label="Add a word from this line to the dictionary">${ICON_ADDWORD}</button></div>`).join('') : `<div class="empty">${processing ? 'Transcript is being prepared…' : 'No transcript entries yet.'}</div>`;
    const statusErrors = [['summaryError', 'Summary'], ['diarizationError', 'Speaker labels'], ['captureError', 'Audio capture']].filter(([key]) => selected[key]).map(([key, label]) => `<div class="meeting-error"><b>${label}:</b> ${L.esc(selected[key])}</div>`).join('');
    details = `<div class="meeting-detail">
      ${processing ? `<div class="meeting-progress card"><div class="meeting-setup-top"><b>${L.esc(progress && progress.detail || progress && progress.phase || 'Processing meeting…')}</b><span class="badge warn">${Math.round(pct)}%</span></div><div class="progress"><i style="width:${pct}%"></i></div></div>` : ''}
      ${statusErrors}
      <div class="card meeting-edit"><div class="meeting-field"><label for="meeting-title">Title</label><input id="meeting-title" type="text" value="${L.esc(selected.title || '')}" maxlength="160"></div>
      <div class="meeting-field"><label for="meeting-summary">Summary</label><textarea id="meeting-summary" rows="4" placeholder="A summary will appear here when processing is complete.">${L.esc(selected.summary || '')}</textarea>${selected.summaryError && lines.length ? '<button class="btn small meeting-summary-retry" id="meeting-summary-retry" ' + (S.meetingsBusy ? 'disabled' : '') + '>' + (S.meetingsBusy ? 'Retrying…' : 'Retry summary') + '</button>' : ''}</div>
      <div class="meeting-field"><label for="meeting-actions">Action items <span class="note">One item per line</span></label><textarea id="meeting-actions" rows="4" placeholder="Action items will appear here when available.">${L.esc(actionItemsValue(selected.actionItems))}</textarea></div>
      <div class="meeting-save-row"><span class="note">Edits are saved locally.</span><button class="btn primary" id="meeting-save" ${S.meetingsBusy ? 'disabled' : ''}>Save changes</button></div></div>
      <div class="card transcript-card"><div class="transcript-heading"><h2>Transcript</h2><span class="note">${lines.length} ${lines.length === 1 ? 'entry' : 'entries'}</span></div>${transcript}</div>
    </div>`;
  }
  const live = S.recordingId ? `<div class="recording-banner"><span class="recording-pulse"></span>Recording in progress${meetingById(S.recordingId) ? ` · ${L.esc(meetingById(S.recordingId).title || 'Untitled meeting')}` : ''}<button class="btn danger" id="meeting-stop" ${S.meetingsBusy ? 'disabled' : ''}>${S.meetingsBusy ? 'Stopping…' : 'Stop recording'}</button></div>` : '';
  const error = S.meetingsActionError ? `<div class="meeting-error" role="alert">${L.esc(S.meetingsActionError)}</div>` : '';
  const listError = S.meetingsError ? `<div class="meeting-error" role="alert">Could not load meetings: ${L.esc(S.meetingsError)} <button class="btn small" id="meetings-retry">Retry</button></div>` : '';
  return `<div class="meetings-wrap"><div class="meetings-heading"><div><h1>Meetings</h1><div class="sub">Record and review local meetings with speaker-labelled transcripts.</div></div></div>
    ${meetingStatusCard()}${error}${live}
    <div class="meeting-toolbar"><div><input id="meeting-new-title" type="text" maxlength="160" placeholder="Meeting title" aria-label="New meeting title"></div><button class="btn primary" id="meeting-start" ${S.meetingsBusy || S.recordingId || S.processingId || !(S.meetingStatus && S.meetingStatus.ready) ? 'disabled' : ''}>${S.meetingsBusy ? 'Starting…' : 'Start recording'}</button></div>
    <div class="meeting-workspace"><section class="meeting-list"><div class="meeting-list-head"><h2>Past meetings</h2><button class="btn small" id="meetings-refresh" ${S.meetingsBusy ? 'disabled' : ''}>Refresh</button></div>${listError}${S.meetingsLoading ? '<div class="empty">Loading meetings…</div>' : rows || '<div class="empty">No meetings yet. Start a recording to create one.</div>'}</section>${details}</div>
  </div>`;
}
async function meetingAction(action) {
  S.meetingsActionError = '';
  S.meetingsBusy = true;
  render();
  try { await action(); } catch (err) { S.meetingsActionError = errorText(err); }
  S.meetingsBusy = false;
  if (S.page === 'meetings') render();
}

/* ---------- wiring ---------- */
function bind() {
  main.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => { const e = S.history.find((x) => x.id === b.dataset.copy); if (e) window.pf.invoke('history:copy', e.text); b.style.color = 'var(--ok)'; setTimeout(() => { b.style.color = ''; }, 700); });
  const on = (id, fn) => { const el = $('#' + id); if (el) el.onclick = fn; };
  on('hist-on', () => save({ historyEnabled: true }));
  on('hist-clear', async () => { await window.pf.invoke('history:clear'); S.history = []; render(); });
  on('add-go', () => {
    const cfg = S.page === 'dictionary' ? ['dictionary', 'from', 'to'] : ['snippets', 'trigger', 'expansion'];
    const a = $('#add-a').value.trim(), b = $('#add-b').value;
    if (!a) return;
    save({ [cfg[0]]: [...S.settings[cfg[0]], { [cfg[1]]: a, [cfg[2]]: b }] });
  });
  main.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
    const key = S.page === 'dictionary' ? 'dictionary' : 'snippets';
    save({ [key]: S.settings[key].filter((_, i) => i !== +b.dataset.del) });
  });
  main.querySelectorAll('[data-style]').forEach((c) => c.onclick = () => save({ style: { casual: c.dataset.style === 'casual' } }));
  const segs = { live: 'liveMode', prov: 'provider' };
  for (const [id, key] of Object.entries(segs)) { const el = $('#' + id); if (el) el.querySelectorAll('button').forEach((b) => b.onclick = () => save({ [key]: b.dataset.v })); }
  const tg = { 'tk-on': 'toggleOn', trail: 'trailingSpace', warm: 'keepMicOpen', hist: 'historyEnabled' };
  for (const [id, key] of Object.entries(tg)) on(id, () => save({ [key]: !S.settings[key] }));
  on('login', async () => { S.settings = await window.pf.invoke('login:set', !S.settings.launchAtLogin); render(); });
  const val = (id, fn) => { const el = $('#' + id); if (el) el.onchange = () => fn(el.value); };
  val('mic', (v) => save({ micId: v }));
  val('threads', (v) => save({ threads: +v }));
  val('fillers', (v) => save({ fillers: v.split(',') }));
  val('deny', (v) => save({ deny: v.split(',') }));
  val('uname', (v) => save({ userName: v }));
  on('mic-refresh', async () => {
    try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach((t) => t.stop()); } catch (_) { /* no permission or no device */ }
    await loadDevices(); render();
  });
  on('dl', () => window.pf.invoke('models:download'));
  bindExtra();
  if (S.page === 'dictionary') bindSlang();
  on('hk-reset', () => { S.hkError = ''; save({ hotkey: { vks: [0x11, 0x20], label: 'Ctrl+Space' } }); });
  on('hk-change', () => { S.capTarget = 'hold'; S.capturing = S.capturing ? null : []; S.hkError = ''; render(); });
  on('tk-reset', () => { S.hkError = ''; save({ toggleKey: { vks: [0x14], label: 'CapsLock' } }); });
  on('tk-change', () => { S.capTarget = 'toggle'; S.capturing = S.capturing ? null : []; S.hkError = ''; render(); });
  on('meeting-setup', () => meetingAction(async () => { await window.pf.invoke('meetings:setup'); await loadMeetingStatus(); }));
  on('meeting-start', () => {
    const title = ($('#meeting-new-title') && $('#meeting-new-title').value.trim()) || 'Untitled meeting';
    meetingAction(async () => {
      const meeting = await window.pf.invoke('meetings:start', { title });
      if (meeting && meeting.id) { S.recordingId = meeting.id; S.selectedMeetingId = meeting.id; }
      await loadMeetings();
      if (meeting && meeting.id && !meetingById(meeting.id)) S.meetings.unshift(meeting);
    });
  });
  on('meeting-stop', () => {
    const id = S.recordingId;
    if (!id) return;
    meetingAction(async () => {
      const meeting = await window.pf.invoke('meetings:stop', { id });
      S.recordingId = null; S.processingId = id; S.meetingProgress = null;
      if (meeting) {
        const index = S.meetings.findIndex((item) => item.id === id);
        if (index >= 0) S.meetings[index] = meeting; else S.meetings.unshift(meeting);
      }
      await loadMeetings();
      S.selectedMeetingId = id;
    });
  });
  on('meetings-refresh', () => meetingAction(async () => { await Promise.all([loadMeetings(), loadMeetingStatus()]); }));
  on('meetings-retry', () => meetingAction(async () => { await Promise.all([loadMeetings(), loadMeetingStatus()]); }));
  main.querySelectorAll('[data-meeting-open]').forEach((b) => b.onclick = () => { S.selectedMeetingId = b.dataset.meetingOpen; S.meetingsActionError = ''; render(); });
  main.querySelectorAll('[data-meeting-delete]').forEach((b) => b.onclick = () => {
    const id = b.dataset.meetingDelete, meeting = meetingById(id);
    if (!window.confirm(`Delete “${meeting && meeting.title || 'Untitled meeting'}”? This cannot be undone.`)) return;
    meetingAction(async () => {
      await window.pf.invoke('meetings:delete', { id });
      if (S.recordingId === id) S.recordingId = null;
      if (S.processingId === id) S.processingId = null;
      if (S.selectedMeetingId === id) S.selectedMeetingId = null;
      await loadMeetings();
    });
  });
  on('meeting-summary-retry', () => {
    const meeting = meetingById(S.selectedMeetingId);
    if (!meeting) return;
    meetingAction(async () => {
      await window.pf.invoke('meetings:summarize', { id: meeting.id });
      await loadMeetings();
    });
  });
  on('meeting-save', () => {
    const meeting = meetingById(S.selectedMeetingId);
    if (!meeting) return;
    const title = ($('#meeting-title').value || '').trim() || 'Untitled meeting';
    const summary = $('#meeting-summary').value;
    const actionItems = actionItemsPatch(meeting.actionItems, $('#meeting-actions').value);
    meetingAction(async () => {
      const updated = await window.pf.invoke('meetings:update', { id: meeting.id, patch: { title, summary, actionItems } });
      const index = S.meetings.findIndex((item) => item.id === meeting.id);
      if (index >= 0) S.meetings[index] = updated || { ...meeting, title, summary, actionItems };
    });
  });
}

// the helper swallows Ctrl+Space for dictation; while the picker listens it must reach this page instead
let lastCap = false;
function notifyCapture() { const on = !!S.capturing; if (on !== lastCap) { lastCap = on; window.pf.send('hotkey:capture', on); } }

function render() {
  const pages = { home, meetings: meetingsPage, dictionary: () => pairsPage({ title: 'Dictionary', blurb: 'Replace a word or name every time it is dictated. Case-insensitive, whole words only.', listKey: 'dictionary', a: 'from', b: 'to', phA: 'Heard as', phB: 'Replace with' }) + slangSection(),
    snippets: () => pairsPage({ title: 'Snippets', blurb: 'Say a short phrase, get a longer text. Say only the phrase to replace the whole line.', listKey: 'snippets', a: 'trigger', b: 'expansion', phA: 'When I say', phB: 'Type this', multi: false }),
    style, settings: settingsPage, notes: notesPage };
  const y = main.scrollTop;
  const act = document.activeElement, keepId = act && main.contains(act) && act.id ? act.id : '', caret = keepId && typeof act.selectionStart === 'number' ? act.selectionStart : null;
  main.innerHTML = S.settings ? pages[S.page]() : '';
  main.scrollTop = y;
  if (keepId) { const el = document.getElementById(keepId); if (el) { el.focus({ preventScroll: true }); if (caret !== null && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(caret, caret); } catch (_) { /* not a text field */ } } } }
  notifyCapture();
  document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('on', n.dataset.page === S.page));
  bind();
  bindQuickAdd(S.page);
}

document.querySelectorAll('.nav').forEach((n) => n.onclick = () => { S.page = n.dataset.page; S.capturing = null; syncMeetingStatusPolling(); render(); if (S.page === 'meetings') loadMeetingsPage(); });

// hotkey capture: collect every key pressed, commit when all are released
const held = new Set(); let combo = [];
window.addEventListener('blur', () => { if (S.capturing) { S.capturing = null; combo = []; held.clear(); render(); } });   // never leave Ctrl+Space released to apps
window.addEventListener('keydown', (e) => {
  if (!S.capturing) return;
  e.preventDefault();
  if (e.code === 'Escape') { S.capturing = null; render(); return; }
  const vk = L.codeToVk(e.code); if (!vk) return;
  held.add(e.code); if (!combo.includes(vk)) combo.push(vk);
  S.capturing = combo.slice(); render();
});
window.addEventListener('keyup', async (e) => {
  if (!S.capturing) return;
  held.delete(e.code);
  if (held.size) return;
  const vks = combo; combo = [];
  const toggleTarget = S.capTarget === 'toggle';
  const err = toggleTarget ? L.validateToggleKey(vks, S.settings.hotkey.vks) : L.validateHotkey(vks);
  if (err) { S.hkError = err; S.capturing = null; render(); return; }
  S.hkError = ''; S.capturing = null;
  await save(toggleTarget ? { toggleKey: { vks, label: L.hotkeyLabel(vks) } } : { hotkey: { vks, label: L.hotkeyLabel(vks) } });
});

async function loadDevices() { try { S.devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'); } catch (_) { S.devices = []; } }

function engineBadge() {
  const el = $('#engine'), i = S.info || {};
  const [cls, txt] = S.dl ? ['busy', `Downloading model ${S.dl.pct}%`] : i.engine === 'ready' ? ['ready', 'Ready'] : i.engine === 'loading' ? ['busy', 'Loading model…'] : i.engine === 'missing' ? ['bad', 'Model not downloaded'] : ['bad', i.error || 'Engine error'];
  el.className = 'engine ' + cls; el.lastElementChild.textContent = txt;
}

async function refresh() {
  await loadExtra(); await loadSlang();
  [S.settings, S.stats, S.history, S.info] = await Promise.all([window.pf.invoke('settings:get'), window.pf.invoke('stats:get'), window.pf.invoke('history:get'), window.pf.invoke('app:info')]);
  engineBadge(); render();
}
window.pf.on('app:history', (e) => { S.history.unshift(e); if (S.page === 'home') render(); });
window.pf.on('app:stats', (s) => { S.stats = s; if (S.page === 'home') render(); });
window.pf.on('settings:changed', (s) => { S.settings = s; render(); });
window.pf.on('engine:state', async () => { S.info = await window.pf.invoke('app:info'); engineBadge(); if (S.page === 'settings') render(); else if (S.page === 'dictionary') { const st = document.getElementById('sl-restarting'); if (!!st !== !!(SL.state && SL.state.biasing.enabled && S.info.engine === 'loading')) { readForm('sl-add'); render(); } } });
window.pf.on('models:progress', (p) => { S.dl = p.done ? null : { pct: Math.round(p.pct) }; engineBadge(); if (S.page === 'settings') render(); });
window.pf.on('meetings:changed', async () => { await loadMeetings(); if (S.page === 'meetings') render(); });
window.pf.on('meetings:progress', (progress) => { S.meetingProgress = progress; if (S.page === 'meetings') render(); });
window.pf.on('meetings:state', (state) => {
  S.recordingId = state && state.recordingId || null;
  S.processingId = state && state.processingId || null;
  if (S.page === 'meetings') render();
});
window.pf.on('test:set', (t) => {
  if (t.page) { S.page = t.page; } if (t.state) Object.assign(S, t.state); if (t.x) Object.assign(X, t.x); render();
  if (t.scrollTo) { const el = document.querySelector(t.scrollTo); if (el) { if (t.center) el.scrollIntoView({ block: 'center' }); else main.scrollTop = el.offsetTop - 12; } }
});
loadDevices().then(refresh);
