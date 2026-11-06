'use strict';
/* The one-string Sync code: round trip, expiry, damaged and forged strings, secret keys refused both ways. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const crypto = require('crypto');
const { root } = require('./util');
const { encode, decode, PREFIX } = require(path.join(root, 'src/sync/setup-code.js'));

const URL_ = 'https://abcdefgh.supabase.co', KEY = 'sb_publishable_abc123', NOW = 1800000000000;
const good = () => encode({ url: URL_, key: KEY, code: 'abc-234', expiresAt: NOW + 600000 });
const jwt = (role) => 'h.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.s';
/** a code with a valid check value around any body, as a forger would make */
const forge = (obj) => {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return PREFIX + body + '.' + crypto.createHash('sha256').update(body).digest('base64url').slice(0, 6);
};
const E = Math.floor((NOW + 600000) / 1000);

test('round trip: URL, key, normalised link code and expiry come back', () => {
  const g = good();
  assert.ok(g.code.startsWith(PREFIX));
  assert.deepStrictEqual(decode(g.code, NOW), { url: URL_, key: KEY, code: 'ABC234', expiresAt: NOW + 600000 });
  assert.ok(g.code.length < 400, 'short enough to paste');
});
test('pasting tolerates spaces, line breaks and quotes', () => {
  const g = good().code;
  assert.equal(decode(`  "${g.slice(0, 20)}\r\n ${g.slice(20)}"  `, NOW).code, 'ABC234');
});
test('expired: refused with a message and flagged; the boundary second counts as expired', () => {
  const g = good().code;
  const late = decode(g, NOW + 600001);
  assert.equal(late.expired, true);
  assert.match(late.error, /expired.*Create a new one/);
  assert.equal(decode(g, NOW + 600000).expired, true);
  assert.ok(decode(g, NOW + 599000).url);
});
test('malformed input: empty, wrong prefix, truncated, extra parts, not base64, not JSON', () => {
  const g = good().code;
  assert.match(decode('', NOW).error, /Paste the Sync code/);
  for (const bad of ['hello', 'PFS1-', 'PFS1-abc', g.slice(0, -3), g + '.x', 'PFS2-' + g.slice(5), 'ABC-234', PREFIX + '!!!.xxxxxx', g.replace(PREFIX, '')]) {
    const r = decode(bad, NOW);
    assert.ok(r.error, bad);
    assert.equal(r.url, undefined);
  }
  assert.match(decode('x'.repeat(5000), NOW).error, /not a Sync code/);
  assert.match(decode(forge('just a string'), NOW).error, /not a Sync code/);
  assert.match(decode(forge({ u: URL_ }), NOW).error, /not a Sync code/);
  assert.match(decode(forge([1, 2]), NOW).error, /not a Sync code/);
});
test('tampered: a changed character fails the check; a changed URL with a fixed check still must be a clean https origin', () => {
  const g = good().code;
  const i = PREFIX.length + 10;
  const t = g.slice(0, i) + (g[i] === 'A' ? 'B' : 'A') + g.slice(i + 1);
  assert.match(decode(t, NOW).error, /damaged or was edited/);
  assert.match(decode(forge({ u: 'https://evil.example/path?x=1', k: KEY, c: 'ABC234', e: E }), NOW).error, /not a Sync code/);
  assert.match(decode(forge({ u: 'http://evil.example', k: KEY, c: 'ABC234', e: E }), NOW).error, /not a Sync code/);
  assert.match(decode(forge({ u: URL_, k: KEY, c: 'ABC23', e: E }), NOW).error, /not a Sync code/);
  assert.match(decode(forge({ u: URL_, k: KEY, c: 'ABC234', e: 'soon' }), NOW).error, /not a Sync code/);
});
test('a secret or service-role key is refused when decoding, even with a valid check', () => {
  for (const k of ['sb_secret_abcdefg', jwt('service_role'), jwt('authenticated'), 'not a key']) {
    const r = decode(forge({ u: URL_, k, c: 'ABC234', e: E }), NOW);
    assert.ok(r.error, k);
    assert.equal(r.key, undefined);
  }
  assert.match(decode(forge({ u: URL_, k: 'sb_secret_abcdefg', c: 'ABC234', e: E }), NOW).error, /must not be shared.*SECRET key/);
  assert.ok(decode(forge({ u: URL_, k: jwt('anon'), c: 'ABC234', e: E }), NOW).url, 'a legacy anon key is fine');
});
test('a secret or service-role key never goes INTO a code', () => {
  for (const key of ['sb_secret_abcdefg', jwt('service_role'), '', 'junk']) {
    const r = encode({ url: URL_, key, code: 'ABC234', expiresAt: NOW });
    assert.ok(r.error, key);
    assert.equal(r.code, undefined);
  }
  assert.ok(encode({ url: 'http://evil.example', key: KEY, code: 'ABC234', expiresAt: NOW }).error);
  assert.ok(encode({ url: URL_, key: KEY, code: 'ab', expiresAt: NOW }).error);
  assert.ok(encode({ url: URL_, key: KEY, code: 'ABC234', expiresAt: NaN }).error);
});
