'use strict';
/* Engine interface (all engines): { decode(Float32Array 16 kHz mono) -> { text, ms }, close() }.
   This one wraps sherpa-onnx-node + Parakeet TDT 0.6B v3 int8 (offline transducer). */
const path = require('path');

function modelPaths(modelDir) {
  return {
    encoder: path.join(modelDir, 'encoder.int8.onnx'),
    decoder: path.join(modelDir, 'decoder.int8.onnx'),
    joiner: path.join(modelDir, 'joiner.int8.onnx'),
    tokens: path.join(modelDir, 'tokens.txt'),
  };
}

/** hotwords: {hotwordsFile, bpeVocab, hotwordsScore} (src/slang/hotwords.js) turns on modified beam search with contextual biasing */
function createSherpaEngine({ modelDir, numThreads = 4, provider = 'cpu', hotwords = null } = {}) {
  const sherpa = require('sherpa-onnx-node');
  const p = modelPaths(modelDir);
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: p.encoder, decoder: p.decoder, joiner: p.joiner },
      tokens: p.tokens, numThreads, provider, debug: 0, modelType: 'nemo_transducer',
      ...(hotwords ? { modelingUnit: 'bpe', bpeVocab: hotwords.bpeVocab } : {}),
    },
    ...(hotwords ? { decodingMethod: 'modified_beam_search', maxActivePaths: 4, hotwordsFile: hotwords.hotwordsFile, hotwordsScore: hotwords.hotwordsScore } : {}),
  });
  return {
    name: 'sherpa-parakeet-tdt-v3', provider, numThreads,
    decode(samples) {
      const t0 = process.hrtime.bigint();
      const stream = recognizer.createStream();
      stream.acceptWaveform({ samples, sampleRate: 16000 });
      recognizer.decode(stream);
      const r = recognizer.getResult(stream);
      return { text: (r.text || '').trim(), ms: Number(process.hrtime.bigint() - t0) / 1e6 };
    },
    close() {},
  };
}

function createSileroVad({ modelPath, minSilence = 0.5, threshold = 0.5 } = {}) {
  const sherpa = require('sherpa-onnx-node');
  return new sherpa.Vad({
    sileroVad: { model: modelPath, threshold, minSpeechDuration: 0.2, minSilenceDuration: minSilence, windowSize: 512, maxSpeechDuration: 60 },
    sampleRate: 16000, numThreads: 1, provider: 'cpu', debug: false,
  }, 30);
}

module.exports = { createSherpaEngine, createSileroVad, modelPaths };
