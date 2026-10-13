'use strict';
/* The real app: real Electron safeStorage, real IPC from the Settings page, notes -> outbox -> a LOCAL MOCK of the Notion API.
   Real Notion was not reachable and no real token was used: the Notion side stays UNVERIFIED against the real service.
   Also takes the proof screenshots of the new Settings sections, the Notes page and the pill (off-screen capture, true size). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runApp, electron } = require('../features-e2e/run-app.js');
const { startMock } = require('./mock-notion.js');
const U = require('../asr/util');

const skip = U.modelsPresent() && fs.existsSync(electron) ? false : 'electron or models missing (UNVERIFIED)';
const TOKEN = 'secret_E2ETOKEN' + 'x'.repeat(30);
const proof = process.env.PF_PROOF_DIR || path.join(__dirname, '..', '..', '..', 'pf-proof');

test('notes: token encrypted by safeStorage, notes reach the mock Notion with the right headers, failures stay and Resend works, pages render', { skip, timeout: 200000 }, async () => {
  const m = await startMock((q, k) => (k === 2 ? { status: 500, code: 'internal_server_error', message: 'try later' } : {}));
  try {
    const { rep, userData, stderr } = await runApp('notes', { PF_NOTION_BASE: m.base, PF_TEST_TOKEN: TOKEN });
    assert.ok(rep, 'hook wrote a report: ' + stderr);
    assert.deepEqual(rep.errors, []);
    assert.deepEqual(rep.console || [], [], 'no renderer console errors');

    // token: stored through the real IPC, encrypted at rest, the page only learns that one exists
    assert.equal(rep.setToken.ok, true, JSON.stringify(rep.setToken)); assert.equal(rep.status.hasToken, true); assert.equal(rep.status.encryption, true, 'Electron safeStorage is available here');
    assert.ok(!JSON.stringify(rep.status).includes('E2ETOKEN') && !JSON.stringify(rep.setToken).includes('E2ETOKEN'));
    for (const [name, text] of [['secrets.json', rep.secretsFile], ['settings.json', rep.settingsFile], ['app.log', rep.logFile], ['notes.jsonl', fs.readFileSync(path.join(userData, 'notes.jsonl'), 'utf8')]]) {
      assert.ok(!text.includes('E2ETOKEN') && !text.includes(TOKEN), name + ' holds no clear token');
    }
    assert.ok(rep.secretsFile.length > 40, 'something encrypted is stored');

    // outbox: 4 notes; the first was saved before Notion was on (local), the second request failed, the others synced
    const byText = Object.fromEntries(rep.notesAfter.map((n) => [n.text, n]));
    assert.equal(byText['Remind me to water the plants on Friday.'].sync, 'local');
    assert.equal(byText['Buy oat milk on the way home.'].sync, 'synced');
    assert.equal(byText['Call the bank about the new card.'].sync, 'failed'); assert.match(byText['Call the bank about the new card.'].error, /500/);
    assert.equal(byText['Bel de tandarts morgen om negen uur.'].sync, 'synced');
    assert.equal(rep.failedBefore, 'Call the bank about the new card.');
    assert.equal(rep.afterResend.find((n) => n.text === rep.failedBefore).sync, 'synced', 'Resend from the page delivered it');

    // what the mock saw
    assert.equal(m.reqs.length, 4, 'three first attempts + one Resend: ' + m.reqs.map((q) => q.json && q.json.children[0].paragraph.rich_text[0].text.content).join(' | '));
    for (const q of m.reqs) {
      assert.equal(q.method, 'POST'); assert.equal(q.url, '/v1/pages');
      assert.equal(q.headers.authorization, 'Bearer ' + TOKEN); assert.equal(q.headers['notion-version'], '2022-06-28');
      assert.deepEqual(q.json.parent, { database_id: '0123456789abcdef0123456789abcdef' });
      assert.ok(q.json.properties.Name.title[0].text.content.length > 0);
    }

    // screenshots exist at true size and are not blank
    for (const n of ['notes-page', 'notes-page-failed', 'settings-notes-token', 'settings-commands', 'settings-tone', 'settings-translate', 'settings-cleanup', 'settings-notes']) {
      const s = rep.shots[n]; assert.ok(s, n); assert.ok(s.w >= 1000 && s.h >= 640, `${n} at real size ${s.w}x${s.h}`); assert.ok(s.litPixels > 5000, n + ' is not blank');
    }
    for (const n of ['pill-flags-idle', 'pill-flags-listening', 'pill-saved-note']) { assert.ok(rep.shots[n].w >= 480 && rep.shots[n].h >= 110, n); assert.ok(rep.shots[n].litPixels > 200, n); }
    fs.writeFileSync(path.join(proof, 'notes-report.json'), JSON.stringify({ notesAfter: rep.notesAfter, afterResend: rep.afterResend, requests: m.reqs.map((q) => ({ url: q.url, version: q.headers['notion-version'], auth: 'Bearer <redacted>', body: q.json })), status: rep.status }, null, 1));
  } finally { await m.close(); }
});
