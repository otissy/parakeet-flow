# Slang packs

Packs fix the spelling and casing of slang, gamer and streamer words in what you dictate. Parakeet writes standard
spelling ("riz", "goaded", "Gee Gee"); a pack says what you wanted ("rizz", "goated", "GG").

Where they run: on FINISHED sentences only, after Parakeet and after filler removal and snippets, before your Dictionary
rows. The live preview is exactly what the model wrote. Nothing leaves the PC and no term is ever logged.

## Where the words come from

The two starter packs were written by hand for this app from general knowledge: spellings, likely misrecognitions and a
category per term. They contain no definitions and nothing copied from any dictionary site.

**Urban Dictionary.** This app does not scrape it, ships none of it and never calls it. Its definitions are user-written
text and its terms of service forbid scraping. If you want to add words you found there, you copy the words yourself and
paste them into Dictionary > Slang packs > Import. Whether bulk-importing from that site is acceptable under its terms is
your decision, not the app's. The importer only reads spellings; it has no column for a definition.

## The files

Packs live in `%APPDATA%\parakeet-flow\dictionary\packs\*.json` (yours; `.csv` and `.txt` work too) and, read-only, in
`src/slang/packs/` (built in). `mine.json` is the pack the "My terms" box edits. Which packs are switched on is stored in
`settings.json` under `slang.packs` (`{"starter-nl": false}`); a pack that is not listed is on.

Pack JSON (format 1):

```json
{ "format": 1, "id": "my-pack", "name": "My pack", "description": "", "language": "en",
  "terms": [
    { "term": "rizz", "variants": ["riz", "rits"], "heard": ["ris"], "category": "slang", "lang": "en" },
    { "term": "GOAT", "variants": ["G.O.A.T."], "casing": "exact", "matchCase": true },
    { "term": "Twitch", "casing": "keep" }
  ] }
```

| field | meaning |
|---|---|
| `term` | the spelling you want. Required. 80 characters, 8 words at most, must contain a letter or digit |
| `variants` | what Parakeet might write instead (your guesses). Up to 24 |
| `heard` | the same, but measured on real Parakeet output (the starter pack fills this in) |
| `category`, `lang` | free tags, shown in the term list |
| `casing` | `smart` (default for lower-case terms), `exact` (default when the term has a capital), `lower`, `upper`, `title`, `keep` |
| `matchCase` | only act when the text has exactly this case (so `GOAT` leaves the animal "goat" alone) |
| `allowCommon` | keep a variant that is a very common word (see Limits) |

The term itself is also a match. `tiktok` becomes `TikTok` because the term has a capital; `Rizz` in the middle of a
sentence becomes `rizz` because the term is lower case.

Casing rules: `smart` = the term as written, except that a capital is kept at the start of a sentence and a SHOUTED match
stays shouted. `exact` = always the term as written. `lower`/`upper`/`title` = always that. `keep` = a word that already is
the term keeps whatever case the model gave it, a variant is still rewritten (use it for names that are also ordinary words:
Rumble, Rode, Twitch).

## Import and export

Import takes pasted text or a file (.txt, .csv, .json), from Dictionary > Slang packs > Import. It shows what it found before
anything is written.

```
rizz                          one term per line
no cap,no kap|no cab          term, then misrecognitions separated by |
"no cap, fr",no kap fr        quote a term that contains a comma; "" is a quote inside quotes
term,variants,category,lang,casing   an optional header row; columns may be reordered when a header names them
```

Tab or semicolon separated also works, `#` starts a comment line, a BOM is ignored, a stray unmatched quote does not swallow
the rest of the file. Limits: 5 MB, 20,000 terms, 80 characters per term. Duplicates (same spelling, any case) keep the
first. Control and bidirectional-override characters are stripped. You can import into a new pack (named after what you type,
or after the file) or add to My terms. A pack never overwrites another: a taken id gets `-2`, `-3`. The pack id is always a
sanitised slug, never a path, so `..\..\x` as a name cannot write outside the packs folder.

Export writes a pack as JSON or CSV through a Save dialog.

## How matching works

1. The text is split into word tokens (letters and digits, with apostrophes inside a word: `don't`, `dm'en`).
2. Every enabled pack's terms and variants are put in one lookup tree. Leftmost, longest match first: `no cap fr` beats `no cap`
   beats `cap`. A rewrite is never rewritten again (one pass).
3. Case-insensitive on the way in. Words of a multi-word form may be separated by spaces or one hyphen (`no-kap`), not a comma.
4. Whole words only: `riz` does not match inside `prizzle`, `riz2` or `ariz`. A possessive stays: `riz's` -> `rizz's`.
5. Never changed: inside URLs, e-mail addresses, Windows and Unix paths, `code spans` and fenced code, `@handles`, `#tags`,
   `snake_case` and dotted identifiers (`obj.riz.name`), `name.ext` file names and `site.tv/path`.
6. Priority when two entries claim the same heard text: My terms, then your packs (by id), then built-in. Your own Dictionary
   "Replace" rows win over every pack: their heard texts are handed to the Dictionary instead.
7. Speed: a 5,000-term pack (15,000 forms) compiles in about 30 ms and a 20,000-character text takes under 2 ms.

## The local cleanup model

When AI cleanup is on, the enabled terms that occur in the sentence are named in the model's prompt ("keep them exactly as
written: rizz, no cap"), capped at 30. A sentence with no pack term gets the old prompt byte for byte. Afterwards, the existing
guards still apply (word-level distance, similarity, length), plus one more: a term from the original that the model dropped
or split, or a term with a capital that it re-cased, rejects the answer and the original is typed. The pack is applied once
more to the model's text, so a term it re-cased comes back as you spelled it.

## Contextual biasing (hotwords), experimental

sherpa-onnx 1.13.8 does support hotwords for the Parakeet TDT 0.6B v3 model, but only with `modified_beam_search` decoding and
a `bpe` modeling unit; without both, the list is ignored or fails to encode. The app builds the needed sentencepiece-style
vocabulary from the model's own `tokens.txt` and passes the enabled terms. It is off by default (switch in Dictionary > Slang
packs); switching it, or editing packs while it is on, restarts the speech engine once (about 2 s).

Measured on this PC (TTS speech, 507 terms in a carrier sentence, voice `am_michael`, packs written only from the other voice):
see README "Slang packs" for the table. Score 1 to 2 was best; 3 made the model invent words. Cost: no measurable latency
difference (about 200 ms per short clip either way), neutral-sentence word error rate unchanged.

## Limits

- Variants that are one character, or a very common English/Dutch word, are dropped when a pack loads (`a` -> `aura` would
  wreck every sentence). `allowCommon: true` on a term overrides that. A one-letter term needs `matchCase`.
- A variant that is also a real word (`goaded` for `goated`) is a trade: it fixes your slang and changes the real word. The
  starter pack keeps such variants only when the slang reading is far more likely, and drops spelling preferences between
  two normal spellings (`frame rate` / `framerate`).
- Parakeet sometimes drops or fuses the word completely ("gee gee" -> "Gee"); a pack cannot restore what was not written.
- `Dutch` terms are matched in any text; the pack's language is a label. Dutch recognition was not measured (no Dutch voice).
- Misrecognitions in the starter pack come from synthesised speech (Kokoro). A real voice will differ; add what you see in
  Dictionary > My terms.
- Packs apply to finals only, never to the live preview, and not to the voice-command phrases.

Side effect seen with hotwords on: the beam search often writes a hotword lower-case even at the start of a sentence ("no cap that was...").
A pack with the smart casing puts the sentence-start capital back for terms it rewrites, but not for a word it did not change.
