'use strict';
/* SyncService with the real Store, SlangService and SecretStore on temp folders, against an in-memory server. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');
const dns = require('dns');
const path = require('path');
const { makeInstall, fakeServer, tmp, root } = require('./util');
const { SyncService } = require(path.join(root, 'src/sync/service.js'));

const URL_ = 'https://example-project.supabase.co', KEY = 'sb_publishable_test';
const on = (o = {}) => { const s = o.server || fakeServer(); return { ...makeInstall({ fetchImpl: s.fetchImpl, url: URL_, key: KEY, enabled: true, ...o }), server: s }; };
const near = (s, k) => s.state.keys[k];

/* ---------- off means off ---------- */
test('off: no call of any kind leaves the process, whatever the app and the Settings page do', async () => {
  const hits = [];
  const orig = { connect: net.Socket.prototype.connect, tlsc: tls.connect, hr: http.request, hsr: https.request, look: dns.lookup, fetch: global.fetch };
  net.Socket.prototype.connect = function (...a) { hits.push('net.connect'); return orig.connect.apply(this, a); };
  tls.connect = (...a) => { hits.push('tls.connect'); return orig.tlsc(...a); };
  http.request = (...a) => { hits.push('http'); return orig.hr(...a); };
  https.request = (...a) => { hits.push('https'); return orig.hsr(...a); };
  dns.lookup = (...a) => { hits.push('dns'); return orig.look(...a); };
  global.fetch = async () => { hits.push('fetch'); throw new Error('no'); };
  const s = fakeServer();
  let injected = 0;
  try {
    for (const fetchImpl of [undefined, async (...a) => { injected++; return s.fetchImpl(...a); }]) {
      const i = makeInstall({ fetchImpl });
      // a project is set up, sync is off (the default)
      assert.equal(i.store.get().sync.enabled, false);
      assert.equal(i.sync.configure({ url: URL_, key: KEY }).ok, true);
      i.sync.start();
      i.sync.notifyLocalChange();
      i.store.set({ trailingSpace: true });
      i.slang.addTerm({ term: 'rizz', bias: 60 });
      await i.sync.syncNow();
      assert.equal((await i.sync.createCode()).ok, false);
      assert.equal((await i.sync.join('ABC-234')).ok, false);
      assert.equal((await i.sync.unlink()).ok, false);
      i.sync.status();
      i.sync.restoreBackup();
      await new Promise((r) => setTimeout(r, 60));
      assert.equal(i.sync.timer, null, 'no timer');
      assert.equal(i.sync.poll, null, 'no poll');
      assert.ok(!fs.existsSync(path.join(i.dir, 'sync-state.json')), 'no sync state written while off');
    }
    assert.deepStrictEqual(hits, []);
    assert.equal(injected, 0);
    assert.equal(s.calls.length, 0);
  } finally {
    net.Socket.prototype.connect = orig.connect; tls.connect = orig.tlsc; http.request = orig.hr; https.request = orig.hsr; dns.lookup = orig.look; global.fetch = orig.fetch;
  }
});

test('switching off stops the network again, and a stale cycle cannot start', async () => {
  const a = on();
  await a.sync.syncNow();
  const n = a.server.calls.length;
  assert.ok(n > 0);
  a.sync.setEnabled(false);
  a.store.set({ trailingSpace: true });
  await a.sync.syncNow();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(a.server.calls.length, n);
});

test('a settings file from before sync loads with sync off; Store behaves the same without a listener', () => {
  const d = tmp('old');
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ gestureV: 3, hotkeyV: 2, trailingSpace: true }));
  const { Store } = require(path.join(root, 'src/main/settings.js'));
  const st = new Store(d);
  assert.equal(st.get().sync.enabled, false);
  assert.equal(st.get().trailingSpace, true);
  assert.equal(st.set({ trailingSpace: false }).trailingSpace, false);
});

