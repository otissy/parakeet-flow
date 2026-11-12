// Settings > Read aloud, and the "What's new" card on Home. Plain functions over the shared state S of app.js (loaded after this file).
// The voice engine, the clipboard and the hotkey all live in the main process; this page only shows status and sends choices.
const RA = { st: null, cap: null, err: '', msg: '', combo: [], held: new Set(), news: null };

async function loadReadAloud() {
  RA.st = await window.pf.invoke('readaloud:status').catch(() => null);
  RA.news = await window.pf.invoke('whatsnew:get').catch(() => null);
}

function whatsNewCard() {
  const n = RA.news;
  if (!n || !n.items || !n.items.length) return '';
  return `<div class="card hint" id="whatsnew" role="region" aria-label="What's new"><div><div class="t">What's new in ${L.esc(n.version)}</div><ul class="leaves" style="margin:8px 0 10px">${n.items.map((i) => `<li>${L.esc(i)}</li>`).join('')}</ul><button class="btn" id="whatsnew-ok">Got it</button></div></div>`;
}

function raPhaseText(st) {
  if (st.phase === 'unpack') return `Unpacking ${st.pct}%`;
  if (st.phase === 'verify') return 'Checking files…';
  return `Downloading ${st.pct}%`;
}

function secReadAloud() {
  const st = RA.st, s = S.settings.readAloud;
  if (!st || !s) return '';
  const cap = RA.cap;
  const voiceBadge = st.downloading ? badge(raPhaseText(st), 'warn') : st.voiceOk ? badge('voice installed', 'ok') : badge('voice not downloaded', 'bad');
  const voiceBtn = st.downloading ? `<button class="btn" disabled>${L.esc(raPhaseText(st))}</button>`
    : st.voiceOk ? '<button class="btn" id="ra-remove" title="Delete the voice files from this PC">Remove voice</button>'
      : `<button class="btn primary" id="ra-download">Download voice (about ${st.sizeMB} MB)</button>`;
  const voices = Object.fromEntries((st.voices || []).map((v) => [v.id, v.label]));
  const speeds = Object.fromEntries([0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6].map((x) => [String(x), x === 1 ? 'Normal (1x)' : x + 'x']));
  const speedVal = String(Object.keys(speeds).includes(String(s.speed)) ? s.speed : 1);
  return `<h2 id="sec-readaloud">Read aloud</h2><div class="card" style="padding:4px 18px">
    <div class="srow"><div class="l"><b>Read the selected text aloud</b><div>Select text in any app and press <b>${L.esc(s.hotkey.label)}</b>: it is read out loud in a local voice. Press it again or Esc to stop. Off by default because it presses Ctrl+C in the app in front and uses the clipboard for a moment (your clipboard is put back exactly as it was; if it holds something that cannot be restored, nothing is read), and because it needs the voice download below. The text never leaves this PC.</div></div><div class="c">${toggle('ra-on', s.enabled, !st.voiceOk && !s.enabled)}</div></div>
    <div class="srow"><div class="l"><b>Voice files</b><div>Kokoro v1.0 (multi-language pack, English voices offered), from the sherpa-onnx project on GitHub, checked against a fixed SHA-256 before it is unpacked. Downloaded once, about ${st.sizeMB} MB, then it works offline. It is not part of the installer.${st.error ? ` <span style="color:var(--bad)" role="alert">${L.esc(st.error)}</span>` : ''}</div>${st.downloading ? `<div class="progress"><i style="width:${st.pct}%"></i></div>` : ''}<div style="margin-top:8px">${voiceBadge}</div></div><div class="c">${voiceBtn}</div></div>
    <div class="srow"><div class="l"><b>Hotkey</b><div>${cap ? 'Hold the keys you want, then let go. Esc cancels.' : 'Modifiers plus one other key. It cannot share its key with the dictation hotkey, the note hotkey or the toggle key.'}</div>${RA.err ? `<div style="color:var(--bad)" role="alert">${L.esc(RA.err)}</div>` : ''}</div>
      <div class="c">${cap ? `<span class="chip">${cap.length ? keys(cap) : 'Listening…'}</span>` : keys(s.hotkey.vks)}<button class="btn" id="ra-change">${cap ? 'Cancel' : 'Change'}</button>${cap ? '' : '<button class="btn" id="ra-reset">Reset</button>'}</div></div>
    <div class="srow"><div class="l"><b>Voice</b><div>Default: George, the British male voice (Bob).</div></div><div class="c">${sel('ra-voice', voices, s.voice)}</div></div>
    <div class="srow"><div class="l"><b>Speed</b><div>How fast it reads.</div></div><div class="c">${sel('ra-speed', speeds, speedVal)}</div></div>
    <div class="srow"><div class="l"><b>Try it</b><div>${RA.msg ? L.esc(RA.msg) : 'Plays one short line with the voice and speed above.'}</div></div><div class="c"><button class="btn" id="ra-test" ${st.voiceOk ? '' : 'disabled'}>${st.state !== 'idle' ? 'Stop' : 'Play sample'}</button></div></div>
  </div>`;
}

