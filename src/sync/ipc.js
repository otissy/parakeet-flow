'use strict';
/* IPC for the Settings > Sync section, main window only. Inputs are coerced here; the service validates them again. */
const s = (v, max) => String(v ?? '').slice(0, max);

function register(ipcMain, { service, isMainWindow }) {
  const h = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => {
    if (!isMainWindow(e)) throw new Error('Sync action is not allowed from this page');
    try { return await fn(...a); } catch (err) { return { ok: false, error: 'Unexpected error: ' + s(err && err.message, 120) }; }
  });
  h('sync:status', () => service.status());
  h('sync:configure', (o) => service.configure({ url: s(o && o.url, 300), key: s(o && o.key, 2000) }));
  h('sync:set-name', (name) => service.setName(s(name, 100)));
  h('sync:set-enabled', (on) => service.setEnabled(on === true));
  h('sync:now', async () => ({ ok: await service.syncNow() }));
  h('sync:create-code', () => service.createCode());
  h('sync:create-setup-code', () => service.createSetupCode());
  h('sync:join-setup', (code) => service.joinSetup(s(code, 1600)));
  h('sync:join', (code) => service.join(s(code, 20)));
  h('sync:unlink', () => service.unlink());
  h('sync:restore', () => service.restoreBackup());
}

module.exports = { register };