/* ---------- what is sent, on the wire ---------- */
test('every byte sent while syncing is free of canaries seeded in dictation, notes, meetings, secrets, logs and device settings', async () => {
  const C = 'CANARY91c';
  const s = fakeServer();
  const dir = tmp('canary');
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'history.json'), JSON.stringify([{ id: 'a', ts: 1, text: C + 'dictated' }]));
  fs.writeFileSync(path.join(dir, 'notes.jsonl'), JSON.stringify({ id: 'n', ts: 1, text: C + 'note' }) + '\n');
  fs.writeFileSync(path.join(dir, 'meetings.json'), JSON.stringify([{ id: 'm', title: C + 'meeting', transcript: C }]));
  fs.writeFileSync(path.join(dir, 'logs', 'app.log'), C + 'log');
  const a = makeInstall({ fetchImpl: s.fetchImpl, dir, url: URL_, key: KEY, pre: {
    micId: C + 'mic', userName: C + 'name', historyEnabled: true, snippets: [{ trigger: 'x', expansion: C + 'snip' }], deny: [C + 'deny'],
    notes: { notion: { enabled: true, targetId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', titleProperty: C + 'prop' }, export: { enabled: true, folder: 'C:\\' + C } },
  } });
  a.secrets.set('notion', C + 'notiontoken');
  a.slang.addTerm({ term: 'rizz', bias: 60 });
  assert.equal(a.sync.setEnabled(true).ok, true); a.sync.stop();
  await a.sync.syncNow();
  const code = await a.sync.createCode();
  assert.equal(code.ok, true);
  const wire = JSON.stringify(s.calls.map((c) => ({ url: c.url, body: c.body })));
  assert.ok(!wire.includes(C), 'canary on the wire at: ' + wire.slice(wire.indexOf(C) - 80, wire.indexOf(C) + 20));
  const row = s.db.rows[0];
  assert.ok(row.doc.keys['word:rizz'], 'the word itself did go');
  // this PC's name is not customization
  assert.deepStrictEqual(s.calls.find((c) => c.url.includes('/installs')).body.includes('"machine":null'), true);
  // and the local state file holds no token
  const state = fs.readFileSync(path.join(dir, 'sync-state.json'), 'utf8');
  assert.ok(!/TOKEN/.test(state) && !state.includes(C + 'mic'));
});

test('tokens, URL and key live in secrets.json encrypted, never in settings.json; the page never sees key or tokens', async () => {
  const a = on();
  await a.sync.syncNow();
  const settings = fs.readFileSync(path.join(a.dir, 'settings.json'), 'utf8');
  assert.ok(!/TOKEN|sb_publishable|supabase/i.test(settings), 'settings.json is clean');
  assert.deepStrictEqual(JSON.parse(settings).sync, { enabled: true });
  const raw = fs.readFileSync(path.join(a.dir, 'secrets.json'), 'utf8');
  assert.ok(!/TOKEN|sb_publishable/.test(raw), 'encrypted on disk');
  const st = JSON.stringify(a.sync.status());
  assert.ok(!/TOKEN|sb_publishable/.test(st), 'status has no secret');
  assert.match(a.sync.status().installId, /^0{8}-/);
});

test('a secret or service-role key is refused and nothing is stored', () => {
  const a = makeInstall({});
  assert.match(a.sync.configure({ url: URL_, key: 'sb_secret_x' }).error, /SECRET/);
  const jwt = ['e30', Buffer.from('{"role":"service_role"}').toString('base64url'), 's'].join('.');
  assert.match(a.sync.configure({ url: URL_, key: jwt }).error, /SERVICE ROLE/);
  assert.equal(a.secrets.has('sync'), false);
  assert.match(a.sync.setEnabled(true).error, /first/);
  assert.equal(a.store.get().sync.enabled, false);
});

