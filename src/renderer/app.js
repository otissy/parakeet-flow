// Main window. One small page-per-nav renderer; state comes from the main process over IPC.
const L = window.PFLib;
const $ = (s, r = document) => r.querySelector(s);
const main = $('#main');
const S = { page: 'home', settings: null, stats: { words: 0, wpm: 0, streak: 0 }, history: [], info: null, devices: [], dl: null, capturing: null, hkError: '' };

const ICON_COPY = '<svg viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 5.5V4a1.5 1.5 0 00-1.5-1.5H4A1.5 1.5 0 002.5 4v5A1.5 1.5 0 004 10.5h1.5"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 16 16"><path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8"/></svg>';

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
    `<div class="row"><div class="time">${L.fmtTime(e.ts)}</div><div class="tx">${L.esc(e.text)}</div><button class="iconbtn" data-copy="${L.esc(e.id)}" title="Copy">${ICON_COPY}</button></div>`).join('')}</div>`).join('');
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
  on('hk-reset', () => { S.hkError = ''; save({ hotkey: { vks: [0x11, 0x20], label: 'Ctrl+Space' } }); });
  on('hk-change', () => { S.capTarget = 'hold'; S.capturing = S.capturing ? null : []; S.hkError = ''; render(); });
  on('tk-reset', () => { S.hkError = ''; save({ toggleKey: { vks: [0x14], label: 'CapsLock' } }); });
  on('tk-change', () => { S.capTarget = 'toggle'; S.capturing = S.capturing ? null : []; S.hkError = ''; render(); });
}

// the helper swallows Ctrl+Space for dictation; while the picker listens it must reach this page instead
let lastCap = false;
function notifyCapture() { const on = !!S.capturing; if (on !== lastCap) { lastCap = on; window.pf.send('hotkey:capture', on); } }

function render() {
  const pages = { home, dictionary: () => pairsPage({ title: 'Dictionary', blurb: 'Replace a word or name every time it is dictated. Case-insensitive, whole words only.', listKey: 'dictionary', a: 'from', b: 'to', phA: 'Heard as', phB: 'Replace with' }),
    snippets: () => pairsPage({ title: 'Snippets', blurb: 'Say a short phrase, get a longer text. Say only the phrase to replace the whole line.', listKey: 'snippets', a: 'trigger', b: 'expansion', phA: 'When I say', phB: 'Type this', multi: false }),
    style, settings: settingsPage, notes: notesPage };
  const y = main.scrollTop;
  main.innerHTML = S.settings ? pages[S.page]() : '';
  main.scrollTop = y;
  notifyCapture();
  document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('on', n.dataset.page === S.page));
  bind();
}

document.querySelectorAll('.nav').forEach((n) => n.onclick = () => { S.page = n.dataset.page; S.capturing = null; render(); });

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
  await loadExtra();
  [S.settings, S.stats, S.history, S.info] = await Promise.all([window.pf.invoke('settings:get'), window.pf.invoke('stats:get'), window.pf.invoke('history:get'), window.pf.invoke('app:info')]);
  engineBadge(); render();
}
window.pf.on('app:history', (e) => { S.history.unshift(e); if (S.page === 'home') render(); });
window.pf.on('app:stats', (s) => { S.stats = s; if (S.page === 'home') render(); });
window.pf.on('settings:changed', (s) => { S.settings = s; render(); });
window.pf.on('engine:state', async () => { S.info = await window.pf.invoke('app:info'); engineBadge(); if (S.page === 'settings') render(); });
window.pf.on('models:progress', (p) => { S.dl = p.done ? null : { pct: Math.round(p.pct) }; engineBadge(); if (S.page === 'settings') render(); });
window.pf.on('test:set', (t) => {
  if (t.page) { S.page = t.page; } if (t.state) Object.assign(S, t.state); if (t.x) Object.assign(X, t.x); render();
  if (t.scrollTo) { const el = document.querySelector(t.scrollTo); if (el) { if (t.center) el.scrollIntoView({ block: 'center' }); else main.scrollTop = el.offsetTop - 12; } }
});
loadDevices().then(refresh);
