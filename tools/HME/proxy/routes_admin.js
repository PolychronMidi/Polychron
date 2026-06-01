'use strict';
// Admin routes: /hme/spawn (CRUD against the supervisor's adhoc spawn
// pool). Extracted from hme_proxy.js. Self-contained -- only depends on
// the supervisor module re-required inside.

function handleSpawnRoute(clientReq, clientRes) {
  const supervisor = require('./supervisor/index');
  const [rawPath] = (clientReq.url || '').split('?');
  const parts = rawPath.split('/').filter(Boolean);  // ['hme', 'spawn', <id>?]
  const spawnId = parts[2] || null;

  const json = (status, body) => {
    clientRes.writeHead(status, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify(body));
  };

  if (clientReq.method === 'GET' && !spawnId) return json(200, { processes: supervisor.adhocList() });
  if (clientReq.method === 'GET' && spawnId) {
    const s = supervisor.adhocStatus(spawnId);
    return s ? json(200, s) : json(404, { error: 'unknown spawn id' });
  }
  if (clientReq.method === 'DELETE' && spawnId) {
    const ok = supervisor.adhocKill(spawnId, 'SIGTERM');
    return json(ok ? 200 : 404, { id: spawnId, killed: ok });
  }
  if (clientReq.method === 'POST' && !spawnId) {
    const chunks = [];
    clientReq.on('data', (c) => chunks.push(c));
    clientReq.on('end', () => {
      let spec;
      try { spec = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
      catch (err) { return json(400, { error: 'bad JSON: ' + err.message }); }
      if (!spec.cmd) return json(400, { error: 'missing required field: cmd' });
      try {
        const result = supervisor.adhocSpawn(spec);
        return json(200, result);
      } catch (err) {
        // silent-ok: optional fallback path.
        return json(500, { error: err.message });
      }
    });
    return;
  }
  json(405, { error: 'method not allowed' });
}

module.exports = { handleSpawnRoute };