test('without secure storage sync refuses instead of storing anything in clear', () => {
  const d = tmp('noenc');
  const i = makeInstall({ dir: d });
  i.secrets.ss = { isEncryptionAvailable: () => false };
  assert.match(i.sync.configure({ url: URL_, key: KEY }).error, /Secure storage/);
  assert.ok(!fs.existsSync(path.join(d, 'secrets.json')));
});

/* ---------- two installs ---------- */
async function linked(opts = {}) {
  const server = fakeServer();
  const A = on({ server, ...opts.a }), B = on({ server, ...opts.b });
  await A.sync.syncNow();
  const code = await A.sync.createCode();
  assert.equal(code.ok, true);
  const j = await B.sync.join(code.code);
  assert.equal(j.ok, true, j.error);
  await A.sync.syncNow();
  return { server, A, B };
}

test('a word with its bias goes from A to B, a setting too, and a delete follows', async () => {
  const { A, B } = await linked();
  A.slang.addTerm({ term: 'Rizz', bias: 75, variants: ['riz'] });
  A.store.set({ tone: { enabled: true, apps: [{ match: 'discord', profile: 'casual' }] } });
  await A.sync.syncNow(); await B.sync.syncNow();
  const t = B.slang.mineTerms().find((x) => x.term === 'Rizz');
  assert.equal(t.bias, 75);
  assert.deepStrictEqual(t.variants, ['riz']);
  assert.equal(B.slang.apply('so riz'), 'so Rizz', 'the matcher knows the synced word');
  assert.deepStrictEqual(B.store.get().tone.apps, [{ match: 'discord', profile: 'casual' }]);
  B.slang.removeTerm('Rizz');
  await B.sync.syncNow(); await A.sync.syncNow();
  assert.equal(A.slang.mineTerms().length, 0);
});

test('device values stay put when a linked install syncs', async () => {
  const { A, B } = await linked({ a: { pre: { micId: 'mic-A', threads: 4 } }, b: { pre: { micId: 'mic-B', threads: 2, userName: 'bee' } } });
  A.store.set({ trailingSpace: true });
  await A.sync.syncNow(); await B.sync.syncNow();
  assert.equal(B.store.get().trailingSpace, true);
  assert.equal(B.store.get().micId, 'mic-B');
  assert.equal(B.store.get().threads, 2);
  assert.equal(B.store.get().userName, 'bee');
});

test('a fresh install does not overwrite customization with its defaults, and its own words are kept', async () => {
  const server = fakeServer();
  const A = on({ server, pre: { tone: { enabled: false, apps: [] } } });
  A.slang.addTerm({ term: 'alpha' });
  await A.sync.syncNow();
  const B = on({ server });
  B.slang.addTerm({ term: 'beta' });
  const code = await A.sync.createCode();
  assert.equal((await B.sync.join(code.code)).ok, true);
  await A.sync.syncNow(); await B.sync.syncNow();
  assert.equal(B.store.get().tone.enabled, false, 'A\'s choice reached B');
  assert.equal(A.store.get().tone.enabled, false, 'B\'s default did not beat it');
  assert.ok(A.slang.mineTerms().some((t) => t.term === 'beta'), 'B\'s word reached A');
  assert.ok(B.slang.mineTerms().some((t) => t.term === 'alpha'));
});

