'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set(['settings:get', 'settings:set', 'stats:get', 'history:get', 'history:copy', 'history:clear',
  'models:status', 'models:download', 'app:info', 'login:set', 'notes:list', 'notes:copy', 'notes:resend', 'notes:delete',
  'notion:status', 'notion:set-token', 'notion:clear-token', 'llm:status', 'llm:download']);
const SEND = new Set(['hotkey:capture', 'audio:chunk', 'audio:error', 'pill:mouse', 'pill:action', 'pill:ready', 'test:report']);
const ON = new Set(['capture:start', 'capture:stop', 'pill:state', 'pill:level', 'app:history', 'app:stats',
  'models:progress', 'engine:state', 'settings:changed', 'test:set', 'notes:changed', 'pill:flags', 'llm:progress', 'llm:state']);

contextBridge.exposeInMainWorld('pf', {
  invoke: (ch, ...a) => (INVOKE.has(ch) ? ipcRenderer.invoke(ch, ...a) : Promise.reject(new Error('blocked channel ' + ch))),
  send: (ch, ...a) => { if (SEND.has(ch)) ipcRenderer.send(ch, ...a); },
  on: (ch, fn) => {
    if (!ON.has(ch)) return () => {};
    const l = (_e, ...a) => fn(...a);
    ipcRenderer.on(ch, l);
    return () => ipcRenderer.removeListener(ch, l);
  },
});
