'use strict';

class MeetingTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(512);
    this.offset = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || !channels.length) return true;
    const samples = channels[0];
    for (let i = 0; i < samples.length; i++) {
      this.buffer[this.offset++] = samples[i];
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer.slice());
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('meeting-tap', MeetingTap);
