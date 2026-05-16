'use strict';

const fs = require('fs');
const path = require('path');

function safeModel(body) { return body && typeof body.model === 'string' ? body.model : ''; }
function protocolForHost(host, fallback = '') { return fallback || (host === 'codex' ? 'openai-responses' : 'anthropic-messages'); }

function requestTelemetry({ host, protocol, provider, route, path: reqPath, body, before, after, cleanup, stream }) {
  const visible = after || before || {};
  return {
    host,
    protocol: protocolForHost(host, protocol),
    provider: provider || '',
    route: route || '',
    path: reqPath || '',
    model: visible.model || safeModel(body),
    stream: Boolean(stream ?? (body && body.stream)),
    body_bytes: visible.body_bytes || 0,
    instruction_bytes: visible.instruction_bytes || 0,
    text_bytes: visible.text_bytes || 0,
    tool_count: visible.tool_count || 0,
    cleanup: cleanup || {},
  };
}

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...row })}\n`);
}

module.exports = { protocolForHost, requestTelemetry, appendJsonl };
