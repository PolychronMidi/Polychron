'use strict';
// MCP protocol primitives: SSE event framing + JSON-RPC message shapes.

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'HME', version: '2.0.0' };

function sseEvent(event, data) {
  // SSE frame: optional event: line, data: lines, blank line terminator.
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  const lines = payload.split('\n').map((l) => `data: ${l}`).join('\n');
  return (event ? `event: ${event}\n` : '') + lines + '\n\n';
}

function jsonrpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonrpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: '2.0', id, error: err };
}

function initializeResult() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      tools: { listChanged: false },
    },
    serverInfo: SERVER_INFO,
  };
}

module.exports = {
  PROTOCOL_VERSION,
  SERVER_INFO,
  sseEvent,
  jsonrpcResult,
  jsonrpcError,
  initializeResult,
};
