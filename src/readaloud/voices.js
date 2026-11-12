'use strict';
/* The English voices of the Kokoro v1.0 multi-lang pack, with their speaker ids (the pack's own id2speaker table, read from the model's
   metadata: 26 = bm_george). Default: bm_george ("Bob"). The other languages in the pack are left out on purpose: Dutch is not among them,
   and a voice reading text in a language it was not made for sounds wrong. */
const DEFAULT_VOICE = 'bm_george';

const VOICES = [
  ['af_alloy', 0, 'Alloy', 'American', 'female'], ['af_aoede', 1, 'Aoede', 'American', 'female'], ['af_bella', 2, 'Bella', 'American', 'female'],
  ['af_heart', 3, 'Heart', 'American', 'female'], ['af_jessica', 4, 'Jessica', 'American', 'female'], ['af_kore', 5, 'Kore', 'American', 'female'],
  ['af_nicole', 6, 'Nicole', 'American', 'female'], ['af_nova', 7, 'Nova', 'American', 'female'], ['af_river', 8, 'River', 'American', 'female'],
  ['af_sarah', 9, 'Sarah', 'American', 'female'], ['af_sky', 10, 'Sky', 'American', 'female'],
  ['am_adam', 11, 'Adam', 'American', 'male'], ['am_echo', 12, 'Echo', 'American', 'male'], ['am_eric', 13, 'Eric', 'American', 'male'],
  ['am_fenrir', 14, 'Fenrir', 'American', 'male'], ['am_liam', 15, 'Liam', 'American', 'male'], ['am_michael', 16, 'Michael', 'American', 'male'],
  ['am_onyx', 17, 'Onyx', 'American', 'male'], ['am_puck', 18, 'Puck', 'American', 'male'], ['am_santa', 19, 'Santa', 'American', 'male'],
  ['bf_alice', 20, 'Alice', 'British', 'female'], ['bf_emma', 21, 'Emma', 'British', 'female'], ['bf_isabella', 22, 'Isabella', 'British', 'female'], ['bf_lily', 23, 'Lily', 'British', 'female'],
  ['bm_daniel', 24, 'Daniel', 'British', 'male'], ['bm_fable', 25, 'Fable', 'British', 'male'], ['bm_george', 26, 'George', 'British', 'male'], ['bm_lewis', 27, 'Lewis', 'British', 'male'],
].map(([id, sid, name, accent, gender]) => ({ id, sid, name, accent, gender, label: `${name} (${accent}, ${gender})${id === DEFAULT_VOICE ? ', default' : ''}` }));

const byId = new Map(VOICES.map((v) => [v.id, v]));
const isVoice = (id) => byId.has(id);
const sidOf = (id) => (byId.get(id) || byId.get(DEFAULT_VOICE)).sid;

module.exports = { VOICES, DEFAULT_VOICE, isVoice, sidOf };