test('a local backup is written before the first pull, holds what was here, and Restore puts it back', async () => {
  const server = fakeServer();
  let clock = 1000000;
  const A = on({ server, now: () => clock });
  A.store.set({ liveMode: 'stable' });
  await A.sync.syncNow();
  clock += 1000;
  const B = on({ server, now: () => clock, pre: { trailingSpace: true } });
  B.slang.addTerm({ term: 'keepme', bias: 30 });
  B.store.set({ liveMode: 'aggressive' });
  const beforeSettings = 'aggressive';
  const code = await A.sync.createCode();
  clock += 1000;
  A.store.set({ liveMode: 'stable', trailingSpace: false, tone: { enabled: false, apps: [] } });
  await A.sync.syncNow();
  clock += 1000;
  assert.equal((await B.sync.join(code.code)).ok, true);
  assert.equal(B.sync.status().backup, '', 'the group row is still empty: nothing to pull, nothing replaced');
  await A.sync.syncNow();
  clock += 1000;
  await B.sync.syncNow();
  const st = B.sync.status();
  assert.ok(st.backup && fs.existsSync(st.backup), 'a backup file exists');
  const bk = JSON.parse(fs.readFileSync(st.backup, 'utf8'));
  assert.equal(bk.keys['word:keepme'].bias, 30);
  assert.equal(bk.keys['tone.enabled'], true);
  assert.equal(bk.keys.trailingSpace, true);
  assert.equal(beforeSettings, 'aggressive');
  assert.equal(B.store.get().tone.enabled, false, 'the pull did happen');
  assert.ok(!JSON.stringify(bk).includes('micId'));
  clock += 1000;
  assert.equal(B.sync.restoreBackup().ok, true);
  assert.equal(B.store.get().tone.enabled, true);
  await B.sync.syncNow(); await A.sync.syncNow();
  assert.equal(A.store.get().tone.enabled, true, 'a restore is a new edit and wins everywhere');
});

test('an install reading back only its own upload makes no backup', async () => {
  const a = on();
  await a.sync.syncNow();
  await a.sync.syncNow();
  a.sync.stop();
  assert.equal(a.server.db.rows.length, 1);
  assert.equal(a.sync.status().backup, '');
});

test('both PCs changed one key offline: newest wins, the other value is listed visibly, other keys survive', async () => {
  let clock = 2000000;
  const server = fakeServer();
  const { A, B } = await linked({ a: { server, now: () => clock }, b: { server, now: () => clock } });
  clock += 1000;
  A.store.set({ liveMode: 'stable', translate: { enabled: false, target: 'en' } });
  clock += 1000;
  B.store.set({ liveMode: 'aggressive', trailingSpace: true });
  // make the value really differ from the default on the later side
  clock += 1000;
  B.store.set({ commands: { ...B.store.get().commands, carryMs: 5000 } });
  clock += 1000;
  A.store.set({ commands: { ...A.store.get().commands, carryMs: 9000 } });
  await B.sync.syncNow(); await A.sync.syncNow(); await B.sync.syncNow();
  assert.equal(A.store.get().commands.carryMs, 9000);
  assert.equal(B.store.get().commands.carryMs, 9000, 'the later edit won on both');
  assert.equal(A.store.get().trailingSpace, true, 'B\'s other key reached A');
  assert.equal(B.store.get().translate.target, 'en', 'A\'s other key reached B');
  const c = A.sync.status().conflicts.find((x) => x.label === 'commands.carryMs');
  assert.ok(c, 'the conflict shows in the status: ' + JSON.stringify(A.sync.status().conflicts));
  assert.match(c.lost, /5000/);
  assert.equal(c.kept, 'this');
});

test('a linked install cannot push a forbidden key onto this PC', async () => {
  const { server, A, B } = await linked();
  await B.sync.syncNow();
  const row = server.db.rows.find((r) => r.group_id);
  row.doc.keys.micId = { v: 'evil-mic', t: Date.now() + 1000, by: 'x' };
  row.doc.keys['notes.notion.targetId'] = { v: 'evil', t: Date.now() + 1000, by: 'x' };
  row.version++;
  await A.sync.syncNow();
  assert.notEqual(A.store.get().micId, 'evil-mic');
  assert.equal(A.store.get().notes.notion.targetId, '');
  assert.ok(!('micId' in server.db.rows.find((r) => r.group_id).doc.keys), 'and the next upload drops it');
});

