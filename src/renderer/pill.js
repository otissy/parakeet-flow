// Flow bar renderer. States: idle | listening | handsfree | processing | done | cancelled | error.
const pill = document.getElementById('pill');
const textEl = document.getElementById('text');
const noteEl = document.getElementById('note');
const canvas = document.getElementById('wave');
const g = canvas.getContext('2d');
const BARS = 15;
const levels = new Array(BARS).fill(0);
let state = 'idle', target = 0, shown = 0, raf = 0, t0 = performance.now();

function tail(s, max = 46) {
  if (s.length <= max) return s;
  const cut = s.slice(s.length - max);
  const sp = cut.indexOf(' ');
  return '…' + (sp > 0 && sp < 14 ? cut.slice(sp + 1) : cut);
}

function setState({ state: st, text = '', note = '' }) {
  state = st;
  pill.className = st + ((text && st !== 'idle') ? ' has-text' : '');
  textEl.textContent = st === 'done' ? tail(text, 40) : tail(text);
  noteEl.textContent = note; noteEl.classList.toggle('show', !!note && st !== 'idle');
  if (st !== 'listening' && st !== 'handsfree') target = 0;
  if (!raf && st !== 'idle') raf = requestAnimationFrame(draw);
}

function draw(now) {
  raf = 0;
  const live = state === 'listening' || state === 'handsfree';
  const idleish = state === 'idle' || state === 'done' || state === 'cancelled' || state === 'error';
  shown += (target - shown) * 0.35;
  const w = canvas.width, h = canvas.height;
  g.clearRect(0, 0, w, h);
  if (!idleish) {
    // shift one bar per frame at ~30 fps, driven by the smoothed level (processing: a slow ripple)
    if (state === 'processing') target = 0.18 + 0.12 * Math.sin((now - t0) / 140);
    if (Math.floor(now / 33) !== Math.floor((now - 16) / 33)) { levels.push(Math.min(1, shown)); levels.shift(); }
    const bw = w / BARS;
    g.fillStyle = state === 'handsfree' ? '#9a8dff' : '#eeeef3';
    for (let i = 0; i < BARS; i++) {
      const v = levels[i];
      const bh = Math.max(3, v * (h - 4));
      const x = i * bw + bw * 0.2, ww = bw * 0.6;
      g.globalAlpha = live ? 0.35 + 0.65 * (i / BARS) : 0.5;
      g.beginPath(); g.roundRect(x, (h - bh) / 2, ww, bh, ww / 2); g.fill();
    }
    g.globalAlpha = 1;
  } else levels.fill(0);
  if (!idleish) raf = requestAnimationFrame(draw);
}

window.pf.on('pill:state', setState);
window.pf.on('pill:level', (v) => { target = v; });

// Click-through everywhere except the two buttons (only visible in hands-free).
let over = false;
document.addEventListener('mousemove', (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const now = !!(el && el.closest && el.closest('.btn') && state === 'handsfree');
  if (now !== over) { over = now; window.pf.send('pill:mouse', over); }
});
document.getElementById('cancel').addEventListener('click', () => window.pf.send('pill:action', 'cancel'));
document.getElementById('stop').addEventListener('click', () => window.pf.send('pill:action', 'stop'));
window.pf.send('pill:ready');
