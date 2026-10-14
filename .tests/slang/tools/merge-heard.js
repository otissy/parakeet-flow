'use strict';
/* Write measured misrecognitions into a pack as "heard": node merge-heard.js <pack.json> <out.json> <candidates.json>...
   Candidates come from analyze.js. Each is validated by the same code the app uses on load (one-letter and very common words are dropped). */
const fs = require('fs');
const path = require('path');
const P = require(path.join(__dirname, '..', '..', '..', 'src', 'slang', 'pack.js'));
const [packFile, outFile, ...cands] = process.argv.slice(2);
const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));
const byTerm = new Map(pack.terms.map((t) => [t.term, t]));
let added = 0;
for (const f of cands) {
  for (const c of JSON.parse(fs.readFileSync(f, 'utf8')).candidates) {
    const t = byTerm.get(c.term); if (!t) continue;
    const have = new Set([...(t.variants || []), ...(t.heard || [])].map((v) => v.toLowerCase()));
    if (have.has(c.heard.toLowerCase())) continue;
    (t.heard ||= []).push(c.heard); added++;
  }
}
const r = P.normalizePack(pack, { id: pack.id, builtin: true });
const body = { format: 1, id: pack.id, name: pack.name, description: pack.description, language: pack.language, terms: r.pack.terms };
fs.writeFileSync(outFile, JSON.stringify(body, null, 1));
console.log(path.basename(outFile), 'terms', body.terms.length, 'heard added', added, 'with heard', body.terms.filter((t) => t.heard && t.heard.length).length);
