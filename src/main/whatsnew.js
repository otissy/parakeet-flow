'use strict';
/* "What's new" after an update. The notes are plain data here (CHANGELOG.md is not shipped inside the app); a test keeps the newest entry equal to
   the version in package.json and to the top of CHANGELOG.md. The card shows once per version: settings.updates.seen holds the last version whose
   notes were shown (or dismissed). A brand-new install (no settings file yet) never sees it. */
const fs = require('fs');
const path = require('path');

const NOTES = {
  '0.2.66': [
    'Read aloud: select text in any app and press Ctrl+Alt+R to hear it in a local voice (Kokoro, offline). Press it again or Esc to stop. It is off until you switch it on in Settings > Read aloud, which also downloads the voice once (about 350 MB).',
    'Updates install by themselves: a new version downloads in the background and the app restarts to it at a quiet moment, never while you dictate, record a meeting or listen to a reading. Settings > Updates has the switch, and Check now still works.',
    'This card: after an update it tells you what changed.',
  ],
};

const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const valid = (v) => /^\d+\.\d+\.\d+$/.test(String(v));

/** {version, items} for the running version, or null when there is nothing to show */
function forVersion(version) { return valid(version) && NOTES[version] ? { version, items: NOTES[version] } : null; }

/** whether to show the card: the running version is newer than the last one shown, notes exist, and this is not a first install */
function pending({ version, seen, firstInstall }) {
  if (firstInstall || !valid(version) || (valid(seen) && cmp(version, seen) <= 0)) return null;
  return forVersion(version);
}

/** a marker file written just before an automatic restart: the next start stays in the tray instead of opening the window (a user who was away) */
const MARKER = 'relaunch-hidden';
const MARKER_MAX_AGE_MS = 3 * 60 * 1000;
function writeMarker(dir, now = Date.now()) { try { fs.writeFileSync(path.join(dir, MARKER), String(now)); } catch (_) { /* best effort */ } }
/** true once, if a fresh marker exists; the marker is always removed */
function consumeMarker(dir, now = Date.now()) {
  const f = path.join(dir, MARKER);
  try {
    const at = Number(fs.readFileSync(f, 'utf8'));
    fs.rmSync(f, { force: true });
    return Number.isFinite(at) && now - at >= 0 && now - at <= MARKER_MAX_AGE_MS;
  } catch (_) { return false; }
}

module.exports = { NOTES, forVersion, pending, writeMarker, consumeMarker, MARKER, cmp };
