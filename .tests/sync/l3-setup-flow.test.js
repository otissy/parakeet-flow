'use strict';
/* The one-string setup end to end between two installs, against the in-memory fake server (nothing leaves this process, no real project). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { makeInstall, fakeServer, root } = require('./util');
const { encode, decode } = require(path.join(root, 'src/sync/setup-code.js'));

const URL_ = 'https://example-project.supabase.co', KEY = 'sb_publishable_test';
const pc = (server, o = {}) => makeInstall({ fetchImpl: server.fetchImpl, ...o });
const withName = (i, defaultName) => { i.sync.defaultName = defaultName; return i; };

async function firstPc(server) {
  const a = pc(server, { url: URL_, key: KEY, enabled: true });
  a.store.set({ trailingSpace: true });
  a.slang.addTerm({ term: 'rizz', bias: 60 });
  await a.sync.syncNow();
  return a;
}

test('first PC makes one Sync code; a bare second PC pastes only that, and is configured, switched on and linked', async () => {
  const server = fakeServer();
  const a = await firstPc(server);
  const made = await a.sync.createSetupCode();
  assert.equal(made.ok, true);
  assert.ok(made.setupCode.startsWith('PFS1-'));
  assert.ok(made.expiresAtMs > Date.now());
  const d = decode(made.setupCode);
  assert.deepStrictEqual([d.url, d.key], [URL_, KEY]);
  assert.equal(made.setupCode.includes('TOKEN'), false, 'no token in the code');

  const b = pc(server);                                 // nothing configured, sync off
  assert.equal(b.sync.status().configured, false);
  const r = await b.sync.joinSetup(made.setupCode);
  assert.deepStrictEqual(r, { ok: true });
  const st = b.sync.status();
  assert.equal(st.enabled, true);
  assert.equal(st.configured, true);
  assert.equal(st.url, URL_);
  assert.equal(st.linked, true);
  assert.equal(b.store.get().sync.enabled, true);
  await a.sync.syncNow(); await b.sync.syncNow();       // the first PC moves its data into the group, the second picks it up
  assert.equal(b.store.get().trailingSpace, true, 'the first PC setting arrived');
  assert.ok(b.slang.mineTerms().some((t) => t.term === 'rizz'), 'and its word');
  assert.equal(a.sync.status().linked, true);
  assert.equal(fs.readFileSync(path.join(b.dir, 'secrets.json'), 'utf8').includes(KEY), false, 'the key is stored encrypted');
  assert.equal(fs.readFileSync(path.join(b.dir, 'settings.json'), 'utf8').includes(KEY), false);
  a.sync.stop(); b.sync.stop();
});

test('reuse: the same Sync code a second time says the code is used or expired, and the third PC is left as it was', async () => {
  const server = fakeServer();
  const a = await firstPc(server);
  const code = (await a.sync.createSetupCode()).setupCode;
  const b = pc(server), c = pc(server);
  assert.equal((await b.sync.joinSetup(code)).ok, true);
  const r = await c.sync.joinSetup(code);
  assert.equal(r.ok, false);
  assert.match(r.error, /used or expired/);
  const st = c.sync.status();
  assert.deepStrictEqual([st.enabled, st.configured, st.linked], [false, false, false], 'nothing half-set-up is left behind');
  assert.equal(c.store.get().sync.enabled, false);
  assert.equal(c.secrets.has('sync'), false);
  a.sync.stop(); b.sync.stop(); c.sync.stop();
});

test('expired by the clock: refused before any network call, whatever the server would say', async () => {
  const server = fakeServer();
  const old = encode({ url: URL_, key: KEY, code: 'ABC234', expiresAt: Date.now() - 1000 }).code;
  const b = pc(server);
  const r = await b.sync.joinSetup(old);
  assert.equal(r.ok, false);
  assert.equal(r.expired, true);
  assert.match(r.error, /expired/);
  assert.equal(server.calls.length, 0);
  assert.equal(b.secrets.has('sync'), false);
});

test('damaged, forged and secret-key codes are refused without storing or contacting anything', async () => {
  const server = fakeServer();
  const b = pc(server);
  const good = encode({ url: URL_, key: KEY, code: 'ABC234', expiresAt: Date.now() + 60000 }).code;
  const forged = (k) => {
    const body = Buffer.from(JSON.stringify({ u: URL_, k, c: 'ABC234', e: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
    return 'PFS1-' + body + '.' + crypto.createHash('sha256').update(body).digest('base64url').slice(0, 6);
  };
  const svc = 'h.' + Buffer.from('{"role":"service_role"}').toString('base64url') + '.s';
  for (const bad of ['', 'nonsense', good.slice(0, -4), good.slice(0, 30) + 'x' + good.slice(31), forged('sb_secret_zzz'), forged(svc)]) {
    const r = await b.sync.joinSetup(bad);
    assert.equal(r.ok, false, bad);
    assert.equal(r.refused, true);
  }
  assert.equal(server.calls.length, 0);
  assert.equal(b.secrets.has('sync'), false);
  assert.equal(b.sync.enabled(), false);
});

test('a PC that already has a project and is on goes back to it exactly when the new code fails', async () => {
  const server = fakeServer(), other = fakeServer();
  const b = pc(server, { url: URL_, key: KEY, enabled: true });
  const before = JSON.parse(b.secrets.get('sync'));
  const mk = encode({ url: 'https://second-project.supabase.co', key: 'sb_publishable_other', code: 'ZZZ222', expiresAt: Date.now() + 60000 }).code;
  b.sync.fetchImpl = other.fetchImpl; b.sync.client = null;
  const r = await b.sync.joinSetup(mk);
  assert.equal(r.ok, false);
  const after = JSON.parse(b.secrets.get('sync'));
  assert.equal(after.url, URL_, 'the old project is back');
  assert.equal(after.key, before.key);
  assert.equal(b.sync.enabled(), true);
  b.sync.stop();
});

test('the app never builds a code from a secret key stored by mistake', async () => {
  const server = fakeServer();
  const a = await firstPc(server);
  a.secrets.set('sync', JSON.stringify({ ...JSON.parse(a.secrets.get('sync')), key: 'sb_secret_oops' }));
  const r = await a.sync.createSetupCode();
  assert.equal(r.ok, false);
  assert.equal(r.setupCode, undefined);
  a.sync.stop();
});

test('naming: the Windows computer name is the default and goes up; a typed name replaces it; emptied sends none', async () => {
  const server = fakeServer();
  const a = withName(pc(server, { url: URL_, key: KEY, enabled: true }), 'DESKTOP-OTIS');
  assert.equal(a.sync.status().name, 'DESKTOP-OTIS');
  assert.equal(a.sync.status().nameIsDefault, true);
  await a.sync.syncNow();
  const id = a.sync._cred().session.installId;
  assert.equal(server.db.installs.get(id).name, 'DESKTOP-OTIS');
  assert.equal(server.db.installs.get(id).machine, null);
  a.sync.setName('Desk PC');
  await a.sync.syncNow();
  assert.equal(server.db.installs.get(id).name, 'Desk PC');
  assert.equal(a.sync.status().nameIsDefault, false);
  a.sync.setName('   ');
  await a.sync.syncNow();
  assert.equal(server.db.installs.get(id).name, null);
  assert.equal(a.sync.status().name, '');
  a.sync.setName('x\u0000y\n'.repeat(30));
  assert.ok(a.sync.status().name.length <= 40);
  assert.equal(/[\u0000-\u001f]/.test(a.sync.status().name), false);
  a.sync.stop();
});

test('naming: the linked PC shows up by its name, not only an ID', async () => {
  const server = fakeServer();
  const a = withName(await firstPc(server), 'PC-ONE');
  a.sync.state.registered = '';
  const b = withName(pc(server), 'LAPTOP-TWO');
  const code = (await a.sync.createSetupCode()).setupCode;
  assert.equal((await b.sync.joinSetup(code)).ok, true);
  await a.sync.syncNow();
  assert.deepStrictEqual(a.sync.status().members.filter((m) => !m.isMe).map((m) => m.name), ['LAPTOP-TWO']);
  a.sync.stop(); b.sync.stop();
});
