'use strict';

let context = null, microphone = null, system = null, node = null, silent = null, running = false, opening = null;

function stopTracks(stream) {
  if (stream) for (const track of stream.getTracks()) track.stop();
}

function closeCapture() {
  running = false;
  stopTracks(microphone);
  stopTracks(system);
  microphone = system = null;
  if (context) context.close().catch(() => {});
  context = node = silent = null;
}

async function startCapture({ deviceId, sourceId }) {
  if (opening) return opening;
  opening = (async () => {
    closeCapture();
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    try {
      const source = { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId };
      system = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: source },
        video: { mandatory: source },
      });
      if (!system.getAudioTracks().length) throw new Error('Windows did not provide a system-audio track for the selected display');
      for (const track of system.getVideoTracks()) track.stop();
      context = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
      if (context.sampleRate !== 16000) throw new Error(`Audio context is ${context.sampleRate} Hz; meeting capture requires 16000 Hz`);
      await context.audioWorklet.addModule('worklet.js');
      const mix = context.createGain();
      mix.gain.value = 1;
      const micSource = context.createMediaStreamSource(microphone);
      const systemSource = context.createMediaStreamSource(system);
      const micGain = context.createGain();
      const systemGain = context.createGain();
      micGain.gain.value = 0.65;
      systemGain.gain.value = 0.65;
      micSource.connect(micGain).connect(mix);
      systemSource.connect(systemGain).connect(mix);
      node = new AudioWorkletNode(context, 'meeting-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      silent = context.createGain();
      silent.gain.value = 0;
      mix.connect(node);
      node.connect(silent).connect(context.destination);
      node.port.onmessage = (event) => {
        if (running) window.pf.send('meeting:audio-chunk', event.data);
      };
      running = true;
      window.pf.send('meeting:capture-ready');
    } catch (error) {
      closeCapture();
      window.pf.send('meeting:capture-error', String(error && error.message || error));
    }
  })();
  try { await opening; } finally { opening = null; }
}

window.pf.on('meeting:capture-start', (options) => { startCapture(options); });
window.pf.on('meeting:capture-stop', () => {
  closeCapture();
  window.pf.send('meeting:capture-stopped');
});
