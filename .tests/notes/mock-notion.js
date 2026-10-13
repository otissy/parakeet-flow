'use strict';
/* A local stand-in for POST https://api.notion.com/v1/pages. Records every request. Real Notion is NOT reachable here. */
const http = require('http');

function startMock(handler) {
  const reqs = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      let json = null; try { json = JSON.parse(body); } catch (_) { /* keep null */ }
      const rec = { method: req.method, url: req.url, headers: req.headers, body, json };
      reqs.push(rec);
      const out = (handler || (() => ({})))(rec, reqs.length) || {};
      const status = out.status || 200;
      res.writeHead(status, { 'content-type': 'application/json', ...(out.headers || {}) });
      res.end(JSON.stringify(out.body || (status === 200 ? { object: 'page', id: 'page-' + reqs.length } : { object: 'error', status, code: out.code || 'error', message: out.message || 'nope' })));
    });
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, reqs, base: 'http://127.0.0.1:' + srv.address().port, close: () => new Promise((r) => srv.close(r)) })));
}

module.exports = { startMock };
