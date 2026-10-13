'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set(['settings:get', 'settings:set', 'stats:get', 'history:get', 'history:copy', 'history:clear',
  'models:status', 'models:download', 'app:info', 'login:set']);
const SEND = new Set(['audio:chunk', 'audio:error', 'pill:mouse', 'pill:action', 'pill:ready', 'test:report']);
const ON = new Set(['capture:start', 'capture:stop', 'pill:state', 'pill:level', 'app:history', 'app:stats',
  'models:progress', 'engine:state', 'settings:changed', 'test:set']);

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
