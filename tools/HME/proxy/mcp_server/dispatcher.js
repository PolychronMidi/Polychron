'use strict';
// Dispatches MCP tools/list and tools/call to the Python worker over plain HTTP.
// Worker endpoints:
//   GET  /tools/list       → {"tools": [ {name, description, inputSchema}, ... ]}
//   POST /tool/<name>      body = kwargs JSON → {ok, result} | {ok:false, error}
//   GET  /health           readiness probe

const http = require('http');
const { MCP_PORT } = require('../supervisor/children');

function _request(method, path, body, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const opts = {
      hostname: '127.0.0.1',
      port: MCP_PORT,
      path,
      method,
      headers: { 'content-type': 'application/json' },
      timeout: timeoutMs,
    };
    if (data) opts.headers['content-length'] = String(data.length);
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null });
        } catch (err) {
          reject(new Error(`worker returned non-JSON (${res.statusCode}): ${text.slice(0, 200)}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('worker timeout')); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let _schemaCache = null;
let _schemaCachedAt = 0;
const SCHEMA_CACHE_MS = 60_000;

async function listTools() {
  const now = Date.now();
  if (_schemaCache && now - _schemaCachedAt < SCHEMA_CACHE_MS) return _schemaCache;
  const { status, json } = await _request('GET', '/tools/list');
  if (status !== 200 || !json || !Array.isArray(json.tools)) {
    throw new Error(`worker /tools/list returned status ${status}`);
  }
  _schemaCache = json.tools;
  _schemaCachedAt = now;
  return _schemaCache;
}

function invalidateSchemaCache() { _schemaCache = null; _schemaCachedAt = 0; }

async function callTool(name, args, timeoutMs) {
  const { status, json } = await _request('POST', `/tool/${encodeURIComponent(name)}`, args || {}, timeoutMs);
  if (!json) throw new Error(`worker /tool/${name} returned no body (status ${status})`);
  if (json.ok === true) {
    // MCP content shape: array of content blocks. HME tools return strings.
    return {
      content: [{ type: 'text', text: String(json.result ?? '') }],
      isError: false,
    };
  }
  const msg = json.error || `unknown tool error (status ${status})`;
  return {
    content: [{ type: 'text', text: `[HME tool error] ${msg}` }],
    isError: true,
  };
}

async function workerHealth() {
  try {
    const { status, json } = await _request('GET', '/health', null, 3000);
    return status === 200 ? json : null;
  } catch (_e) {
    return null;
  }
}

module.exports = { listTools, callTool, invalidateSchemaCache, workerHealth };
