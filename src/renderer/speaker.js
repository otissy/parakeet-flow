// Hidden speaker window: plays the voice's audio as it arrives (Web Audio, no files, nothing stored).
// speak:chunk {gen, samples, rate}  queue one piece of audio, gapless after the previous one
// speak:end {gen}                   no more audio for this reading: tell main when the last piece has finished
// speak:stop                        drop everything now
// back to main: speak:progress {gen, playedSec} every 200 ms while something plays, speak:finished {gen}, speak:error message
let ctx = null, gen = 0, nextAt = 0, sources = [], ended = false, timer = 0;

function context() {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function reset(g) {
  for (const s of sources) { try { s.node.onended = null; s.node.stop(); } catch (_) { /* already stopped */ } }
  sources = []; nextAt = 0; ended = false; gen = g;
  if (timer) { clearInterval(timer); timer = 0; }
}
function played() {
  const now = ctx ? ctx.currentTime : 0;
  let sec = 0;
  for (const s of sources) sec += Math.max(0, Math.min(s.dur, now - s.start));
  return sec + doneSec;
}
let doneSec = 0;
function maybeFinished() {
  if (ended && !sources.length) { const g = gen; if (timer) { clearInterval(timer); timer = 0; } window.pf.send('speak:finished', g); }
}

window.pf.on('speak:chunk', ({ gen: g, samples, rate }) => {
  try {
    if (g !== gen) { reset(g); doneSec = 0; }
    const c = context();
    const buf = c.createBuffer(1, samples.length, rate);
    buf.copyToChannel(samples, 0);
    const node = c.createBufferSource();
    node.buffer = buf; node.connect(c.destination);
    const start = Math.max(c.currentTime + 0.04, nextAt);
    node.start(start);
    nextAt = start + buf.duration;
    const rec = { node, start, dur: buf.duration };
    node.onended = () => { sources = sources.filter((s) => s !== rec); doneSec += rec.dur; maybeFinished(); };
    sources.push(rec);
    if (!timer) timer = setInterval(() => window.pf.send('speak:progress', { gen, playedSec: played() }), 200);
  } catch (e) { window.pf.send('speak:error', String((e && e.message) || e)); }
});
window.pf.on('speak:end', ({ gen: g }) => { if (g === gen) { ended = true; maybeFinished(); } });
window.pf.on('speak:stop', () => { reset(gen + 1000000); doneSec = 0; });
