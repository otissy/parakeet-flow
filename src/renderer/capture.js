// Hidden capture window: getUserMedia -> AudioContext(16 kHz) -> worklet -> main. Nothing is stored.
// The stream opens when a dictation starts and closes 30 s after it ends (unless "keep mic open" is on);
// while open, the last ~400 ms are kept in memory so the first syllable is not lost.
let ctx = null, stream = null, node = null, active = false, ring = [], closeTimer = null, opening = null;

async function open(deviceId) {
  if (stream) return;
  if (opening) return opening;
  opening = (async () => {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1,
               echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
    if (ctx.sampleRate !== 16000) throw new Error('audio context is ' + ctx.sampleRate + ' Hz, expected 16000');
    await ctx.audioWorklet.addModule('worklet.js');
    const src = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, 'tap');
    node.port.onmessage = (e) => {
      if (active) window.pf.send('audio:chunk', e.data);
      else { ring.push(e.data); if (ring.length > 13) ring.shift(); }
    };
    src.connect(node);
  })();
  try { await opening; } finally { opening = null; }
}

function close() {
  try { if (stream) stream.getTracks().forEach((t) => t.stop()); if (ctx) ctx.close(); } catch (_) { /* already closed */ }
  stream = ctx = node = null; ring = [];
}

window.pf.on('capture:start', async ({ deviceId }) => {
  clearTimeout(closeTimer);
  try {
    await open(deviceId);
    active = true;
    for (const f of ring) window.pf.send('audio:chunk', f);
    ring = [];
  } catch (e) {
    close(); window.pf.send('audio:error', String(e && e.message || e));
  }
});
window.pf.on('capture:stop', ({ keepOpen }) => {
  active = false;
  clearTimeout(closeTimer);
  if (!keepOpen) closeTimer = setTimeout(close, 30000);
});
