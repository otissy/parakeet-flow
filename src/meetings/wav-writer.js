'use strict';
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 16000;
const MAX_CHUNK_SAMPLES = SAMPLE_RATE;

function header(dataBytes) {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataBytes, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SAMPLE_RATE, 24); b.writeUInt32LE(SAMPLE_RATE * 2, 28); b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(dataBytes, 40);
  return b;
}

class WavWriter {
  constructor(file) {
    this.file = file;
    this.fd = null;
    this.dataBytes = 0;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.fd = fs.openSync(file, 'wx');
    fs.writeSync(this.fd, header(0));
  }

  write(samples) {
    if (this.fd === null) throw new Error('Meeting audio writer is closed');
    if (!(samples instanceof Float32Array) || !samples.length || samples.length > MAX_CHUNK_SAMPLES) throw new Error('Invalid meeting audio chunk');
    const b = Buffer.allocUnsafe(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      const v = Number.isFinite(samples[i]) ? Math.max(-1, Math.min(1, samples[i])) : 0;
      b.writeInt16LE(v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), i * 2);
    }
    fs.writeSync(this.fd, b);
    this.dataBytes += b.length;
  }

  finish() {
    if (this.fd === null) return;
    fs.writeSync(this.fd, header(this.dataBytes), 0, 44, 0);
    fs.closeSync(this.fd);
    this.fd = null;
  }

  abort() {
    if (this.fd === null) return;
    fs.closeSync(this.fd);
    this.fd = null;
  }
}

module.exports = { WavWriter, SAMPLE_RATE, MAX_CHUNK_SAMPLES };
