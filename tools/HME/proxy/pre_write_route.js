'use strict';
const { preWriteCheck } = require('./pre_write_check');

function handlePreWriteCheckRoute(clientReq, clientRes) {
  const json = (status, body) => {
    clientRes.writeHead(status, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify(body));
  };
  if (clientReq.method !== 'POST') return json(405, { error: 'POST only' });
  const chunks = [];
  clientReq.on('data', (c) => chunks.push(c));
  clientReq.on('end', async () => {
    try {
      const stdin = Buffer.concat(chunks).toString('utf8') || '{}';
      json(200, await preWriteCheck(stdin));
    } catch (err) {
      // silent-ok: optional fallback path.
      json(500, { permissionDecision: 'ask', reason: `pre-write-check route failed: ${err.message}`, contextualRules: [] });
    }
  });
  clientReq.on('error', (err) => {
    if (!clientRes.headersSent) json(500, { permissionDecision: 'ask', reason: err.message, contextualRules: [] });
  });
}

module.exports = { handlePreWriteCheckRoute };
