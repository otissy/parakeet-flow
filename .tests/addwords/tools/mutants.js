'use strict';
/* Broken-build proof: every test family must FAIL on a deliberately broken copy of the code.
   usage: node .tests/addwords/tools/mutants.js <outDir>
   For each mutant: copies src/ and .tests/addwords/ to <outDir>/<name>/, applies ONE text change, runs the family's test file
   there (node --test), and saves the output to <outDir>/<name>.txt. Prints one line per mutant; exit 1 if any mutant passed. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..', '..');
const out = path.resolve(process.argv[2] || path.join(root, '..', 'pf-add-words-mutants'));
const MUTANTS = [
  { name: 'l1-no-bias-script', file: 'src/renderer/app.html', from: '<script src="../slang/bias.js"></script>', to: '', test: 'l1-import.test.js' },
  { name: 'l2-floor-not-round', file: 'src/slang/bias.js', from: 'Math.round(x / MAX_SCORE * 100)', to: 'Math.floor(x / MAX_SCORE * 100)', test: 'l2-units.test.js' },
  { name: 'l2-per-word-score-dropped', file: 'src/slang/hotwords.js', from: "lines.push(pct !== null ? `${w} :${B.percentToScore(pct)}` : w);", to: 'lines.push(w);', test: 'l2-units.test.js' },
  { name: 'l3-case-sensitive-duplicate', file: 'src/slang/service.js', from: 'const i = m.terms.findIndex((t) => t.term.toLowerCase() === key);\n    if (i < 0 && m.terms.length', to: 'const i = m.terms.findIndex((t) => t.term === n.term.term);\n    if (i < 0 && m.terms.length', test: 'l3-module.test.js' },
  { name: 'l3-undo-ignores-merge', file: 'src/slang/service.js', from: 'if (u.before) { if (i >= 0) m.terms[i] = u.before; else m.terms.push(u.before); }\n    else if (i >= 0)', to: 'if (i >= 0)', test: 'l3-module.test.js' },
  { name: 'l3-legacy-score-clamped-to-new-min', file: 'src/slang/bias.js', from: 'return Number.isFinite(x) ? clamp(x, MIN_SCORE, MAX_SCORE) : DEFAULT_SCORE;', to: 'return Number.isFinite(x) ? clamp(Math.round(x * 2) / 2, MIN_SCORE, MAX_SCORE) : DEFAULT_SCORE;', test: 'l3-module.test.js' },
  { name: 'l4-preload-blocks-undo', file: 'src/main/preload.js', from: " 'slang:undo-add',", to: '', test: 'l4-e2e.test.js', pattern: 'keyboard only|transcript history by mouse' },
  { name: 'l4-pick-not-kept-as-heard', file: 'src/renderer/slang-ui.js', from: ') variants.push(f.origin);', to: ') void 0;', test: 'l4-e2e.test.js', pattern: 'quick add' },
  { name: 'l4-restart-not-debounced', file: 'src/slang/hotwords.js', from: 't = timers.setTimeout(() => { t = null; restart(); }, ms); return true;', to: 'restart(); return true;', test: 'l4-e2e.test.js', pattern: 'engine restart' },
  // (a mutant that only disabled the Enter handler of the bias box SURVIVED: Chromium fires 'change' on Enter in a text box,
  //  so Enter still commits through onchange; that mutant was equivalent, not a test gap, and was replaced by this one)
  { name: 'l4-bias-box-shows-score', file: 'src/renderer/slang-ui.js', from: 'id="sl-bias-pct" value="${st.biasing.percent}"', to: 'id="sl-bias-pct" value="${st.biasing.score}"', test: 'l4-e2e.test.js', pattern: 'global bias' },
  { name: 'l4-add-form-ignores-bias', file: 'src/renderer/slang-ui.js', from: "{ term, variants, bias: f.bias.trim() }", to: '{ term, variants }', test: 'l4-e2e.test.js', pattern: 'keyboard' },
];

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

fs.mkdirSync(out, { recursive: true });
let bad = 0;
for (const m of MUTANTS) {
  const dir = path.join(out, m.name);
  fs.rmSync(dir, { recursive: true, force: true });
  copyDir(path.join(root, 'src'), path.join(dir, 'src'));
  copyDir(path.join(root, '.tests', 'addwords'), path.join(dir, '.tests', 'addwords'));
  const f = path.join(dir, m.file);
  const txt = fs.readFileSync(f, 'utf8');
  const eol = (s) => (txt.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s);       // the checkout may have CRLF line ends
  if (!txt.includes(eol(m.from))) { console.log(`${m.name}: MUTATION TEXT NOT FOUND`); bad++; continue; }
  fs.writeFileSync(f, txt.replace(eol(m.from), eol(m.to)));
  const args = ['--test', ...(m.pattern ? ['--test-name-pattern', m.pattern] : []), path.join(dir, '.tests', 'addwords', m.test)];
  const env = { ...process.env, PF_SHOTS: path.join(dir, 'shots'), PF_PLAYWRIGHT: process.env.PF_PLAYWRIGHT || path.join(root, '..', 'pf-add-words-scratch') };
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env, timeout: 300000 });
  const log = `$ node ${args.join(' ')}\n(mutant: ${m.file}: ${JSON.stringify(m.from)} -> ${JSON.stringify(m.to)})\n\n${r.stdout}${r.stderr}`;
  fs.writeFileSync(path.join(out, m.name + '.txt'), log);
  const pass = (r.stdout.match(/^ℹ pass (\d+)/m) || [])[1], fail = (r.stdout.match(/^ℹ fail (\d+)/m) || [])[1];
  const killed = r.status !== 0 && Number(fail) > 0;
  if (!killed) bad++;
  console.log(`${m.name}: ${killed ? 'FAILED as it must' : 'PASSED (test family did not notice!)'} (pass ${pass}, fail ${fail})`);
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
