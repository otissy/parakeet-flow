'use strict';
/* What a page in this app may ask Chromium for: the microphone (media) and, for meeting capture, the screen source that carries the
   system audio. Electron 45 reports desktop capture as display-capture, no longer as media. Everything else is refused. */
const ALLOWED = new Set(['media', 'display-capture']);
const allowed = (permission) => ALLOWED.has(permission);

function install(session) {
  session.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed(permission)));
  session.setPermissionCheckHandler((_wc, permission) => allowed(permission));
}

module.exports = { allowed, install };
