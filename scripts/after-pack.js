'use strict';
/* electron-builder renames electron.exe to Parakeet Flow.exe but leaves electron_wer.dll alone. Electron 45 needs the helper to carry
   the exe's name, or Windows does not load it and fail-fast crashes are not captured (Electron's rebranding docs). */
const fs = require('fs');
const path = require('path');

/** rename inside a packed folder; a build without the helper (older Electron) is left as it is */
function renameWerHelper(appOutDir, exeBase) {
  const from = path.join(appOutDir, 'electron_wer.dll');
  if (!fs.existsSync(from)) return false;
  fs.renameSync(from, path.join(appOutDir, exeBase + '_wer.dll'));
  return true;
}

module.exports = async (ctx) => { renameWerHelper(ctx.appOutDir, ctx.packager.appInfo.productFilename); };
module.exports.renameWerHelper = renameWerHelper;
