'use strict';
/* Does sherpa-onnx 1.13.8 contextual biasing (hotwords) help the Parakeet TDT model, and what does it cost?
   usage: node hotwords-eval.js <terms wav dir> <neutral wav dir> <out.json> [scores=0.5,1,2,3] [limit]
   Conditions: greedy (what the app does today), modified_beam_search without hotwords, and modified_beam_search + the pack terms
   as hotwords at each score. Measures: preferred spelling right (case-sensitive), carrier sentence intact, ms per decode,
   and on neutral sentences the word error rate and how many pack terms were injected that were never said. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..', '..');
const sherpa = require(path.join(root, 'node_modules', 'sherpa-onnx-node'));
const P = require(path.join(root, 'src/slang/pack.js'));
const { readWav, MODEL_DIR } = require('./measure.js');
const { rightExact } = require('./analyze.js');

const [termsDir, neutralDir, outFile, scoresArg = '0.5,1,2,3', limitArg] = process.argv.slice(2);
const limit = +limitArg || 1e9;
const packDir = path.join(root, 'src', 'slang', 'packs');
const packFiles = process.env.PF_PACKS ? process.env.PF_PACKS.split(',') : ['starter-en.json', 'starter-nl.json'].map((f) => path.join(packDir, f));      // PF_PACKS: other pack files (the held-out run)
const packs = packFiles.map((f) => P.parsePackText(fs.readFileSync(f, 'utf8'), { fileName: path.basename(f), builtin: true }).pack);
const matcher = require(path.join(root, 'src/slang/matcher.js')).compile(P.toForms(packs));
const terms = packs.flatMap((p) => p.terms.map((t) => t.term));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-hot-'));

// sentencepiece-style vocabulary built from the model's own tokens.txt (all pieces equal cost): lets sherpa encode plain words as hotwords
const pieces = fs.readFileSync(path.join(MODEL_DIR, 'tokens.txt'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split(' ')[0]);
const bpeVocab = path.join(work, 'bpe.vocab');
fs.writeFileSync(bpeVocab, pieces.map((t, i) => (i < 5 ? t + '\t0' : t + '\t-1')).join('\n') + '\n');
const hotFile = path.join(work, 'hotwords.txt');
fs.writeFileSync(hotFile, [...new Set(terms.map((t) => t.toLowerCase()))].join('\n') + '\n');

const p = (n) => path.join(MODEL_DIR, n);
function recognizer(extra, modelExtra = {}) {
  return new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { transducer: { encoder: p('encoder.int8.onnx'), decoder: p('decoder.int8.onnx'), joiner: p('joiner.int8.onnx') }, tokens: p('tokens.txt'), numThreads: 2, provider: 'cpu', debug: 0, modelType: 'nemo_transducer', ...modelExtra },
    ...extra,
  });
}
function decode(r, a) {
  const t0 = process.hrtime.bigint();
  const s = r.createStream(); s.acceptWaveform({ samples: a, sampleRate: 16000 }); r.decode(s);
  return { text: r.getResult(s).text.trim(), ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}
const words = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);
function wer(ref, hyp) {
  const a = words(ref), b = words(hyp);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return { edits: d[a.length][b.length], n: a.length };
}

const conds = [{ name: 'greedy (today)', r: recognizer({}) }, { name: 'beam, no hotwords', r: recognizer({ decodingMethod: 'modified_beam_search', maxActivePaths: 4 }) }];
for (const sc of scoresArg.split(',').map(Number)) {
  conds.push({ name: 'beam + hotwords ' + sc, score: sc, r: recognizer({ decodingMethod: 'modified_beam_search', maxActivePaths: 4, hotwordsFile: hotFile, hotwordsScore: sc }, { modelingUnit: 'bpe', bpeVocab }) });
}
const tm = JSON.parse(fs.readFileSync(path.join(termsDir, 'manifest.json'), 'utf8')).filter((m) => terms.includes(m.term)).slice(0, limit);
const nm = JSON.parse(fs.readFileSync(path.join(neutralDir, 'manifest.json'), 'utf8'));
const termWav = tm.map((m) => readWav(path.join(termsDir, m.wav)));
const neutWav = nm.map((m) => readWav(path.join(neutralDir, m.wav)));
// a decode only counts after one warm-up call
for (const c of conds) { decode(c.r, termWav[0]); }
const result = [];
for (const c of conds) {
  let right = 0, rightPack = 0, intact = 0, ms = 0;
  tm.forEach((m, i) => { const d = decode(c.r, termWav[i]); ms += d.ms; if (rightExact(d.text, m.term)) right++; if (rightExact(matcher.apply(d.text), m.term)) rightPack++; if (/that was something/i.test(d.text)) intact++; });
  let edits = 0, n = 0, inj = 0, nms = 0, packChanged = 0; const injected = [];
  nm.forEach((m, i) => {
    const d = decode(c.r, neutWav[i]); nms += d.ms; if (matcher.apply(d.text) !== d.text) packChanged++;
    const w = wer(m.term, d.text); edits += w.edits; n += w.n;
    for (const t of terms) if (t.length > 3 && rightExact(d.text, t) && !rightAnyIn(m.term, t)) { inj++; injected.push(t + ' in: ' + d.text); }
  });
  result.push({ condition: c.name, termsRight: right, termsRightWithPack: rightPack, terms: tm.length, carrierIntact: intact, msPerTermClip: +(ms / tm.length).toFixed(1), neutralWER: +(100 * edits / n).toFixed(2), neutralInjectedTerms: inj, neutralChangedByPack: packChanged, msPerNeutralClip: +(nms / nm.length).toFixed(1), injected: injected.slice(0, 8) });
  console.log(JSON.stringify(result[result.length - 1]));
}
function rightAnyIn(text, term) { return text.toLowerCase().includes(term.toLowerCase()); }
fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