test('a malformed value from the server is corrected, not kept, and does not break anything', async () => {
  const { server, A } = await linked();
  const row = server.db.rows.find((r) => r.group_id);
  row.doc.keys.liveMode = { v: 'nonsense', t: Date.now() + 1000, by: 'x' };
  row.doc.keys.hotkey = { v: { vks: 'not an array' }, t: Date.now() + 1000, by: 'x' };
  await A.sync.syncNow();
  assert.equal(A.store.get().liveMode, 'aggressive');
  assert.deepStrictEqual(A.store.get().hotkey.vks, [0x11, 0x20]);
  assert.equal(server.db.rows.find((r) => r.group_id).doc.keys.liveMode.v, 'aggressive');
});

test('a document from a newer app version is left alone, with a message', async () => {
  const a = on();
  await a.sync.syncNow();
  const row = a.server.db.rows[0], before = JSON.stringify({ schema: 2, keys: { future: 1 } });
  row.doc = JSON.parse(before);
  assert.equal(await a.sync.syncNow(), false);
  a.sync.stop();
  assert.equal(JSON.stringify(row.doc), before);
  assert.match(a.sync.status().lastError, /newer app version/);
});

test('after a link code the creator polls quickly until someone joined, then stops', async () => {
  const { A } = await linked();
  assert.equal(A.sync.waitForJoin, false, 'joined: the quick polling ended');
  assert.equal(A.sync.fastUntil, 0);
  const server = fakeServer();
  const C = on({ server });
  await C.sync.syncNow();
  assert.equal((await C.sync.createCode()).ok, true);
  assert.ok(C.sync.waitForJoin && C.sync.fastUntil > Date.now() && C.sync.timer);
  C.sync.setEnabled(false);
  assert.equal(C.sync.timer, null, 'switching off ends it');
  A.sync.stop();
});

/* ---------- offline ---------- */
test('server down: the app works, the edit is queued, and it goes up when the server is back', async () => {
  const a = on();
  await a.sync.syncNow();
  a.server.setDown(true);
  a.store.set({ trailingSpace: true });
  a.slang.addTerm({ term: 'offline', bias: 20 });
  a.sync.notifyLocalChange();
  assert.equal(await a.sync.syncNow(), false);
  const st = a.sync.status();
  assert.match(st.lastError, /reach/);
  assert.ok(st.waiting >= 2, 'the changes wait: ' + st.waiting);
  assert.ok(st.nextRetryAt > Date.now(), 'a retry is planned');
  assert.equal(a.store.get().trailingSpace, true, 'the setting applied locally');
  assert.ok(a.slang.mineTerms().some((t) => t.term === 'offline'));
  // a restart while offline loses nothing
  const again = new SyncService({ dir: a.dir, store: a.store, secrets: a.secrets, slang: a.slang, fetchImpl: a.server.fetchImpl, version: '0.2.61', debounceMs: 5 });
  a.sync.stop();
  a.server.setDown(false);
  assert.equal(await again.syncNow(), true);
  again.stop();
  const row = a.server.db.rows[0];
  assert.equal(row.doc.keys.trailingSpace.v, true);
  assert.equal(row.doc.keys['word:offline'].v.bias, 20);
  assert.equal(again.status().lastError, '');
  assert.equal(again.status().waiting, 0);
});

test('backoff grows and a failing server is not hammered by local edits', async () => {
  const a = on();
  a.server.setDown(true);
  await a.sync.syncNow();
  const r1 = a.sync.nextRetryAt;
  await a.sync.syncNow();
  assert.ok(a.sync.nextRetryAt > r1, 'second failure waits longer');
  const n = a.server.calls.length;
  a.store.set({ trailingSpace: true });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(a.server.calls.length, n, 'an edit during backoff waits for the retry');
  a.sync.stop();
});

