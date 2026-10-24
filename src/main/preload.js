'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set(['settings:get', 'settings:set', 'stats:get', 'history:get', 'history:copy', 'history:clear',
  'models:status', 'models:download', 'app:info', 'login:set', 'notes:list', 'notes:copy', 'notes:resend', 'notes:delete',
  'notion:status', 'notion:set-token', 'notion:clear-token', 'llm:status', 'llm:download', 'export:choose', 'export:run', 'mcp:info',
  'slang:state', 'slang:terms', 'slang:parse-preview', 'slang:preview', 'slang:set-enabled', 'slang:set-biasing', 'slang:add', 'slang:update', 'slang:remove', 'slang:delete-pack', 'slang:import-text', 'slang:import-file', 'slang:export',
  'meetings:list', 'meetings:status', 'meetings:setup', 'meetings:start', 'meetings:stop', 'meetings:update', 'meetings:delete', 'meetings:summarize']);
const SEND = new Set(['hotkey:capture', 'audio:chunk', 'audio:error', 'pill:mouse', 'pill:action', 'pill:ready', 'test:report',
  'meeting:audio-chunk', 'meeting:capture-ready', 'meeting:capture-stopped', 'meeting:capture-error']);
const ON = new Set(['capture:start', 'capture:stop', 'pill:state', 'pill:level', 'app:history', 'app:stats',
  'models:progress', 'engine:state', 'settings:changed', 'test:set', 'notes:changed', 'pill:flags', 'llm:progress', 'llm:state',
  'meetings:changed', 'meetings:progress', 'meetings:state', 'meeting:capture-start', 'meeting:capture-stop']);

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