function bindReadAloud() {
  const q = (id) => document.getElementById(id);
  const on = (id, fn) => { const e = q(id); if (e) e.onclick = fn; };
  const s = S.settings.readAloud;
  const refresh = async () => { RA.st = await window.pf.invoke('readaloud:status').catch(() => RA.st); if (S.page === 'settings') render(); };
  on('ra-on', () => save({ readAloud: { ...s, enabled: !s.enabled } }));
  on('ra-download', async () => { RA.msg = ''; RA.st = { ...RA.st, downloading: true, phase: 'download', pct: 0, error: '' }; render(); await window.pf.invoke('readaloud:download'); await refresh(); });
  on('ra-remove', async () => { if (!window.confirm('Delete the read-aloud voice files from this PC? You can download them again later.')) return; await window.pf.invoke('readaloud:remove'); await save({ readAloud: { ...s, enabled: false } }); await refresh(); });
  on('ra-test', async () => { RA.msg = ''; await window.pf.invoke(RA.st && RA.st.state !== 'idle' ? 'readaloud:stop' : 'readaloud:sample'); setTimeout(refresh, 300); });
  on('ra-reset', async () => { RA.err = ''; const d = await window.pf.invoke('settings:get', 'defaults'); save({ readAloud: { ...s, hotkey: d.readAloud.hotkey } }); });
  on('ra-change', () => { if (RA.cap) stopReadCap(); else { RA.cap = []; RA.err = ''; window.pf.send('hotkey:capture', true); render(); } });
  const v = q('ra-voice'); if (v) v.onchange = () => save({ readAloud: { ...s, voice: v.value } });
  const sp = q('ra-speed'); if (sp) sp.onchange = () => save({ readAloud: { ...s, speed: +sp.value } });
  on('whatsnew-ok', async () => { await window.pf.invoke('whatsnew:dismiss'); RA.news = null; render(); });
}

function stopReadCap() { RA.cap = null; RA.combo = []; RA.held.clear(); window.pf.send('hotkey:capture', false); render(); }
window.addEventListener('blur', () => { if (RA.cap) stopReadCap(); });
window.addEventListener('keydown', (e) => {
  if (!RA.cap) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (e.code === 'Escape') { stopReadCap(); return; }
  const vk = L.codeToVk(e.code); if (!vk) return;
  RA.held.add(e.code); if (!RA.combo.includes(vk)) RA.combo.push(vk);
  RA.cap = RA.combo.slice(); render();
}, true);
window.addEventListener('keyup', async (e) => {
  if (!RA.cap) return;
  RA.held.delete(e.code);
  if (RA.held.size) return;
  const vks = RA.combo; stopReadCap();
  const err = await window.pf.invoke('readaloud:check-hotkey', vks);
  if (err) { RA.err = err; render(); return; }
  RA.err = '';
  await save({ readAloud: { ...S.settings.readAloud, hotkey: { vks, label: L.hotkeyLabel(vks).replace(/ \+ /g, '+') } } });
});

window.pf.on('readaloud:progress', (p) => { if (RA.st) { RA.st = { ...RA.st, ...p }; if (S.page === 'settings') render(); } });
window.pf.on('readaloud:changed', () => { window.pf.invoke('readaloud:status').then((st) => { RA.st = st; if (S.page === 'settings') render(); }).catch(() => {}); });
