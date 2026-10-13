'use strict';
/* Mic interface: start(onChunk(Float32Array 16 kHz mono)), stop().
   RendererMic captures in a hidden window (getUserMedia + AudioWorklet); WavMic replays a file in real time
   (tests and the --fake-mic dev switch). Audio is never written to disk. */
const fs = require('fs');

class RendererMic {
  constructor({ ipcMain, getWindow, getSettings }) {
    this.getWindow = getWindow; this.getSettings = getSettings; this.cb = null;
    ipcMain.on('audio:chunk', (_e, buf) => { if (this.cb) this.cb(new Float32Array(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf)); });
    ipcMain.on('audio:error', (_e, msg) => { this.lastError = String(msg); if (this.onError) this.onError(this.lastError); });
  }
  start(cb) {
    this.cb = cb;
    const w = this.getWindow();
    const s = this.getSettings();
    if (w) w.webContents.send('capture:start', { deviceId: s.micId, keepOpen: s.keepMicOpen });
  }
  stop() {
    this.cb = null;
    const w = this.getWindow();
    if (w && !w.isDestroyed()) w.webContents.send('capture:stop', { keepOpen: this.getSettings().keepMicOpen });
  }
}

class WavMic {
  constructor({ file, chunk = 512, leadMs = 0 }) {
    this.chunk = chunk; this.leadMs = leadMs;
    const b = fs.readFileSync(file);
    const at = b.indexOf('data') + 8;
    this.a = new Float32Array((b.length - at) >> 1);
    for (let i = 0; i < this.a.length; i++) this.a[i] = b.readInt16LE(at + 2 * i) / 32768;
    this.timer = null;
  }
  start(cb) {
    this.stop();
    let i = 0; const t0 = Date.now() + this.leadMs; let k = 0;
    const tick = () => {
      const due = Math.floor((Date.now() - t0) * 16 / this.chunk);
      while (k <= due && i < this.a.length) { cb(this.a.slice(i, i + this.chunk)); i += this.chunk; k++; }
      if (i >= this.a.length) { this.timer = null; return; }
      this.timer = setTimeout(tick, 16);
    };
    this.timer = setTimeout(tick, 16);
  }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}

module.exports = { RendererMic, WavMic };
