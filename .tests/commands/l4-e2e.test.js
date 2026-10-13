'use strict';
/* The real app, real VAD + Parakeet on synthesised speech, real hold-to-talk path. Segments are separated by 1.3 s pauses.
   English : "Send the report to Anna before noon." "Thanks for your help." "Delete that." "Note to self, buy oat milk on the way home." "New line." "Kind regards, Otis."
   Dutch   : "Stuur het rapport morgen naar Anna." "Bedankt voor de hulp." "Verwijder dat." "Notitie aan mezelf, bel de tandarts." "Nieuwe regel." "Met vriendelijke groet, Otis." */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runApp, electron } = require('../features-e2e/run-app.js');
const U = require('../asr/util');

const root = path.join(__dirname, '..', '..');
const FIX = U.FIX;
const have = U.modelsPresent() && fs.existsSync(electron) && fs.existsSync(path.join(FIX, 'cmd-en.wav')) && fs.existsSync(path.join(FIX, 'cmd-nl.wav'));
const skip = have ? false : 'electron, models or cmd fixtures missing: run .tests/fixtures/gen-commands.py (UNVERIFIED)';
const PHRASES = /delete that|verwijder dat|note to self|notitie aan mezelf|new line|nieuwe regel/i;

test('real ASR: command phrases are never on screen, edits and notes happen', { skip, timeout: 240000 }, async () => {
  const { rep, stderr } = await runApp('commands', { PF_AUDIO_EN: path.join(FIX, 'cmd-en.wav'), PF_AUDIO_NL: path.join(FIX, 'cmd-nl.wav') });
  assert.ok(rep, 'hook wrote a report: ' + stderr);
  assert.deepEqual(rep.errors, []);
  fs.mkdirSync(path.join(root, '..', 'pf-proof'), { recursive: true });
  fs.writeFileSync(path.join(process.env.PF_PROOF_DIR || path.join(root, '..', 'pf-proof'), 'commands-report.json'), JSON.stringify({ en: rep.en, nl: rep.nl, enNotes: rep.enNotes, allNotes: rep.allNotes, pills: rep.pills }, null, 1));

  // the phrase was never on screen in ANY intermediate state, English or Dutch
  for (const run of [rep.en, rep.nl]) for (const s of run.states) assert.ok(!PHRASES.test(s), 'command phrase on screen: ' + JSON.stringify(s));

  // English: Thanks was deleted, the note was saved not typed, a line break came before the sign-off
  assert.match(rep.en.text, /^Send the report to Anna before noon\.\n\s?Kind regards,? Otis\.?$/i, JSON.stringify(rep.en.text));
  assert.ok(!/thanks/i.test(rep.en.text), 'Delete that removed the previous sentence');
  assert.equal(rep.enNotes.length, 1); assert.match(rep.enNotes[0], /^Buy oat milk on the way home\.?$/i);

  assert.ok(rep.pills.some((p) => p.note === 'Saved note'), 'pill flashed Saved note');

  // Dutch: the only Dutch voice here is an English voice reading Dutch, which Parakeet hears as "Vervader" and "Notizie on myself",
  // so the Dutch commands cannot be verified end to end. The run is recorded in the report; its text is only checked for the invariant above.
  assert.ok(rep.nl.text.length > 20, 'Dutch run dictated something');
});
