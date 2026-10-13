'use strict';
/* Voice commands, local rules only (no LLM). Matched on FINALS, on the whole segment: a command is a segment
   that says only the command phrase (Parakeet closes a segment after a ~500 ms pause, so say the command
   after a short pause). English and Dutch are both always active. A matched phrase is never typed.
   The phrase list is user-configurable (Settings > Voice commands); `note to self, <text>` is separate. */

const ACTIONS = ['delete', 'undo', 'newline', 'paragraph', 'capitalize', 'allcaps', 'formal', 'casual'];

const DEFAULT_COMMANDS = [
  ['delete that', 'delete'], ['scratch that', 'delete'], ['delete last', 'delete'], ['remove that', 'delete'], ['delete the last sentence', 'delete'],
  ['verwijder dat', 'delete'], ['wis dat', 'delete'], ['schrap dat', 'delete'], ['haal dat weg', 'delete'], ['verwijder de laatste zin', 'delete'],
  ['undo that', 'undo'], ['undo', 'undo'], ['maak dat ongedaan', 'undo'], ['maak ongedaan', 'undo'], ['herstel dat', 'undo'],
  ['new line', 'newline'], ['newline', 'newline'], ['next line', 'newline'], ['nieuwe regel', 'newline'], ['volgende regel', 'newline'],
  ['new paragraph', 'paragraph'], ['nieuwe alinea', 'paragraph'], ['nieuwe paragraaf', 'paragraph'],
  ['capitalize that', 'capitalize'], ['capitalise that', 'capitalize'], ['kapitaliseer dat', 'capitalize'], ['hoofdletters aan het begin', 'capitalize'],
  ['all caps that', 'allcaps'], ['uppercase that', 'allcaps'], ['alles hoofdletters', 'allcaps'], ['maak dat hoofdletters', 'allcaps'],
  ['make that formal', 'formal'], ['make it formal', 'formal'], ['maak dat formeel', 'formal'], ['maak het formeel', 'formal'],
  ['make that casual', 'casual'], ['make it casual', 'casual'], ['maak dat informeel', 'casual'], ['maak het informeel', 'casual'],
].map(([phrase, action]) => ({ phrase, action }));

const DEFAULT_NOTE_TRIGGERS = ['note to self', 'note to myself', 'notitie aan mezelf', 'notitie aan mijzelf', 'notitie voor mezelf', 'notitie voor mij'];

/** lower-case words with punctuation stripped; apostrophes kept inside words */
function words(text) {
  return String(text || '').normalize('NFC').toLowerCase()
    .replace(/[^\p{L}\p{N}'’\s]+/gu, ' ').replace(/[’]/g, "'").split(/\s+/).filter(Boolean);
}
const norm = (text) => words(text).join(' ');

/** whole-segment match -> {action, phrase} | null. `list` = [{phrase, action}] */
function matchCommand(text, list = DEFAULT_COMMANDS) {
  const t = norm(text);
  if (!t) return null;
  for (const c of list) if (norm(c.phrase) === t && ACTIONS.includes(c.action)) return { action: c.action, phrase: c.phrase };
  return null;
}

/** `note to self, buy milk` -> {text:'Buy milk'}; trigger alone -> {text:''}; else null. The body keeps its own words. */
function matchNote(text, triggers = DEFAULT_NOTE_TRIGGERS) {
  const src = String(text || '').normalize('NFC').trim();
  const sw = src.split(/\s+/);
  const cleanWord = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}'’]+/gu, '').replace(/[’]/g, "'");
  for (const trig of triggers) {
    const tw = words(trig);
    if (!tw.length || sw.length < tw.length) continue;
    if (!tw.every((w, i) => cleanWord(sw[i]) === w)) continue;
    const body = sw.slice(tw.length).join(' ').replace(/^[\s,.:;!?\-–—]+/u, '').trim();
    return { text: body ? body[0].toUpperCase() + body.slice(1) : '', trigger: trig };
  }
  return null;
}

/** Is this (partial) text possibly a command or a note being spoken? Then it is not typed live: the segment may turn out to be one.
    Partials are guesses ("note to self" can arrive as "note to the first"), so this is deliberately generous:
    - a command phrase: the first word matches and the segment is still no longer than the phrase plus one word
    - a note: it starts with all but the last word of a trigger ("note to ..." / "notitie aan ..."), whatever follows, so a
      misheard trigger word never lets the note body onto the screen. A sentence that starts with "note to" is
      therefore typed when it is final, not live. */
function isCommandPrefix(text, { list = DEFAULT_COMMANDS, triggers = DEFAULT_NOTE_TRIGGERS, notes = true } = {}) {
  const w = words(text);
  if (!w.length) return false;
  const first = (pw) => (w.length === 1 ? pw[0].startsWith(w[0]) : pw[0] === w[0]);
  for (const c of list) {
    const pw = words(c.phrase);
    if (pw.length && first(pw) && w.length <= pw.length + 1) return true;
  }
  if (notes) for (const t of triggers) {
    const tw = words(t);
    if (!tw.length) continue;
    const head = Math.max(1, tw.length - 1);                       // "note to" of "note to self"
    if (w.length < head) { if (w.every((x, i) => (i < w.length - 1 ? x === tw[i] : tw[i].startsWith(x)))) return true; }
    else if (tw.slice(0, head).every((x, i) => (i < head - 1 || w.length > head ? x === w[i] : x.startsWith(w[i])))) return true;
  }
  return false;
}

/** text transforms used by the rewrite commands */
function titleCase(text) { return text.replace(/(^|[\s(\["'“-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase()); }
function transformFor(action, text, { formal, casual } = {}) {
  if (action === 'capitalize') return titleCase(text);
  if (action === 'allcaps') return text.toUpperCase();
  if (action === 'formal') return formal ? formal(text) : text;
  if (action === 'casual') return casual ? casual(text) : text;
  return text;
}

const LABELS = { delete: 'Deleted', undo: 'Undone', newline: 'New line', paragraph: 'New paragraph', capitalize: 'Capitalized', allcaps: 'All caps', formal: 'Made formal', casual: 'Made casual', note: 'Saved note' };

module.exports = { ACTIONS, DEFAULT_COMMANDS, DEFAULT_NOTE_TRIGGERS, LABELS, matchCommand, matchNote, isCommandPrefix, words, norm, titleCase, transformFor };
