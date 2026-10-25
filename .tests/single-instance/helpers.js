'use strict';
// A fake Electron `app` set sharing ONE lock, like real processes: the holder gets 'second-instance' when
// anyone else asks for the lock, and gives it up when it quits or releases.
const { EventEmitter } = require('node:events');

function makeLockWorld() {
  const world = { holder: null, calls: [], apps: [] };
  world.makeApp = (name, { quitsOnRequest = true, throwOnLock = false } = {}) => {
    const app = new EventEmitter();
    app.name = name; app.quitCalls = 0; app.relaunched = 0; app.exited = null; app.released = 0;
    app.requestSingleInstanceLock = (data) => {
      if (throwOnLock) throw new Error('lock exploded');
      world.calls.push({ from: name, data });
      if (!world.holder || world.holder === app) { world.holder = app; return true; }
      world.holder.emit('second-instance', {}, [], '', data);
      return false;
    };
    app.releaseSingleInstanceLock = () => { app.released++; if (world.holder === app) world.holder = null; };
    app.relaunch = () => { app.relaunched++; };
    app.exit = (c) => { app.exited = c; if (world.holder === app) world.holder = null; };
    app.quit = () => { app.quitCalls++; if (quitsOnRequest && world.holder === app) world.holder = null; };
    world.apps.push(app);
    return app;
  };
  return world;
}

const noWait = () => Promise.resolve();
module.exports = { makeLockWorld, noWait };