test('a server error is reported, not thrown; bad JSON from the server does not break the cycle', async () => {
  const a = on();
  const real = a.server.fetchImpl;
  a.sync.client = null;
  a.sync.fetchImpl = async (u, i) => (String(u).includes('customization') ? { ok: true, status: 200, text: async () => '<html>' } : real(u, i));
  await a.sync.syncNow();
  a.sync.stop();
  assert.equal(a.store.get().sync.enabled, true);
});

test('an update that races another install is merged and sent again, nothing is overwritten', async () => {
  const server = fakeServer();
  const a = on({ server });
  await a.sync.syncNow();
  const real = server.fetchImpl;
  let raced = false;
  a.sync.client = null;
  a.sync.fetchImpl = async (u, i) => {
    if (!raced && i.method === 'PATCH') { raced = true; const r = server.db.rows[0]; r.doc = { schema: 1, keys: { ...r.doc.keys, 'word:other': { v: { term: 'other' }, t: Date.now(), by: 'zz' } } }; r.version++; }
    return real(u, i);
  };
  a.store.set({ trailingSpace: true });
  assert.equal(await a.sync.syncNow(), true);
  a.sync.stop();
  const doc = server.db.rows[0].doc;
  assert.ok(doc.keys['word:other'], 'the other write survived');
  assert.equal(doc.keys.trailingSpace.v, true, 'mine got in');
  assert.ok(a.slang.mineTerms().some((t) => t.term === 'other'));
});

test('during a dictation nothing is applied; it comes after', async () => {
  const { A, B } = await linked();
  A.store.set({ trailingSpace: true });
  await A.sync.syncNow();
  B.sync.isBusy = () => true;
  assert.equal(await B.sync.syncNow(), false);
  assert.equal(B.store.get().trailingSpace, false);
  B.sync.isBusy = () => false;
  assert.equal(await B.sync.syncNow(), true);
  assert.equal(B.store.get().trailingSpace, true);
  B.sync.stop();
});

test('applied changes reach the app through onApplied, and do not echo as a new local edit', async () => {
  const { A, B } = await linked();
  let applied = 0;
  B.sync.onApplied = () => { applied++; };
  A.store.set({ trailingSpace: true });
  await A.sync.syncNow(); await B.sync.syncNow();
  assert.equal(applied, 1);
  assert.equal(B.sync.state.keys.trailingSpace.by, near(A.sync, 'trailingSpace').by, 'the stamp stays A\'s');
  assert.equal(B.sync.state.keys.trailingSpace.t, near(A.sync, 'trailingSpace').t);
});

test('unlink keeps every local value, and later edits do not reach the old partner', async () => {
  const { A, B } = await linked();
  A.slang.addTerm({ term: 'shared' });
  await A.sync.syncNow(); await B.sync.syncNow();
  const stB = B.sync.status();
  assert.equal(stB.linked, true);
  assert.equal(stB.members.length, 2);
  assert.equal((await B.sync.unlink()).ok, true);
  assert.equal(B.sync.status().linked, false);
  assert.ok(B.slang.mineTerms().some((t) => t.term === 'shared'), 'kept');
  A.slang.addTerm({ term: 'afterwards' });
  await A.sync.syncNow(); await B.sync.syncNow();
  assert.ok(!B.slang.mineTerms().some((t) => t.term === 'afterwards'));
});

test('a stranger with a valid sign-in sees nothing without a code', async () => {
  const { server, A } = await linked();
  A.slang.addTerm({ term: 'private' });
  await A.sync.syncNow();
  const C = on({ server });
  await C.sync.syncNow();
  assert.ok(!C.slang.mineTerms().some((t) => t.term === 'private'));
  assert.equal(C.sync.status().linked, false);
});

test('bad join codes give a message and do not touch the network when they cannot be codes', async () => {
  const a = on();
  await a.sync.syncNow();
  const n = a.server.calls.length;
  assert.match((await a.sync.join('nope')).error, /6 letters/);
  assert.equal(a.server.calls.length, n);
  assert.match((await a.sync.join('ZZZ-ZZZ')).error, /invalid/);
});
