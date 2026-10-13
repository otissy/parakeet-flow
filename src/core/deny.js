'use strict';
/* Windows we never type into. Matched on the lower-cased process name (without .exe) and the
   window title. Own windows are matched by pid. */
const DEFAULT_DENY = ['keepass', 'keepassxc', '1password', 'bitwarden', 'consent', 'logonui', 'lastpass', 'dashlane'];

function isDenied(fg, { deny = DEFAULT_DENY, ownPid = process.pid, ownProcs = ['parakeet-flow'] } = {}) {
  if (!fg) return { denied: true, reason: 'no foreground window' };
  if (fg.pid && fg.pid === ownPid) return { denied: true, reason: 'own window' };
  const proc = String(fg.proc || '').toLowerCase().replace(/\.exe$/, '');
  const title = String(fg.title || '').toLowerCase();
  if (ownProcs.some((p) => proc === p)) return { denied: true, reason: 'own window' };
  for (const d of deny.map((x) => String(x).toLowerCase().replace(/\.exe$/, '').trim()).filter(Boolean)) {
    if (proc.includes(d) || title.includes(d)) return { denied: true, reason: `deny-list: ${d}` };
  }
  return { denied: false };
}

module.exports = { isDenied, DEFAULT_DENY };
