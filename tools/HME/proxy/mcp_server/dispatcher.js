'use strict';
// Dispatches MCP tools/list and tools/call to the Python worker over plain HTTP.
// Worker endpoints:
//   GET  /tools/list       → {"tools": [ {name, description, inputSchema}, ... ]}
//   POST /tool/<name>      body = kwargs JSON → {ok, result} | {ok:false, error}
//   GET  /health           readiness probe
//
// HTTP plumbing is shared via ../_worker_http.js — single source of truth
// for socket setup, timeout handling, JSON parsing. This module owns only
// MCP-specific concerns: schema caching, throw-on-error semantics, and
// content-block envelope formatting.

const { workerRequest } = require('../_worker_http');

let _schemaCache = null;
let _schemaCachedAt = 0;
const SCHEMA_CACHE_MS = 60_000;

async function listTools() {
  const now = Date.now();
  if (_schemaCache && now - _schemaCachedAt < SCHEMA_CACHE_MS) return _schemaCache;
  const { status, json, error } = await workerRequest('GET', '/tools/list', null);
  if (error) throw error;
  if (status !== 200 || !json || !Array.isArray(json.tools)) {
    throw new Error(`worker /tools/list returned status ${status}`);
  }
  _schemaCache = json.tools;
  _schemaCachedAt = now;
  return _schemaCache;
}

function invalidateSchemaCache() { _schemaCache = null; _schemaCachedAt = 0; }

async function callTool(name, args, timeoutMs = 90_000) {
  const { status, json, raw, error } = await workerRequest(
    'POST', `/tool/${encodeURIComponent(name)}`, args || {}, timeoutMs,
  );
  if (error) throw error;
  if (!json) {
    throw new Error(`worker /tool/${name} returned non-JSON (status ${status}): ${raw}`);
  }
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
  const { status, json, error } = await workerRequest('GET', '/health', null, 3000);
  if (error || status !== 200) return null;
  return json;
}

module.exports = { listTools, callTool, invalidateSchemaCache, workerHealth };
