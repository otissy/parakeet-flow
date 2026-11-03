'use strict';
/* Shared by the sync tests: a real Store, SlangService and SyncService on a temp folder, an in-memory secret store, and a small fake of
   the Supabase REST API that keeps the rules the real schema has (one group per install, RLS on customization, version on update). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { Store } = require(path.join(root, 'src/main/settings.js'));
const { SecretStore } = require(path.join(root, 'src/main/secret.js'));
const { SlangService } = require(path.join(root, 'src/slang/service.js'));
const { SyncService } = require(path.join(root, 'src/sync/service.js'));

const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('enc:' + Buffer.from(s).toString('hex')), decryptString: (b) => Buffer.from(b.toString().slice(4), 'hex').toString() };
const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-sync-' + label + '-'));

function makeInstall({ fetchImpl, dir = tmp('i'), pre = {}, enabled = false, url, key, now } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  if (Object.keys(pre).length) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(pre));
  const store = new Store(dir);
  const secrets = new SecretStore(path.join(dir, 'secrets.json'), safeStorage);
  const slang = new SlangService({ builtinDir: path.join(root, 'src/slang/packs'), userDir: path.join(dir, 'dictionary', 'packs'), getSettings: () => store.get(), setSettings: (p) => store.set(p) });
  const sync = new SyncService({ dir, store, secrets, slang, version: '0.2.61', fetchImpl, debounceMs: 5, ...(now ? { now } : {}) });
  store.onSet = () => sync.notifyLocalChange();
  if (url) { const r = sync.configure({ url, key }); if (!r.ok) throw new Error(r.error); }
  if (enabled) { const r = sync.setEnabled(true); if (!r.ok) throw new Error(r.error); sync.stop(); }
  return { dir, store, secrets, slang, sync };
}

/** the server's side, in memory. Each call is recorded in `calls` with the full URL and body text */
function fakeServer() {
  const db = { users: new Map(), members: new Map(), groups: new Set(), codes: new Map(), rows: [], installs: new Map(), nextId: 1 };
  const calls = [];
  let down = false, seq = 0;
  const json = (status, body) => ({ ok: status < 400, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method, body: init.body || '', headers: init.headers || {} });
    if (down) throw new TypeError('fetch failed');
    const u = new URL(url), p = u.pathname, q = Object.fromEntries(u.searchParams), body = init.body ? JSON.parse(init.body) : undefined;
    if (p === '/auth/v1/signup') {
      const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, access = 'ACCESSTOKEN' + id, refresh = 'REFRESHTOKEN' + id;
      db.users.set(access, id);
      return json(200, { access_token: access, refresh_token: refresh, expires_in: 3600, user: { id } });
    }
    const me = db.users.get(String(init.headers?.Authorization || '').replace('Bearer ', ''));
    if (!me) return json(401, { message: 'JWT expired' });
    const rest = p.replace('/rest/v1/', '');
    if (rest === 'installs') { db.installs.set(body[0].id, body[0]); return json(201); }
    if (rest === 'group_members') { const id = q.install_id.replace('eq.', ''); return json(200, db.members.has(id) ? [{ group_id: db.members.get(id) }] : []); }
    if (rest === 'rpc/list_group') {
      const g = db.members.get(me);
      const ids = g ? [...db.members.entries()].filter(([, v]) => v === g).map(([k]) => k) : [me];
      return json(200, ids.map((id) => ({ install_id: id, version: db.installs.get(id)?.version, joined_at: null, is_me: id === me })));
    }
    if (rest === 'rpc/create_link_code') { const code = 'ABC' + String(234 + db.codes.size).replace(/[01]/g, '2'); db.codes.set(code, me); return json(200, [{ code, expires_at: new Date(Date.now() + 600000).toISOString() }]); }
    if (rest === 'rpc/join_with_code') {
      const owner = db.codes.get(body.raw_code);
      if (!owner) return json(200, { ok: false, error: 'invalid, used or expired code' });
      db.codes.delete(body.raw_code);
      const g = db.members.get(owner) || 'g-' + owner;
      db.members.set(owner, g); db.members.set(me, g);
      return json(200, { ok: true, group_id: g });
    }
    if (rest === 'rpc/leave_group') {
      const g = db.members.get(me);
      db.members.delete(me);
      if (g && [...db.members.values()].filter((v) => v === g).length < 2) { for (const [k, v] of db.members) if (v === g) db.members.delete(k); db.rows = db.rows.filter((r) => r.group_id !== g); }
      return json(200);
    }
    if (rest === 'customization') {
      const may = (r) => r.install_id === me || (r.group_id && db.members.get(me) === r.group_id);
      if (init.method === 'GET') {
        const want = q.group_id ? { group_id: q.group_id.replace('eq.', '') } : { install_id: q.install_id.replace('eq.', '') };
        return json(200, db.rows.filter((r) => may(r) && Object.entries(want).every(([k, v]) => r[k] === v)));
      }
      if (init.method === 'POST') {
        if (db.rows.some((r) => (body.group_id && r.group_id === body.group_id) || (body.install_id && r.install_id === body.install_id))) return json(409, { message: 'duplicate' });
        const row = { id: db.nextId++, group_id: body.group_id || null, install_id: body.install_id || null, doc: body.doc, version: 1 };
        if (!may(row)) return json(403, { message: 'row-level security' });
        db.rows.push(row);
        return json(201, [row]);
      }
      if (init.method === 'PATCH') {
        const r = db.rows.find((x) => String(x.id) === q.id.replace('eq.', '') && String(x.version) === q.version.replace('eq.', '') && may(x));
        if (!r) return json(200, []);
        r.doc = body.doc; r.version++;
        return json(200, [r]);
      }
    }
    return json(404, { message: 'no route ' + rest });
  };
  return { db, calls, fetchImpl, setDown: (v) => { down = v; } };
}

module.exports = { root, tmp, makeInstall, fakeServer, safeStorage };
